/**
 * `run(argv, ports)` — parse, dispatch to the engine, write output, pick an exit code. All filesystem
 * contact goes through injected {@link CliPorts}, so this is fully testable with in-memory fakes; the bin
 * supplies {@link nodePorts}. Exit codes follow docs/03-CLI.md.
 */
import { availableParallelism } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import {
  DIET_PLANS,
  OnadietError,
  checkFolder,
  includeExclude,
  weighFolder,
  type DietPlan,
  type FolderManifest,
  type FormatAdapter,
  type OnadietErrorCode,
  type SlimRequest,
} from '@onadiet/core'
import { pdfAdapter } from '@onadiet/pdf'
import { imageAdapter, sniffImageFormat, extensionFor } from '@onadiet/image'
import { svgAdapter } from '@onadiet/svg'
import { parseArgs, type Options, type RunCommand } from './args'
import type { CliPorts } from './ports'
import { runFolder, listFiles, type DecideFile, type FolderOptions } from './folder'
import {
  formatCheck,
  formatCheckup,
  formatFolder,
  formatFolderBudget,
  formatFolderCheck,
  formatFolderWeigh,
  formatSlim,
  formatWeigh,
} from './format'

export interface RunResult {
  readonly code: number
  readonly output: string
}

export const HELP = [
  'onadiet — put your files on a diet.',
  '',
  'Usage:',
  '  diet <file> [--to <size>] [--plan <plan>] [--format <fmt>] [--out <dir>]  slim it (PDF, image, SVG)',
  '  diet <dir>  [--to-each <size>] [--plan <plan>] [--include/--exclude <globs>]  slim a folder (kept structure)',
  '  diet weigh <file|dir>                                        what does it weigh? (no writes)',
  '  diet plan  <file|dir> [--to/--to-each <size>]               dry-run: what it would do',
  '  diet check <file|dir> --max <size> [--max-total <size>]     CI weigh-in (exit 0/1)',
  '  diet checkup                                                 which engines are available',
  '',
  'Files:   PDF, an image (JPEG/PNG/WebP/AVIF), or SVG. A folder slims each recognized file, copies the rest.',
  'Options: --to <size> (file) · --to-each <size> (folder, per file) · --to-total <size> (folder budget) · --plan cleanse|balanced|lowcarb|keto|crash',
  '         --format keep|auto|jpeg|png|webp|avif (images) · --out <dir> · --force (signed PDF) · --json',
  '         folders: --include/--exclude <globs> · --no-copy-unknown · --concurrency <n> · check --max/--max-total',
  '         guards: --max-input <size> (skip huge files) · --timeout <ms> (abort a slow slim)',
  '         speed:  --fast (encode once at the plan quality, skip the size search)',
  'Docs:    https://github.com/on-a-diet/onadiet',
  '',
].join('\n')

export async function run(argv: readonly string[], ports: CliPorts): Promise<RunResult> {
  const parsed = parseArgs(argv)
  try {
    switch (parsed.kind) {
      case 'help':
        return { code: 0, output: HELP }
      case 'usage-error':
        return { code: 3, output: `${parsed.message}\n\n${HELP}` }
      case 'checkup':
        return {
          code: 0,
          output: formatCheckup(
            {
              'pdf (pdf-lib + sharp/mozjpeg)': 'ready',
              'image (sharp: jpeg/png/webp/avif)': 'ready',
              'svg (svgo)': 'ready',
              'ghostscript (optional, aggressive plans)': 'not used yet',
            },
            parsed.json,
          ),
        }
      case 'run':
        return await runCommand(parsed.command, parsed.file, parsed.options, ports)
    }
  } catch (error) {
    // run() must always resolve to a RunResult, never reject (the bin awaits it at top level).
    return { code: 2, output: `diet: ${messageOf(error)}\n` }
  }
}

