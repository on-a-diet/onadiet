/**
 * Pure argv parser — turns tokens into a typed {@link Parsed} command (or a usage error). No I/O, so it's
 * trivially testable; `run` executes the parsed result against injected ports.
 */
import { DIET_PLANS, OnadietError, parseSize, resolvePlan } from '@onadiet/core'
import type { DietPlan, FormatRequest } from '@onadiet/core'

/** The verbs that operate on a file (the bare path defaults to `slim`). */
export type RunCommand = 'slim' | 'weigh' | 'plan' | 'check'

export interface Options {
  readonly plan: DietPlan
  readonly json: boolean
  /** Proceed on a signed PDF (invalidates the signature). Maps to `--force` / `--allow-signed`. */
  readonly force: boolean
  /** Byte target for slim/plan (`--to` / `--under` / `--goal`). On a folder this is a usage error. */
  readonly targetBytes?: number
  /** Folder mode: per-file byte target for slim/plan (`--to-each`) — caps every recognized file. */
  readonly toEach?: number
  /** Folder mode: whole-tree byte budget for slim/plan (`--to-total`) — the uniform-quality folder budget. */
  readonly toTotal?: number
  /** Budget for `check` (`--max`) — per-file. */
  readonly maxBytes?: number
  /** Folder mode: whole-tree budget for `check` (`--max-total`). */
  readonly maxTotal?: number
  /** Skip (with a reason) any input file larger than this — a fail-fast memory guard (`--max-input`). */
  readonly maxInputBytes?: number
  /** Abort a slim that runs longer than this many milliseconds (`--timeout`) — a deadline for slow files. */
  readonly timeoutMs?: number
  /** Fixed-quality fast path (`--fast`): encode once at the plan's nominal quality, skip the size search.
   * Mutually exclusive with a byte target. */
  readonly fast?: boolean
  /** Output directory (`--out`); default writes `<name>.diet.<ext>` (file) or `<dir>.diet/` (folder). */
  readonly out?: string
  /** Output format for images (`--format`): keep|auto|jpeg|png|webp|avif. Ignored for PDFs. */
  readonly format?: FormatRequest
  /** Folder mode: only slim files matching these globs (`--include`). Empty = all. */
  readonly include?: readonly string[]
  /** Folder mode: skip files matching these globs (`--exclude`). */
  readonly exclude?: readonly string[]
  /** Folder mode: copy non-recognized files into the output tree (`--copy-unknown`, default on). */
  readonly copyUnknown: boolean
  /** Folder mode: max files slimmed in parallel (`--concurrency`/`--jobs`). Omitted = a CPU-based default. */
  readonly concurrency?: number
}

export type Parsed =
  | { readonly kind: 'help' }
  | { readonly kind: 'checkup'; readonly json: boolean }
  | { readonly kind: 'usage-error'; readonly message: string }
  | {
      readonly kind: 'run'
      readonly command: RunCommand
      readonly file: string
      readonly options: Options
    }

/** The sub-commands (single source of truth; re-exported as `COMMANDS`). */
export const VERB_COMMANDS = ['weigh', 'plan', 'check', 'checkup'] as const
const VERBS = new Set<string>(VERB_COMMANDS)
const SIZE_FLAGS = new Set(['--to', '--under', '--goal'])
const FORMAT_VALUES = new Set<FormatRequest>(['keep', 'auto', 'jpeg', 'png', 'webp', 'avif'])

