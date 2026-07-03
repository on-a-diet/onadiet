/**
 * Pure folder helpers — the decision + bookkeeping half of v0.3 folder mode. **No I/O**: the CLI does the
 * walking/reading/writing behind its ports and calls these to decide *what* to do and to aggregate the
 * result. Kept in the pure core so it's unit-tested with plain strings and numbers (see 07-FOLDERS.md).
 *
 * Three concerns: (1) `--include`/`--exclude` glob matching, (2) safe output-path mapping (Zip-Slip guard +
 * honest extension rename on a format switch), (3) manifest aggregation (per-file entries → folder totals).
 */
import type { DietPlan } from './types'

const SEP = '/'

/** Escape the RegExp metacharacters that aren't glob operators. */
function escapeLiteral(char: string): string {
  return char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compile a glob to an anchored RegExp source. Supported subset (documented in 07-FOLDERS): `*` = any run of
 * non-`/`; a doubled `*` (globstar) = any run including `/`; a globstar immediately before a `/` = zero or
 * more whole path segments; `?` = one non-`/`. Everything else is literal. (No brace `{a,b}` or char classes
 * in v0.3 — a comma list is split by the CLI.)
 */
function globToRegExpSource(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1
        if (glob[i + 1] === SEP) {
          i += 1
          out += '(?:[^/]*/)*' // globstar + slash → zero or more whole path segments
        } else {
          out += '.*' // bare globstar → anything, including a slash
        }
      } else {
        out += '[^/]*' // single star → a run within one segment
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += escapeLiteral(c)
    }
  }
  return out
}

const globCache = new Map<string, RegExp>()
// Patterns come from config (`--include`/`--exclude`), so in practice the cache holds a handful of entries.
// The bound is defensive: if globs ever became request-derived, an unbounded module-level Map would be a slow
// memory leak on a long-lived server. At the cap we evict the oldest (Map preserves insertion order) — a
// cheap FIFO that keeps the memo effective for a stable working set while capping worst-case growth.
// Exported (with `globCacheSize`) for the boundedness test; NOT re-exported from the package index (internal).
export const GLOB_CACHE_MAX = 1024

/** Test-only: current size of the compiled-glob memo, so its FIFO bound is assertable without exposing the
 * cache itself. Internal — not re-exported from the package index. */
export function globCacheSize(): number {
  return globCache.size
}

/** Compile (and memoize) a glob to an anchored RegExp — the walk tests every file against every pattern, so
 * recompiling per call would be pure waste on the hot path. Deterministic: the cache is keyed by the glob. */
function compileGlob(glob: string): RegExp {
  let re = globCache.get(glob)
  if (re === undefined) {
    re = new RegExp(`^${globToRegExpSource(glob)}$`)
    if (globCache.size >= GLOB_CACHE_MAX) {
      const oldest = globCache.keys().next().value
      if (oldest !== undefined) globCache.delete(oldest)
    }
    globCache.set(glob, re)
  }
  return re
}

/**
 * Does `relPath` match `glob`? Gitignore-style intuition: a glob with **no** slash matches ANY path
 * **segment** (so `node_modules` excludes everything under a `node_modules/` dir, and `*.jpg` matches a jpg
 * at any depth via its basename); a glob **with** a slash matches the **whole relative path** (a slashed
 * `vendor` pattern → anything under a `vendor/` dir). Paths use `/` separators (the CLI normalizes).
 */
export function matchGlob(relPath: string, glob: string): boolean {
  const g = glob.trim()
  if (g === '') return false
  const re = compileGlob(g)
  if (g.includes(SEP)) return re.test(relPath)
  return relPath.split(SEP).some((seg) => seg !== '' && re.test(seg))
}

/**
 * The include/exclude filter for one file. `exclude` wins over `include`. An empty/omitted `include` means
 * "everything" (minus excludes); a non-empty `include` means "only files matching at least one pattern".
 */
export function includeExclude(
  relPath: string,
  include?: readonly string[],
  exclude?: readonly string[],
): boolean {
  if (exclude !== undefined && exclude.some((g) => matchGlob(relPath, g))) return false
  if (include !== undefined && include.length > 0) return include.some((g) => matchGlob(relPath, g))
  return true
}