async function runCommand(
  command: RunCommand,
  file: string,
  options: Options,
  ports: CliPorts,
): Promise<RunResult> {
  // One deadline signal for the whole run (`--timeout`), shared across every file/pass so it's a real wall
  // clock, not a per-file reset.
  const signal = timeoutSignal(options)

  // Folder mode: a directory input fans the per-file adapters out over a mirrored output tree (v0.3).
  if (await ports.isDirectory(file)) {
    return runFolderMode(command, file, options, ports, signal)
  }

  // `--to-each` / `--to-total` are folder-only; on a single file they're a usage error (use `--to`) rather
  // than silently-ignored flags.
  if (options.toEach !== undefined || options.toTotal !== undefined) {
    const flag = options.toEach !== undefined ? '--to-each' : '--to-total'
    return {
      code: 3,
      output: err(`${flag} is for folders — use --to on a single file`, options.json),
    }
  }

  if (command === 'check') {
    // `check` is a pure byte-size gate, so it works on ANY file (no recognized type required) and is measured
    // by STAT — it never reads the file body, so it's memory-safe on any size and `--max-input` is moot here
    // (folder `check` is stat-only too). --max-total also works as a single file's budget; when BOTH are given
    // the file must satisfy each, i.e. the binding (smaller) budget, so it can't disagree with the folder path.
    const budget = Math.min(options.maxBytes ?? Infinity, options.maxTotal ?? Infinity)
    if (!Number.isFinite(budget)) {
      return { code: 3, output: err('check needs a budget: --max <size>', options.json) }
    }
    let sized: number
    try {
      sized = await ports.size(file)
    } catch {
      return { code: 2, output: err(`cannot read "${file}"`, options.json) }
    }
    const pass = sized <= budget
    return {
      code: pass ? 0 : 1,
      output: formatCheck(
        file,
        sized,
        {
          ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
          ...(options.maxTotal !== undefined ? { maxTotal: options.maxTotal } : {}),
        },
        options.json,
      ),
    }
  }

  // Fail-fast memory guard for the commands that READ + DECODE the file (weigh/slim/plan): reject an oversized
  // file by STAT, before it's ever read into memory. (`check` above is stat-only and already returned.)
  if (options.maxInputBytes !== undefined) {
    let sized: number
    try {
      sized = await ports.size(file)
    } catch {
      return { code: 2, output: err(`cannot read "${file}"`, options.json) }
    }
    if (sized > options.maxInputBytes) {
      return {
        code: 2,
        output: err(
          `"${file}" is ${sized} bytes — over the --max-input limit (${options.maxInputBytes})`,
          options.json,
        ),
      }
    }
  }

  let bytes: Uint8Array
  try {
    bytes = await ports.readFile(file)
  } catch {
    return { code: 2, output: err(`cannot read "${file}"`, options.json) }
  }

  const adapter = selectAdapter(bytes)
  if (adapter === null) {
    return {
      code: 2,
      output: err(
        `"${file}" isn't a supported file (PDF, image: JPEG/PNG/WebP/AVIF, or SVG)`,
        options.json,
      ),
    }
  }

  if (command === 'weigh') {
    try {
      return { code: 0, output: formatWeigh(file, await adapter.weigh(bytes), options.json) }
    } catch (error) {
      return { code: exitFor(error), output: err(messageOf(error), options.json) }
    }
  }

  // slim or plan (plan = dry-run: same computation, no write). Shares `requestFor` with folder mode so the
  // --force ("chase the number": proceed on a signed PDF AND drop the quality floor) + --format wiring has a
  // single source of truth. Adapters ignore what doesn't apply.
  const request = requestFor(options.plan, options, options.targetBytes, signal)
  const result = await adapter.slim(bytes, request)
  const dryRun = command === 'plan'

  if (!result.outcome.ok) {
    return {
      code: exitForCode(result.outcome.reason),
      output: formatSlim(file, result, null, { json: options.json, dryRun }),
    }
  }
  if (dryRun || result.output === null) {
    // plan never writes; a kept-original success has nothing to write.
    return { code: 0, output: formatSlim(file, result, null, { json: options.json, dryRun }) }
  }

  // The output extension follows the ACTUAL output bytes — a format-switch (png → webp) changes it.
  const outPath = outputPath(file, options.out, result.output)
  // Never write over the original. String compare catches the obvious case; sameFile catches symlinks, a
  // case-insensitive filesystem, and Unicode-normalization differences a string compare would miss.
  if (resolve(outPath) === resolve(file) || (await ports.sameFile(file, outPath))) {
    return {
      code: 4,
      output: err('refusing to overwrite the original (in-place is not in v0.1)', options.json),
    }
  }
  try {
    await ports.writeFileAtomic(outPath, result.output)
  } catch {
    return { code: 2, output: err(`cannot write "${outPath}"`, options.json) }
  }
  return {
    code: 0,
    output: formatSlim(file, result, outPath, { json: options.json, dryRun: false }),
  }
}

