import type { ImageFormat } from './seams'

/** The named quality/fidelity contracts — the "diet plans" (lossless → tiny). */
export const DIET_PLANS = ['cleanse', 'balanced', 'lowcarb', 'keto', 'crash'] as const
export type DietPlan = (typeof DIET_PLANS)[number]

/**
 * Output-format request for standalone images (v0.2). `keep` (default) preserves the input format; `auto`
 * lets the search pick the smallest floor-holding format; or force a specific one. Ignored by the PDF adapter.
 */
export type FormatRequest = 'keep' | 'auto' | ImageFormat

/** Machine-readable error codes surfaced by the engine. */
export type OnadietErrorCode =
  | 'INVALID_SIZE'
  | 'UNKNOWN_PLAN'
  | 'UNSUPPORTED_INPUT'
  | 'SIGNED_PDF'
  | 'ENCRYPTED_PDF'
  | 'TARGET_INFEASIBLE'
  | 'NOT_IMPLEMENTED'
  /** The caller's {@link SlimRequest.signal} aborted (cancellation / timeout) — the slim stopped mid-flight. */
  | 'ABORTED'

/** Typed error — carries a stable `code` so callers branch on it, never on message strings. */
export class OnadietError extends Error {
  readonly code: OnadietErrorCode

  constructor(code: OnadietErrorCode, message: string) {
    super(message)
    this.name = 'OnadietError'
    this.code = code
  }
}

/**
 * Throw a typed `ABORTED` error if `signal` has aborted. Called between the expensive encode/SSIM steps so a
 * cancelled or timed-out slim stops promptly without leaking further work; adapters map the thrown error to an
 * honest `ABORTED` outcome (they never leave a partial write, since the write only happens after success).
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new OnadietError('ABORTED', 'The slim was aborted (cancellation or timeout).')
}

/** One attributed contributor to a subject's total weight (e.g. "embedded images"). */
export interface WeightCause {
  readonly label: string
  readonly bytes: number
}

/** The result of `weigh` — total size, attributed to its causes. */
export interface Weight {
  readonly bytes: number
  readonly causes: readonly WeightCause[]
}

/** A successful slim. */
export interface DietSuccess {
  readonly ok: true
  readonly inputBytes: number
  readonly outputBytes: number
  readonly plan: DietPlan
  readonly method: string
  readonly keptOriginal: boolean
}

/** An honest non-success (would break a signed PDF, target infeasible, unsupported input, …). */
export interface DietFailure {
  readonly ok: false
  readonly reason: OnadietErrorCode
  readonly detail: string
}

/** The outcome of a diet run — a discriminated union so callers must handle every case. */
export type Outcome = DietSuccess | DietFailure

/** A request to slim a subject to a plan and (optionally) a byte target. */
export interface SlimRequest {
  readonly plan: DietPlan
  /** Whole-file byte target; omit for plan-only (slim as far as the floor allows). */
  readonly targetBytes?: number
  /** Override the plan's quality floor (0..1); `0` = floorless (e.g. `--force` / `crash`). */
  readonly floor?: number
  /** Proceed on a signed PDF even though re-saving invalidates the signature. Default `false` = refuse. */
  readonly allowSigned?: boolean
  /** Output format for standalone images (v0.2); default `keep`. Ignored by the PDF adapter. */
  readonly format?: FormatRequest
  /**
   * Cancellation / deadline for a long slim (essential on a request path). Checked between the expensive
   * encode/SSIM steps; on abort the slim stops and returns an `ABORTED` outcome without writing anything.
   * Use the caller's own `AbortController`, or `AbortSignal.timeout(ms)` for a deadline.
   */
  readonly signal?: AbortSignal
  /**
   * Fixed-quality **fast path** for latency-sensitive callers (a server slimming one file per request):
   * encode ONCE at the plan's nominal quality and verify it holds the floor, skipping the SSIM ladder
   * search. The single biggest per-call latency win — but it trades the deeper savings of the full search,
   * so it's opt-in. Ignored when a `targetBytes` is set (hitting a size needs the search); the CLI rejects
   * that combination up front.
   */
  readonly fast?: boolean
  /**
   * Search a multi-format slim's candidate formats (WebP/AVIF/JPEG under `--format auto` / `keto` / `crash`)
   * **one at a time** instead of concurrently. Default `false` = concurrent (the latency win). Set `true`
   * when the caller **already** parallelizes at a higher level so it shouldn't multiply in-flight raster
   * pipelines: the folder runner sets it (it fans out across files, and per-file serial formats keeps peak
   * memory ~one raster per in-flight file — preserving the folder OOM bound); a memory-constrained server
   * can set it too. No effect on single-format plans (`balanced`/`lowcarb` keep-format) or PDFs.
   */
  readonly serialFormats?: boolean
}

/**
 * The result of a slim: the honest {@link Outcome} plus the bytes to write.
 * `output` is non-null only when a genuinely smaller file was produced; it is `null` when nothing should be
 * written (a failure, or the original was kept because it couldn't be beaten / was already under target).
 */
export interface SlimResult {
  readonly outcome: Outcome
  readonly output: Uint8Array | null
}

/** Format-adapter seam — one per subject/format, implemented in adapter packages (v0.1+). */
export interface FormatAdapter {
  readonly kind: string
  detect(input: Uint8Array): boolean
  weigh(input: Uint8Array): Promise<Weight>
  slim(input: Uint8Array, request: SlimRequest): Promise<SlimResult>
}
