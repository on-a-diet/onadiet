/**
 * Builds SizeSearch {@link ImageLever}s for a standalone image — one per candidate output format.
 *
 * A standalone image runs the search once per candidate format (JPEG/PNG/WebP/AVIF); each format gets its
 * own lever whose `evaluate` **injects that fixed format** into the params the (format-agnostic) search hands
 * it. The source is decoded ONCE (native channels, for encoding) plus a flattened 3-channel reference ONCE
 * (for SSIM, so a format that drops alpha is scored fairly), and both are shared across every format's lever.
 *
 * Each evaluation caches the **encoded bytes** alongside the {@link Candidate}, so the apply step reuses the
 * exact bytes the search chose — no double-encode, and the never-bigger / target guards can't disagree with
 * the search over an encoder's non-determinism. PNG ignores `quality` (it's lossless), so its cache key
 * collapses the quality axis to avoid redundant max-effort encodes.
 */
import type {
  Candidate,
  EncodeParams,
  ImageFormat,
  ImageLever,
  QualityMetric,
  RasterImage,
} from '@onadiet/core'
import { resampleRaster, type MultiCodec } from './image-codec'

interface Evaluated {
  readonly candidate: Candidate
  readonly encoded: Uint8Array
}

/** A search lever for one format, plus the encoded bytes of any evaluated operating point (for apply). */
export interface ImageFormatLever {
  readonly format: ImageFormat
  readonly lever: ImageLever
  /** The exact bytes produced for `params` during the search (re-encodes only if never evaluated). */
  encodedFor(params: EncodeParams): Promise<Uint8Array>
}

/** Decode the source once, then build a lever per requested output format sharing that decode. */
export async function buildFormatLevers(
  sourceBytes: Uint8Array,
  formats: readonly ImageFormat[],
  codec: MultiCodec,
  metric: QualityMetric,
): Promise<ImageFormatLever[]> {
  const raster = await codec.decode(sourceBytes) // native channels, for encoding
  const reference = await codec.decodeRgb(sourceBytes) // flattened 3-ch, for SSIM
  const originalBytes = sourceBytes.length

  return formats.map((format) => {
    const cache = new Map<string, Promise<Evaluated>>()
    // PNG is lossless — quality has no effect, so fold the quality axis into one key to avoid re-encoding
    // the same (expensive) max-effort PNG once per quality step.
    const keyFor = (p: EncodeParams): string =>
      `${format === 'png' ? 'lossless' : p.quality}:${p.scale}`
    const evalOne = (params: EncodeParams): Promise<Evaluated> => {
      const key = keyFor(params)
      let pending = cache.get(key)
      if (pending === undefined) {
        pending = evaluateOne(raster, reference, { ...params, format }, codec, metric)
        cache.set(key, pending)
      }
      return pending
    }
    return {
      format,
      lever: {
        id: format,
        originalBytes,
        evaluate: (params) => evalOne(params).then((e) => e.candidate),
      },
      encodedFor: (params) => evalOne(params).then((e) => e.encoded),
    }
  })
}

async function evaluateOne(
  raster: RasterImage,
  reference: RasterImage,
  params: EncodeParams,
  codec: MultiCodec,
  metric: QualityMetric,
): Promise<Evaluated> {
  const encoded = await codec.encode(raster, params)
  const decoded = await codec.decodeRgb(encoded)
  const comparable =
    decoded.width === reference.width && decoded.height === reference.height
      ? decoded
      : await resampleRaster(decoded, reference.width, reference.height)
  return {
    candidate: { params, bytes: encoded.length, quality: metric.measure(reference, comparable) },
    encoded,
  }
}