/**
 * Folder mode (v0.3) — dispatch a directory input: `weigh`/`check` are read-only budgets; `slim`/`plan`
 * (plan = dry-run) mirror the tree into an output dir. Each file goes through the SAME per-file adapters;
 * unknown files copy through, refused (e.g. signed PDF) files copy untouched. `--to-each` sets a per-file cap.
 */
async function runFolderMode(
  command: RunCommand,
  dir: string,
  options: Options,
  ports: CliPorts,
  signal?: AbortSignal,
): Promise<RunResult> {
  if (command === 'weigh') return runFolderWeigh(dir, options, ports)
  if (command === 'check') return runFolderCheck(dir, options, ports)

  // A bare `--to` byte target on a folder is ambiguous (per-file vs whole-tree), so it's a usage error that
  // points at the two folder targets — never silently dropped. `--to-each` = per-file cap; `--to-total` = the
  // whole-tree budget (both below).
  if (options.targetBytes !== undefined) {
    return {
      code: 3,
      output: err(
        'a folder needs --to-each (per file) or --to-total (whole tree), not --to',
        options.json,
      ),
    }
  }

  const dryRun = command === 'plan'
  // Default output is a SIBLING of the input, resolved first so `diet .` → "<cwd>.diet" (a real sibling),
  // not the in-tree "..diet" a raw string concat would produce.
  const outputDir = options.out ?? `${resolve(dir)}.diet`
  const inAbs = resolve(dir)
  const outAbs = resolve(outputDir)
  if (!dryRun) {
    // A pre-planted symlink at the output root would redirect every write outside the intended tree.
    if (await ports.isSymlink(outAbs)) {
      return { code: 4, output: err(`--out must not be a symlink ("${outputDir}")`, options.json) }
    }
    // The output tree must live OUTSIDE the input tree, or the walk would re-ingest its own output / clobber
    // originals. `sameFile` (dev+inode) catches a case-insensitive or Unicode-normalized alias a string
    // compare would miss (e.g. `pics` vs `PICS` on macOS).
    if (
      outAbs === inAbs ||
      outAbs.startsWith(inAbs + sep) ||
      (await ports.sameFile(inAbs, outAbs))
    ) {
      return {
        code: 4,
        output: err(
          `--out must be a separate folder outside the input ("${outputDir}")`,
          options.json,
        ),
      }
    }
  }

  // Shared runFolder config for this run (the plan/target vary; the walk + write config doesn't).
  const baseFolderOpts = {
    inputDir: dir,
    outputDir,
    copyUnknown: options.copyUnknown,
    concurrency: options.concurrency ?? defaultConcurrency(),
    ...(options.include !== undefined ? { include: options.include } : {}),
    ...(options.exclude !== undefined ? { exclude: options.exclude } : {}),
    ...(options.maxInputBytes !== undefined ? { maxInputBytes: options.maxInputBytes } : {}),
    ...(signal !== undefined ? { signal } : {}),
  }

  // --to-total: the whole-folder budget (uniform quality) — sweep plans for the gentlest that fits.
  if (options.toTotal !== undefined) {
    return runFolderBudget(
      dir,
      outputDir,
      options.toTotal,
      options,
      ports,
      baseFolderOpts,
      dryRun,
      signal,
    )
  }

  // Per-file run: `--to-each` sets each file's byte target (reusing the adapter's dual-constraint search);
  // without it, files slim by `--plan` alone.
  const decide = makeDecide(requestFor(options.plan, options, options.toEach, signal, true))
  let manifest
  try {
    manifest = await runFolder(ports, { ...baseFolderOpts, dryRun }, decide)
  } catch (error) {
    return { code: 2, output: err(`folder run failed: ${messageOf(error)}`, options.json) }
  }
  // An aborted (timed-out/cancelled) run left an arbitrary suffix of files unprocessed — the manifest is
  // honest about it (skipped 'aborted' entries), but exit non-zero so a CI/script doesn't read it as success.
  return {
    code: aborted(signal) ? 2 : 0,
    output: formatFolder(dir, outputDir, manifest, { json: options.json, dryRun }),
  }
}