/**
 * Is `relPath` safe to join under an output root — i.e. it can't escape it? Rejects absolute paths (POSIX
 * `/…` or Windows `C:…`) and any `..` that would climb above the root. A pure string check; the Zip-Slip /
 * traversal guard the CLI applies before every write.
 */
export function isSafeRelativePath(relPath: string): boolean {
  // Reject POSIX-absolute, Windows-absolute (`\…` / UNC `\\…`), a drive letter, and embedded NUL.
  if (relPath === '' || relPath.startsWith(SEP) || relPath.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(relPath) || relPath.includes('\0')) return false
  let depth = 0
  // Split on BOTH separators so a `..\..` climb is caught even on a POSIX host (defense in depth).
  for (const seg of relPath.split(/[/\\]/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      depth -= 1
      if (depth < 0) return false
    } else {
      depth += 1
    }
  }
  return true
}

/**
 * The output relative path for a file. The tree is mirrored, so the name is preserved — except when the slim
 * switched format (e.g. png → webp), in which case the **extension is swapped** so the file is named
 * honestly. `newExt` is the bare extension (`webp`) or `.webp`; omit it to keep the input path unchanged.
 */
export function outputRelPath(relPath: string, newExt?: string): string {
  if (newExt === undefined) return relPath
  const at = relPath.lastIndexOf(SEP)
  const dir = at >= 0 ? relPath.slice(0, at + 1) : ''
  const name = at >= 0 ? relPath.slice(at + 1) : relPath
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name // dot>0 keeps a leading-dot dotfile intact
  return `${dir}${stem}.${newExt.replace(/^\./, '')}`
}

/** What happened to one file in a folder run. */
export type FolderFileAction = 'slimmed' | 'copied' | 'kept' | 'refused' | 'skipped'

/** One line of the folder manifest. */
export interface FolderFileEntry {
  /** Input path relative to the input root (`/` separators). */
  readonly path: string
  readonly action: FolderFileAction
  readonly inputBytes: number
  /** Output size — equals `inputBytes` for copied/kept/refused; `0` for skipped. */
  readonly outputBytes: number
  /** Output path relative to the output root; omitted for `skipped`. */
  readonly outputPath?: string
  readonly plan?: DietPlan
  readonly method?: string
  /** Why it was refused/skipped (e.g. "signed PDF"). */
  readonly reason?: string
}

/** Folder-wide roll-up. `files` counts everything that lands in the output (skipped excluded). */
export interface FolderTotals {
  readonly files: number
  readonly slimmed: number
  readonly copied: number
  readonly kept: number
  readonly refused: number
  readonly skipped: number
  readonly inputBytes: number
  readonly outputBytes: number
  readonly savedBytes: number
  readonly savedPercent: number
}

/** The full folder result: every file's line plus the totals. */
export interface FolderManifest {
  readonly files: readonly FolderFileEntry[]
  readonly totals: FolderTotals
}

/**
 * Roll per-file entries up into a {@link FolderManifest}. Pure: byte sums exclude `skipped` files (they never
 * enter the output), `savedPercent` is `0` when there's nothing to measure. Never throws.
 */
export function aggregateFolder(entries: readonly FolderFileEntry[]): FolderManifest {
  const totals = {
    files: 0,
    slimmed: 0,
    copied: 0,
    kept: 0,
    refused: 0,
    skipped: 0,
    inputBytes: 0,
    outputBytes: 0,
    savedBytes: 0,
    savedPercent: 0,
  }
  for (const e of entries) {
    totals[e.action] += 1
    if (e.action === 'skipped') continue
    totals.files += 1
    totals.inputBytes += e.inputBytes
    totals.outputBytes += e.outputBytes
  }
  totals.savedBytes = totals.inputBytes - totals.outputBytes
  // One decimal, matching core `savedPercent` — 0-safe here (that helper throws on inputBytes<=0).
  totals.savedPercent =
    totals.inputBytes > 0 ? Math.round((totals.savedBytes / totals.inputBytes) * 1000) / 10 : 0
  return { files: entries, totals }
}

// ── weigh / check (read-only folder budgets, v0.3 sub-phase 2) ──────────────────────────────────────────

