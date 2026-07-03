/**
 * Pipeline seams — the interfaces the pure engine depends on and the adapters implement.
 *
 * These are **type-only** contracts: no codec SDK, no I/O, no runtime code beyond plain data. The
 * size-search ([`search.ts`](./search.ts)) drives an image through an injected {@link ImageLever}, which an
 * adapter builds by composing an {@link ImageCodec} (encode/decode) with a {@link QualityMetric} (measure).
 * Keeping the core dependent only on these interfaces is what makes the whole decision layer unit-testable
 * with fakes — and is enforced by `.dependency-cruiser.cjs` (core may not import an adapter).
 */

/**
 * A decoded raster image. **Opaque to the pure core** — only an {@link ImageCodec} / {@link QualityMetric}
 * ever inspects `pixels`; the search reasons purely over byte counts and quality scores.
 */
export interface RasterImage {
  readonly width: number
  readonly height: number
  /** Interleaved pixel samples; length is `width * height * channels`. */
  readonly pixels: Uint8Array
  readonly channels: number
}

/**
 * An output image container. `jpeg` is the only one valid inside a PDF (v0.1); standalone images (v0.2) can
 * also emit `png` (lossless), `webp`, and `avif`.
 */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * The encode knobs the size-search turns, in the order the degrade ladder walks them. Chroma subsampling is
 * intentionally **not** a separate knob — the mozjpeg adapter derives it from `quality` (revisit only if
 * measurement shows it should be independent).
 */
export interface EncodeParams {
  /** Encoder quality, 1..100 (higher = larger + closer to the original). Ignored by lossless PNG. */
  readonly quality: number
  /** Downscale factor in `(0, 1]`; `1` keeps native resolution. */
  readonly scale: number
  /**
   * Recode a losslessly-stored photo (FlateDecode) to JPEG — the only in-PDF "codec switch" valid in v0.1
   * (WebP/AVIF can't live in a PDF). A no-op for images already stored as JPEG.
   */
  readonly recodeToJpeg: boolean
  /**
   * Output container (v0.2+). Omitted by the PDF path, whose codec always emits JPEG; the standalone-image
   * codec reads it to switch formats. The image lever injects it (one fixed format per lever), so the search
   * and ladder stay format-agnostic.
   */
  readonly format?: ImageFormat
}

/** One evaluated encoding of an image: how big it got and how close it stayed. */
export interface Candidate {
  readonly params: EncodeParams
  /** Encoded size in bytes. */
  readonly bytes: number
  /** Perceptual similarity to the original raster, `0..1` (`1` = identical). */
  readonly quality: number
}

/** Encodes/decodes one image container. Implemented over sharp/libvips in `@onadiet/pdf` (v0.1). */
export interface ImageCodec {
  readonly kind: string
  /** Decode encoded image bytes into a raster. */
  decode(bytes: Uint8Array): Promise<RasterImage>
  /** Encode a raster under `params`, returning the encoded bytes. */
  encode(image: RasterImage, params: EncodeParams): Promise<Uint8Array>
}

/** Scores how close a candidate raster is to a reference. SSIM in v0.1; swappable (butteraugli, …). */
export interface QualityMetric {
  readonly kind: string
  /** Similarity of `candidate` to `reference`, `0..1` (`1` = identical). Must be deterministic. */
  measure(reference: RasterImage, candidate: RasterImage): number
}

/**
 * A slimmable image in the subject, with the injected encode+measure exposed as a single `evaluate()`.
 *
 * The adapter builds `evaluate` by composing an {@link ImageCodec} and a {@link QualityMetric}; the pure
 * core only ever calls it. `evaluate` must be a pure function of `params` (same params → same candidate) so
 * the search is deterministic and cacheable.
 */
export interface ImageLever {
  readonly id: string
  /** Size of the image as it sits in the input, in bytes. */
  readonly originalBytes: number
  /** Encode at `params` and measure quality vs. the original. */
  evaluate(params: EncodeParams): Promise<Candidate>
}

/**
 * The degrade ladder for a run — the plan-derived candidate operating points, in the order the search
 * tries them (quality first, then downscale, then the recode tier). Derived by
 * [`ladderForPlan`](./ladder.ts).
 */
export interface Ladder {
  /** JPEG qualities to try, **descending** (e.g. `[90, 80, 70]`). Empty for a lossless plan. */
  readonly quality: readonly number[]
  /** Downscale factors to try, **descending from 1** (e.g. `[1, 0.75, 0.5]`). */
  readonly scale: readonly number[]
  /** Whether the step-3 lossless-photo → JPEG recode tier is enabled. */
  readonly allowRecodeToJpeg: boolean
}

/** What the search is converging on: an optional byte budget plus a hard quality floor. */
export interface SlimConstraints {
  /**
   * Whole-subject byte budget. Omit for **plan-only** mode (slim as far as the floor allows, no number).
   */
  readonly targetBytes?: number
  /** Minimum acceptable quality (SSIM), `0..1`. `0` = floorless (accepts any loss, e.g. `crash`/`--force`). */
  readonly floor: number
  /** Optional cancellation/deadline — checked between per-image encode+SSIM evaluations (see `throwIfAborted`). */
  readonly signal?: AbortSignal
  /** Fast path: evaluate only the ladder's gentlest (nominal-quality) operating point per image and verify
   * the floor, instead of walking the whole grid. No effect when `targetBytes` is set. */
  readonly fast?: boolean
}

/** How a search run ended — a discriminated tag so callers handle every case honestly. */
export type SlimOutcomeKind =
  /** Already under the byte target with no changes — kept every original. */
  | 'already-under'
  /** Hit the byte target while holding the floor. */
  | 'under-target'
  /** No byte target given; slimmed each image as far as the floor allowed. */
  | 'slimmed-plan-only'
  /**
   * The **quality floor** is what blocked the target: ignoring the floor (same ladder) *would* have
   * reached it. Returns the closest floor-holding config. Honest fix: loosen the floor / use `crash`/`--force`.
   */
  | 'infeasible-floor-hit'
  /**
   * Infeasible even with the floor removed — the content is incompressible enough, or fixed (non-image)
   * bytes alone exceed the target, that this plan's ladder can't reach it. Loosening the floor won't help.
   */
  | 'infeasible'

/** The per-image verdict: the chosen candidate, or `null` to keep the original untouched. */
export interface ImageDecision {
  readonly id: string
  readonly originalBytes: number
  /** `null` = keep the original (nothing beat it within the floor). */
  readonly chosen: Candidate | null
}

/** The result of a {@link searchSize} run. */
export interface SearchResult {
  readonly outcome: SlimOutcomeKind
  readonly decisions: readonly ImageDecision[]
  /** Bytes not attributable to slimmable images (structure, text, fonts) — the search can't reduce these. */
  readonly fixedBytes: number
  /** `fixedBytes` + the chosen (or original) bytes of every image. */
  readonly totalBytes: number
  /** Did we satisfy the target (or, in plan-only mode, slim at all) while holding the floor? */
  readonly feasible: boolean
}