/** Build a per-file {@link SlimRequest} for a given plan (+ optional byte target, force, format, signal). */
function requestFor(
  plan: DietPlan,
  options: Options,
  targetBytes?: number,
  signal?: AbortSignal,
  // Folder callers pass `true`: the folder pool already parallelizes across files, so a multi-format slim
  // must search formats serially — otherwise `--plan keto|crash` / `--format auto` on a big tree would run
  // (files × formats) raster pipelines at once and blow the pool's ~concurrency memory bound (P1).
  serialFormats = false,
): SlimRequest {
  return {
    plan,
    ...(targetBytes !== undefined ? { targetBytes } : {}),
    ...(options.force ? { allowSigned: true, floor: 0 } : {}),
    ...(options.format !== undefined ? { format: options.format } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(options.fast ? { fast: true } : {}),
    ...(serialFormats ? { serialFormats: true } : {}),
  }
}

/** A deadline signal from `--timeout <ms>` (via the standard `AbortSignal.timeout`), or none. Created once per
 * run so every file/pass shares the same deadline. */
function timeoutSignal(options: Options): AbortSignal | undefined {
  return options.timeoutMs !== undefined ? AbortSignal.timeout(options.timeoutMs) : undefined
}

/** The folder `decide` callback for a fixed request: classify by content, slim, map to a folder outcome. */
function makeDecide(request: SlimRequest): DecideFile {
  return async (_relPath, bytes) => {
    const adapter = selectAdapter(bytes)
    if (adapter === null) return { action: 'copied', output: null } // not a recognized type
    const result = await adapter.slim(bytes, request)
    if (!result.outcome.ok) {
      // A cancellation is a SKIP, not a refuse-and-copy-through: an aborted file writes nothing (consistent
      // with the not-yet-started files the run's signal short-circuits), so a timed-out folder run never
      // leaves a mix of copied-through and skipped files for the same 'aborted' cause.
      if (result.outcome.reason === 'ABORTED') {
        return { action: 'skipped', output: null, reason: 'aborted' }
      }
      // refuse-or-warn: keep the original bytes, record why in a human phrase (falls back to the raw code).
      const reason = REFUSE_REASON[result.outcome.reason] ?? result.outcome.reason
      return { action: 'refused', output: null, reason }
    }
    if (result.output === null) return { action: 'kept', output: null, plan: result.outcome.plan }
    // A real format switch (png→webp) renames the output; a same-format re-encode keeps the name.
    const inFmt = sniffImageFormat(bytes)
    const outFmt = sniffImageFormat(result.output)
    const newExt = outFmt !== null && outFmt !== inFmt ? extensionFor(outFmt) : undefined
    return {
      action: 'slimmed',
      output: result.output,
      ...(newExt !== undefined ? { newExt } : {}),
      plan: result.outcome.plan,
      method: result.outcome.method,
    }
  }
}

const abortedBudgetMessage =
  '--to-total was aborted before completing (timeout/cancel) — the budget verdict would be unreliable'

/** Read a signal's aborted state as a fresh call, so TS doesn't narrow the readonly `.aborted` across
 * statements — it genuinely flips to `true` between checks as the deadline fires. */
function aborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

/**
 * `--to-total` — the uniform-quality whole-folder budget, realized as a plan-sweep. Slim the whole tree at
 * each plan gentlest→aggressive (dry-run, so nothing is written yet); the **gentlest plan whose whole-folder
 * total fits the budget wins** (that's the highest quality that fits), then it's applied for real. If even
 * `crash` overflows, refuse honestly and report the smallest achievable (exit 1, like single-file
 * TARGET_INFEASIBLE). The plan is a coarse dial; a fine-grained per-file allocation is a later refinement.
 */
async function runFolderBudget(
  dir: string,
  outputDir: string,
  budget: number,
  options: Options,
  ports: CliPorts,
  baseFolderOpts: Omit<FolderOptions, 'dryRun'>,
  dryRun: boolean,
  signal?: AbortSignal,
): Promise<RunResult> {
  let smallest: FolderManifest | undefined // the most-aggressive result so far (for an honest refusal)
  let winner: { plan: DietPlan; manifest: FolderManifest } | undefined
  // Defense-in-depth: the budget sweep must run the FULL per-plan search — the nominal-only fast path would
  // under-measure every file and corrupt the "which plan fits" verdict. `--fast` + a budget is already a
  // usage error, so this can't trigger today; strip it here anyway so a future guard change can't silently
  // gut the sweep. (Formatting/output still reads the untouched `options`.)
  const searchOptions: Options = options.fast ? { ...options, fast: false } : options
  try {
    for (const plan of DIET_PLANS) {
      // Dry-run each plan to measure its whole-folder total without writing. Plans are gentlest→aggressive,
      // so the FIRST that fits is the gentlest (= highest quality) that fits — no monotonicity assumption.
      const m = await runFolder(
        ports,
        { ...baseFolderOpts, dryRun: true },
        makeDecide(requestFor(plan, searchOptions, undefined, signal, true)),
      )
      if (m.totals.outputBytes <= budget) {
        winner = { plan, manifest: m }
        break
      }
      // Track the true smallest total seen (not just the last plan) for an honest infeasible report.
      if (smallest === undefined || m.totals.outputBytes < smallest.totals.outputBytes) smallest = m
    }
    // If the deadline fired during the sweep, every not-yet-started file became a `skip 'aborted'` — which
    // aggregateFolder EXCLUDES from the totals, so the measured total is a meaningless under-count that would
    // spuriously "fit" any budget. Refuse honestly rather than fabricate a fit/infeasible verdict.
    if (aborted(signal)) {
      return { code: 2, output: err(abortedBudgetMessage, options.json) }
    }
    if (winner === undefined) {
      // Even the most aggressive plan overflows — the un-slimmable/floor-bound bytes exceed the budget.
      return {
        code: 1,
        output: formatFolderBudget(
          dir,
          outputDir,
          budget,
          { kind: 'infeasible', manifest: smallest! },
          { json: options.json, dryRun },
        ),
      }
    }
    // Apply the winning plan for real (a dry-run already has the answer from the sweep above).
    const manifest = dryRun
      ? winner.manifest
      : await runFolder(
          ports,
          { ...baseFolderOpts, dryRun: false },
          makeDecide(requestFor(winner.plan, searchOptions, undefined, signal, true)),
        )
    // The write pass could also be truncated by the deadline (an all-skipped tree writes nothing) — same
    // dishonest-verdict risk as the sweep above, so refuse honestly here too.
    if (aborted(signal)) {
      return { code: 2, output: err(abortedBudgetMessage, options.json) }
    }
    // The fit was decided on the sweep's dry-run; the write pass re-walks + re-slims the tree, so re-assert
    // the budget on what was ACTUALLY written. If the tree changed underneath us (a file added/grown between
    // planning and writing — each pass calls listFiles fresh) or an adapter isn't byte-deterministic, the
    // output can exceed the budget. Report that honestly (exit 1) rather than printing a false "fit".
    if (!dryRun && manifest.totals.outputBytes > budget) {
      return {
        code: 1,
        output: formatFolderBudget(
          dir,
          outputDir,
          budget,
          { kind: 'overran', plan: winner.plan, manifest },
          { json: options.json, dryRun },
        ),
      }
    }
    return {
      code: 0,
      output: formatFolderBudget(
        dir,
        outputDir,
        budget,
        { kind: 'fit', plan: winner.plan, manifest },
        { json: options.json, dryRun },
      ),
    }
  } catch (error) {
    return { code: 2, output: err(`folder run failed: ${messageOf(error)}`, options.json) }
  }
}

/**
 * Default folder concurrency: scale with cores but leave one free, and cap at 8 — since each in-flight file
 * can hold a full raster decode, an uncapped default on a many-core box would risk OOM. Users raise it with
 * `--concurrency <n>` when they have the memory. See docs/08-PERFORMANCE.
 */
function defaultConcurrency(): number {
  return Math.max(1, Math.min(availableParallelism() - 1, 8))
}

/**
 * Gather (filtered) files under `dir` with their byte sizes — the read-only basis for folder `weigh`/`check`.
 * Uses `ports.size` (stat, no read), reuses the hardened walk, and skips an unreadable file like `slim` does.
 */
async function sizedEntries(
  dir: string,
  options: Options,
  ports: CliPorts,
): Promise<Array<{ path: string; bytes: number }>> {
  const files = await listFiles(ports, dir)
  const out: Array<{ path: string; bytes: number }> = []
  for (const rel of files) {
    if (!includeExclude(rel, options.include, options.exclude)) continue
    try {
      out.push({ path: rel, bytes: await ports.size(join(dir, rel)) })
    } catch {
      continue // unreadable → skip, matching the slim walk's per-file tolerance
    }
  }
  return out
}

/** `diet weigh <dir>` — a size overview (per-file, by-kind breakdown, folder total). Read-only, exit 0. */
async function runFolderWeigh(dir: string, options: Options, ports: CliPorts): Promise<RunResult> {
  const report = weighFolder(await sizedEntries(dir, options, ports))
  return { code: 0, output: formatFolderWeigh(dir, report, options.json) }
}

/** `diet check <dir> --max/--max-total` — a CI gate: exit 1 if any per-file or the whole-tree budget breaks. */
async function runFolderCheck(dir: string, options: Options, ports: CliPorts): Promise<RunResult> {
  const report = checkFolder(
    await sizedEntries(dir, options, ports),
    options.maxBytes,
    options.maxTotal,
  )
  return { code: report.pass ? 0 : 1, output: formatFolderCheck(dir, report, options.json) }
}

/** Human phrasing for the refuse reasons a folder file can hit (manifest + report); falls back to the code. */
const REFUSE_REASON: Partial<Record<OnadietErrorCode, string>> = {
  SIGNED_PDF: 'signed PDF',
  ENCRYPTED_PDF: 'encrypted PDF',
  UNSUPPORTED_INPUT: 'unsupported file',
  TARGET_INFEASIBLE: 'target infeasible',
  NOT_IMPLEMENTED: 'not implemented',
  // ABORTED is handled in makeDecide as a skip, so it never reaches this refuse-reason map.
}

/** First adapter whose sniff matches the input, or `null` if it's not a PDF, raster image, or SVG. */
function selectAdapter(bytes: Uint8Array): FormatAdapter | null {
  if (pdfAdapter.detect(bytes)) return pdfAdapter
  if (imageAdapter.detect(bytes)) return imageAdapter
  if (svgAdapter.detect(bytes)) return svgAdapter
  return null
}

/**
 * Default output: `report.diet.pdf` next to the input; with `--out <dir>`, the original name in that dir.
 * The extension follows the produced bytes — for an image that switched format (e.g. png → webp), it's the
 * new format's extension so the file is named honestly.
 */
function outputPath(file: string, outDir: string | undefined, output: Uint8Array): string {
  const outFormat = sniffImageFormat(output)
  const ext = outFormat ? `.${extensionFor(outFormat)}` : extname(file)
  const base = basename(file, extname(file))
  if (outDir !== undefined) return join(outDir, `${base}${ext}`)
  return join(dirname(file), `${base}.diet${ext}`)
}

/** Map an engine error code to a process exit code (exported for a deterministic exit-code test). */
export function exitForCode(reason: OnadietErrorCode): number {
  switch (reason) {
    case 'SIGNED_PDF':
      return 4 // unsafe operation blocked
    case 'TARGET_INFEASIBLE':
      return 1 // target failed
    case 'UNKNOWN_PLAN':
    case 'INVALID_SIZE':
      return 3 // invalid usage
    default:
      return 2 // processing error (ENCRYPTED_PDF, UNSUPPORTED_INPUT, NOT_IMPLEMENTED, ABORTED/timeout)
  }
}

function exitFor(error: unknown): number {
  return error instanceof OnadietError ? exitForCode(error.code) : 2
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function err(message: string, json: boolean): string {
  return json ? `${JSON.stringify({ ok: false, error: message })}\n` : `diet: ${message}\n`
}