export function parseArgs(argv: readonly string[]): Parsed {
  const first = argv[0]
  if (first === undefined || first === '--help' || first === '-h') return { kind: 'help' }

  const positionals: string[] = []
  let plan: DietPlan = 'balanced'
  let planSet = false // was --plan given explicitly? (distinct from the 'balanced' default)
  let json = false
  let force = false
  let targetBytes: number | undefined
  let toEach: number | undefined
  let toTotal: number | undefined
  let maxBytes: number | undefined
  let maxTotal: number | undefined
  let maxInputBytes: number | undefined
  let timeoutMs: number | undefined
  let out: string | undefined
  let format: FormatRequest | undefined
  const include: string[] = []
  const exclude: string[] = []
  let copyUnknown = true
  let concurrency: number | undefined
  let fast = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg === '--help' || arg === '-h') return { kind: 'help' }
    else if (arg === '--json') json = true
    else if (arg === '--fast') fast = true
    else if (arg === '--force' || arg === '--allow-signed') force = true
    else if (SIZE_FLAGS.has(arg)) {
      const size = parseSizeArg(argv[++i])
      if (size === null) return usageError(`${arg} needs a size (e.g. 5mb, 500kb).`)
      targetBytes = size
    } else if (arg === '--max') {
      const size = parseSizeArg(argv[++i])
      if (size === null) return usageError('--max needs a size (e.g. 5mb, 500kb).')
      maxBytes = size
    } else if (arg === '--to-each') {
      const size = parseSizeArg(argv[++i])
      if (size === null) return usageError('--to-each needs a size (e.g. 500kb, 2mb).')
      toEach = size
    } else if (arg === '--max-total') {
      const size = parseSizeArg(argv[++i])
      if (size === null) return usageError('--max-total needs a size (e.g. 25mb).')
      maxTotal = size
    } else if (arg === '--max-input') {
      const size = parseSizeArg(argv[++i])
      if (size === null || size <= 0)
        return usageError('--max-input needs a positive size (e.g. 50mb).')
      maxInputBytes = size
    } else if (arg === '--timeout') {
      const value = argv[++i]
      const ms = value !== undefined ? Number(value) : NaN
      if (!Number.isInteger(ms) || ms <= 0) {
        return usageError('--timeout needs a positive whole number of milliseconds (e.g. 5000).')
      }
      timeoutMs = ms
    } else if (arg === '--to-total') {
      const size = parseSizeArg(argv[++i])
      if (size === null) return usageError('--to-total needs a size (e.g. 25mb).')
      toTotal = size
    } else if (arg === '--include' || arg === '--exclude') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        return usageError(`${arg} needs a glob (e.g. "*.jpg,**/vendor/**").`)
      }
      const globs = value
        .split(',')
        .map((g) => g.trim())
        .filter((g) => g !== '')
      ;(arg === '--include' ? include : exclude).push(...globs)
    } else if (arg === '--copy-unknown') {
      copyUnknown = true
    } else if (arg === '--no-copy-unknown') {
      copyUnknown = false
    } else if (arg === '--concurrency' || arg === '--jobs') {
      const value = argv[++i]
      if (value === undefined) return usageError(`${arg} needs a number (e.g. 4) or "auto".`)
      if (value !== 'auto') {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0) {
          return usageError(`${arg} must be a non-negative integer or "auto".`)
        }
        if (n > 0) concurrency = n // 0 / "auto" → leave a CPU-based default
      }
    } else if (arg === '--plan') {
      const value = argv[++i]
      if (value === undefined || !isPlan(value)) {
        return usageError(`--plan must be one of: ${DIET_PLANS.join(', ')}.`)
      }
      plan = resolvePlan(value).plan
      planSet = true
    } else if (arg === '--out') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-'))
        return usageError('--out needs a directory.')
      out = value
    } else if (arg === '--format') {
      const value = argv[++i]
      if (value === undefined || !isFormat(value)) {
        return usageError('--format must be one of: keep, auto, jpeg, png, webp, avif.')
      }
      format = value
    } else if (arg.startsWith('-')) {
      return usageError(`unknown option "${arg}"`)
    } else {
      positionals.push(arg)
    }
  }

  const head = positionals[0]
  if (head === 'checkup') {
    if (positionals.length > 1) return usageError(`unexpected argument "${positionals[1]}"`)
    return { kind: 'checkup', json }
  }

  const command: RunCommand = head !== undefined && VERBS.has(head) ? (head as RunCommand) : 'slim'
  const fileIndex = command === 'slim' ? 0 : 1
  const file = positionals[fileIndex]
  if (file === undefined) {
    return usageError(command === 'slim' ? 'no file given.' : `${command} needs a file.`)
  }
  // Surplus positionals usually mean a mistyped verb (`diet weugh a.pdf` → slim of "weugh") or a stray arg.
  if (positionals.length > fileIndex + 1) {
    return usageError(`unexpected argument "${positionals[fileIndex + 1]}"`)
  }
  if (command === 'check' && maxBytes === undefined && maxTotal === undefined) {
    return usageError(
      'check needs a budget: --max <size> (per file) or --max-total <size> (a folder)',
    )
  }
  if (toEach !== undefined && toTotal !== undefined) {
    return usageError('use --to-each (per file) OR --to-total (whole tree), not both')
  }
  // --to-total sweeps the plans itself to fit the budget, so an explicit --plan would be silently ignored.
  // Reject it rather than drop it (fail fast > a surprising no-op).
  if (toTotal !== undefined && planSet) {
    return usageError(
      '--to-total chooses the plan to fit the budget — drop --plan (or use --to-each)',
    )
  }
  // --fast means "don't search for a size", so it's contradictory with any byte target.
  if (fast && (targetBytes !== undefined || toEach !== undefined || toTotal !== undefined)) {
    return usageError(
      '--fast skips the size search, so it cannot be combined with --to/--to-each/--to-total',
    )
  }

  const options: Options = {
    plan,
    json,
    force,
    copyUnknown,
    ...(targetBytes !== undefined ? { targetBytes } : {}),
    ...(toEach !== undefined ? { toEach } : {}),
    ...(toTotal !== undefined ? { toTotal } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    ...(maxTotal !== undefined ? { maxTotal } : {}),
    ...(maxInputBytes !== undefined ? { maxInputBytes } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(fast ? { fast: true } : {}),
    ...(out !== undefined ? { out } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(include.length > 0 ? { include } : {}),
    ...(exclude.length > 0 ? { exclude } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
  }
  return { kind: 'run', command, file, options }
}

function parseSizeArg(value: string | undefined): number | null {
  if (value === undefined || value.startsWith('-')) return null
  try {
    return parseSize(value)
  } catch (error) {
    if (error instanceof OnadietError) return null
    throw error
  }
}

function isPlan(value: string): value is DietPlan {
  return (DIET_PLANS as readonly string[]).includes(value)
}

function isFormat(value: string): value is FormatRequest {
  return (FORMAT_VALUES as ReadonlySet<string>).has(value)
}

function usageError(message: string): Parsed {
  return { kind: 'usage-error', message: `diet: ${message}` }
}