/** A path with its byte size — the read-only input to `weighFolder`/`checkFolder`. */
type SizedEntry = { readonly path: string; readonly bytes: number }

/** Heaviest first, ties broken by path — the shared, deterministic order for weigh + check listings. */
const bySizeThenPath = (a: SizedEntry, b: SizedEntry): number =>
  b.bytes - a.bytes || (a.path < b.path ? -1 : 1)

/** The engine's recognized kinds (by extension) plus a catch-all — a fast overview label, not a content sniff. */
export type FolderFileKind = 'pdf' | 'image' | 'svg' | 'other'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif'])

/** Lower-cased final extension of a path (`''` for none / a leading-dot dotfile). */
function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf(SEP) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Classify a path by extension for the folder `weigh` overview. This is a **fast label** (no read), not the
 * content sniff `slim` uses — a diagnostic grouping, so extension is the right, cheap signal here.
 */
export function classifyByExtension(path: string): FolderFileKind {
  const ext = extensionOf(path)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'svg') return 'svg'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'other'
}

/** One weighed file. */
export interface FolderWeighEntry {
  readonly path: string
  readonly bytes: number
  readonly kind: FolderFileKind
}

/** `weigh <dir>` result: files (heaviest first), a by-kind breakdown, and the folder total. */
export interface FolderWeighReport {
  readonly files: readonly FolderWeighEntry[]
  readonly byKind: Readonly<
    Record<FolderFileKind, { readonly files: number; readonly bytes: number }>
  >
  readonly totalFiles: number
  readonly totalBytes: number
}

/** Roll sized entries into a weigh report — pure, deterministic (heaviest first, path tiebreak). */
export function weighFolder(entries: ReadonlyArray<SizedEntry>): FolderWeighReport {
  const byKind = {
    pdf: { files: 0, bytes: 0 },
    image: { files: 0, bytes: 0 },
    svg: { files: 0, bytes: 0 },
    other: { files: 0, bytes: 0 },
  }
  let totalBytes = 0
  const files: FolderWeighEntry[] = entries.map((e) => {
    const kind = classifyByExtension(e.path)
    byKind[kind] = { files: byKind[kind].files + 1, bytes: byKind[kind].bytes + e.bytes }
    totalBytes += e.bytes
    return { path: e.path, bytes: e.bytes, kind }
  })
  files.sort(bySizeThenPath)
  return { files, byKind, totalFiles: entries.length, totalBytes }
}

/** One checked file. */
export interface FolderCheckEntry {
  readonly path: string
  readonly bytes: number
  /** Over the per-file `--max` budget (always `false` when no `--max` was given). */
  readonly overMax: boolean
}

/** `check <dir>` result: the gate verdict plus what breached it. */
export interface FolderCheckReport {
  readonly files: readonly FolderCheckEntry[]
  /** Files over `--max` (heaviest first). */
  readonly over: readonly FolderCheckEntry[]
  readonly totalFiles: number
  readonly totalBytes: number
  readonly maxBytes?: number
  readonly maxTotal?: number
  /** The folder total exceeded `--max-total`. */
  readonly overTotal: boolean
  /** No per-file breach and no total breach. */
  readonly pass: boolean
}

/**
 * Gate sized entries against a per-file (`maxBytes`) and/or whole-tree (`maxTotal`) budget. Pure: `pass` is
 * true iff nothing breaches. At least one budget is expected (the CLI enforces that); with neither, `pass`
 * is vacuously true.
 */
export function checkFolder(
  entries: ReadonlyArray<SizedEntry>,
  maxBytes?: number,
  maxTotal?: number,
): FolderCheckReport {
  let totalBytes = 0
  const files: FolderCheckEntry[] = entries.map((e) => {
    totalBytes += e.bytes
    return { path: e.path, bytes: e.bytes, overMax: maxBytes !== undefined && e.bytes > maxBytes }
  })
  files.sort(bySizeThenPath)
  const over = files.filter((e) => e.overMax)
  const overTotal = maxTotal !== undefined && totalBytes > maxTotal
  return {
    files,
    over,
    totalFiles: entries.length,
    totalBytes,
    overTotal,
    pass: over.length === 0 && !overTotal,
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    ...(maxTotal !== undefined ? { maxTotal } : {}),
  }
}
