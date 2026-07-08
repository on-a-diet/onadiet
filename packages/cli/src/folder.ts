/**
 * Folder orchestration — the I/O half of v0.3 folder mode. Walks an input tree behind the injected
 * {@link CliPorts}, applies the `--include`/`--exclude` filter, hands each file to an injected `decide`
 * callback (which owns the classify + slim logic, so this stays adapter-agnostic + testable), and writes the
 * results into a mirrored output tree. Returns the pure {@link FolderManifest} for the reporter.
 *
 * Safety (see 07-FOLDERS): never follows symlinks, bounds depth + entry count, refuses any output path that
 * would escape the output root (Zip-Slip), writes each file atomically, and never touches the input tree.
 */
import { dirname, join } from 'node:path'
import {
  aggregateFolder,
  includeExclude,
  isSafeRelativePath,
  outputRelPath,
  type DietPlan,
  type FolderFileAction,
  type FolderFileEntry,
  type FolderManifest,
} from '@onadiet/core'
import type { CliPorts, DirEntry } from './ports'

const MAX_DEPTH = 64
const MAX_ENTRIES = 100_000

/** What the caller decided to do with one file's bytes. `output` is the slimmed bytes, or `null` to write
 * the original through (copied / kept / refused) or nothing at all (skipped). */
export interface FileDecision {
  readonly action: FolderFileAction
  readonly output: Uint8Array | null
  /** New extension when a slim switched format (png → webp); omitted otherwise. */
  readonly newExt?: string
  readonly plan?: DietPlan
  readonly method?: string
  readonly reason?: string
}

export type DecideFile = (relPath: string, bytes: Uint8Array) => Promise<FileDecision>

export interface FolderOptions {
  readonly inputDir: string
  readonly outputDir: string
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
  readonly copyUnknown: boolean
  /** `diet plan <dir>` — compute the manifest but write nothing. */
  readonly dryRun?: boolean
  /** Max files decoded/slimmed in parallel (bounds the real memory cost). Defaults to 1 (sequential). */
  readonly concurrency?: number
  /** Skip (with a reason) any file larger than this many bytes — a fail-fast memory guard, checked by stat
   * before the file is ever read. Omitted = no cap. */
  readonly maxInputBytes?: number
  /** Cancellation / deadline (`--timeout`): once aborted, remaining files are skipped and in-flight slims
   * stop. The run finishes with an honest manifest (aborted/skipped entries), not a partial write. */
  readonly signal?: AbortSignal
}

/**
 * Map over `items` with at most `concurrency` in flight, preserving input order in the result. The result
 * index is assigned atomically (single-threaded JS: `next++` has no await between read and increment), so
 * workers never collide and `results[i]` always corresponds to `items[i]`.
 */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length))
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

/** Best-effort staged-temp cleanup: a failure to remove a temp (EPERM/EBUSY/…) must never abort the run, so
 * it's swallowed here in addition to the port's own tolerance. */
async function removeTempQuietly(ports: CliPorts, tempPath: string): Promise<void> {
  try {
    await ports.removeTemp(tempPath)
  } catch {
    // best-effort: a leaked temp is preferable to failing the whole run
  }
}

/**
 * Where a commit's output bytes come from at write time:
 * - `staged` — a slimmed output already streamed to a temp file **in its destination directory**; commit
 *   renames it into place (same-directory → atomic, never cross-device), so peak memory stays ~`concurrency`
 *   regardless of tree size rather than holding every slimmed buffer until commit. A file whose staging fails
 *   is skipped-with-reason instead (never buffered), so the memory bound holds unconditionally.
 * - `reread` — a copy-through (copied/kept/refused): re-read from the input at commit instead of buffered, so
 *   a big tree of passthrough originals can't blow up memory. Dry-run also uses this (it writes nothing).
 */
type WriteSource =
  { readonly kind: 'staged'; readonly tempPath: string } | { readonly kind: 'reread' }

/** The outcome of deciding one file, before any write — the barrier between the parallel and serial halves. */
type PlannedFile =
  | {
      readonly kind: 'skip'
      readonly path: string
      readonly inputBytes: number
      readonly reason?: string
    }
  | {
      readonly kind: 'commit'
      readonly path: string
      readonly inputBytes: number
      readonly outputBytes: number
      readonly action: FolderFileAction
      readonly outRel: string
      readonly source: WriteSource
      readonly plan?: DietPlan
      readonly method?: string
      readonly reason?: string
    }

/**
 * Decide one file — filter → read → `decide` → map to a {@link PlannedFile}. This is the parallelizable half:
 * pure per-file work with NO writes and NO cross-file state, so it's safe to run many at once. Collision
 * resolution and the actual write happen serially afterwards (see {@link runFolder}).
 */
async function planFile(
  ports: CliPorts,
  opts: FolderOptions,
  decide: DecideFile,
  rel: string,
): Promise<PlannedFile> {
  // Once the run's deadline/cancel has fired, stop starting new files — skip them cheaply (in-flight slims
  // abort on their own via the request's signal).
  if (opts.signal?.aborted) {
    return { kind: 'skip', path: rel, inputBytes: 0, reason: 'aborted' }
  }
  if (!includeExclude(rel, opts.include, opts.exclude)) {
    return { kind: 'skip', path: rel, inputBytes: 0, reason: 'filtered out' }
  }
  const abs = join(opts.inputDir, rel)
  // Fail-fast memory guard: reject an oversized file by STAT, before it's ever read into memory. A stat that
  // throws falls through to the read below, which surfaces the unreadable case honestly.
  if (opts.maxInputBytes !== undefined) {
    try {
      const sized = await ports.size(abs)
      if (sized > opts.maxInputBytes) {
        return {
          kind: 'skip',
          path: rel,
          inputBytes: sized,
          reason: `too large (> ${opts.maxInputBytes} bytes)`,
        }
      }
    } catch {
      // fall through — the read below handles a missing/unreadable file
    }
  }
  let bytes: Uint8Array
  try {
    bytes = await ports.readFile(abs)
  } catch {
    return { kind: 'skip', path: rel, inputBytes: 0, reason: 'unreadable' }
  }
  let decision: FileDecision
  try {
    decision = await decide(rel, bytes)
  } catch (error) {
    decision = {
      action: 'refused',
      output: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
  // copied == "not a recognized type"; honour --no-copy-unknown by turning it into a skip.
  if (decision.action === 'copied' && !opts.copyUnknown) {
    return {
      kind: 'skip',
      path: rel,
      inputBytes: bytes.length,
      reason: 'unknown type (--no-copy-unknown)',
    }
  }
  if (decision.action === 'skipped') {
    return {
      kind: 'skip',
      path: rel,
      inputBytes: bytes.length,
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
    }
  }
  const outRel = outputRelPath(rel, decision.newExt)
  if (!isSafeRelativePath(outRel)) {
    return { kind: 'skip', path: rel, inputBytes: bytes.length, reason: 'unsafe output path' }
  }
  const slimmed = decision.output // Uint8Array (new bytes) for a real slim; null for copy/kept/refused
  // Stream a real slim's output straight to a temp file IN ITS DESTINATION DIRECTORY (so the commit rename is
  // same-directory → atomic, never cross-device) rather than holding it in memory until commit. Copy-through
  // re-reads the original at commit; dry-run never writes. If staging fails (e.g. output disk full), skip the
  // file with a reason instead of buffering it — the memory bound then holds unconditionally, never falling
  // back to holding the whole tree in RAM under systemic disk failure.
  let source: WriteSource = { kind: 'reread' }
  if (opts.dryRun !== true && slimmed !== null) {
    const destDir = dirname(join(opts.outputDir, outRel))
    try {
      source = { kind: 'staged', tempPath: await ports.stageTemp(destDir, slimmed) }
    } catch {
      return { kind: 'skip', path: rel, inputBytes: bytes.length, reason: 'stage failed' }
    }
  }
  return {
    kind: 'commit',
    path: rel,
    inputBytes: bytes.length,
    outputBytes: slimmed !== null ? slimmed.length : bytes.length,
    action: decision.action,
    outRel,
    source,
    ...(decision.plan !== undefined ? { plan: decision.plan } : {}),
    ...(decision.method !== undefined ? { method: decision.method } : {}),
    ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
  }
}

const skippedEntry = (p: {
  path: string
  inputBytes: number
  reason?: string
}): FolderFileEntry => ({
  path: p.path,
  action: 'skipped',
  inputBytes: p.inputBytes,
  outputBytes: 0,
  ...(p.reason !== undefined ? { reason: p.reason } : {}),
})

/**
 * Recursively collect regular-file paths relative to `root` (POSIX `/`), skipping symlinks and special
 * files; depth and total-entry count are bounded so a hostile tree can't hang or OOM the run. Exported as
 * {@link listFiles} so `weigh`/`check` share the same hardened walk as `slim`.
 */
export async function listFiles(ports: CliPorts, root: string): Promise<string[]> {
  const files: string[] = []
  let visited = 0 // every entry seen (files AND dirs) — bounds an all-directory fan-out, not just files
  async function recurse(rel: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) return
    let entries: readonly DirEntry[]
    try {
      entries = await ports.readDir(rel === '' ? root : join(root, rel))
    } catch {
      return // an unreadable subdir (permissions, a race) is skipped, not fatal — one bad dir ≠ whole run
    }
    for (const e of entries) {
      if (visited >= MAX_ENTRIES) return
      visited += 1
      if (e.isSymbolicLink) continue // never follow or emit symlinks (loop + escape risk)
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory) await recurse(childRel, depth + 1)
      else if (e.isFile) files.push(childRel) // regular files only — a FIFO/device/socket read would block
    }
  }
  await recurse('', 0)
  files.sort() // deterministic manifest order regardless of readdir order
  return files
}

/**
 * Run folder mode in two phases:
 *
 * 1. **Decide (parallel).** Every file is read + `decide`d through a bounded pool (`opts.concurrency`), the
 *    expensive slim/search step — each file is independent, so this is embarrassingly parallel. `decide`
 *    never throws for a normal outcome; a thrown error is caught and recorded as `refused` so one bad file
 *    can't abort the run.
 * 2. **Commit (serial, deterministic).** Planned files are walked in sorted input order to resolve
 *    output-name collisions (two inputs → one output, e.g. png+jpeg → webp) and write. Resolving serially in
 *    sorted order makes the collision winner the **sorted-first** input regardless of which decode finished
 *    first — so the output tree is byte-identical whatever the concurrency.
 *
 * Concurrency bounds the real memory cost: at most N simultaneous raster decodes. Slimmed outputs are
 * streamed to temp files on disk as they're produced (not buffered until commit) and copy-through originals
 * are re-read serially, so peak memory stays ~N regardless of how large the tree is.
 */
export async function runFolder(
  ports: CliPorts,
  opts: FolderOptions,
  decide: DecideFile,
): Promise<FolderManifest> {
  const files = await listFiles(ports, opts.inputDir)
  const planned = await mapPool(files, opts.concurrency ?? 1, (rel) =>
    planFile(ports, opts, decide, rel),
  )

  const entries: FolderFileEntry[] = []
  const seenOutputs = new Set<string>() // one output name → one input; sorted-first claims it
  for (const p of planned) {
    if (p.kind === 'skip') {
      entries.push(skippedEntry(p))
      continue
    }
    if (seenOutputs.has(p.outRel)) {
      // A sorted-earlier file already claimed this name — skip rather than clobber it, and drop this loser's
      // staged temp so it doesn't leak (best-effort; a cleanup failure must not abort the run).
      if (p.source.kind === 'staged') await removeTempQuietly(ports, p.source.tempPath)
      entries.push({ ...skippedEntry(p), reason: `output name collision (${p.outRel})` })
      continue
    }
    seenOutputs.add(p.outRel)

    if (opts.dryRun !== true) {
      const outAbs = join(opts.outputDir, p.outRel)
      if (p.source.kind === 'staged') {
        // The slimmed output is already on disk in its destination directory — rename it into place (atomic,
        // no re-write, no mkdirp: stageTemp already created the dir). Clean the temp up if the rename fails.
        try {
          await ports.commitStaged(p.source.tempPath, outAbs)
        } catch {
          await removeTempQuietly(ports, p.source.tempPath)
          entries.push({ ...skippedEntry(p), reason: 'write failed' })
          continue
        }
      } else {
        // A copy-through original re-read now (serial → at most one resident). A read failure is 'unreadable',
        // distinct from a 'write failed'.
        let data: Uint8Array
        try {
          data = await ports.readFile(join(opts.inputDir, p.path))
        } catch {
          entries.push({ ...skippedEntry(p), reason: 'unreadable' })
          continue
        }
        try {
          await ports.mkdirp(dirname(outAbs))
          await ports.writeFileAtomic(outAbs, data)
        } catch {
          entries.push({ ...skippedEntry(p), reason: 'write failed' })
          continue
        }
      }
    }

    entries.push({
      path: p.path,
      action: p.action,
      inputBytes: p.inputBytes,
      outputBytes: p.outputBytes,
      outputPath: p.outRel,
      ...(p.plan !== undefined ? { plan: p.plan } : {}),
      ...(p.method !== undefined ? { method: p.method } : {}),
      ...(p.reason !== undefined ? { reason: p.reason } : {}),
    })
  }

  return aggregateFolder(entries)
}
