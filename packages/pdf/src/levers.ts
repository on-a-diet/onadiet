/**
 * Builds SizeSearch {@link ImageLever}s from a PDF's embedded images.
 *
 * Each JPEG image is decoded once; its lever's `evaluate` re-encodes at the given params and scores quality
 * as SSIM of the candidate — resampled back to the original dimensions — against the original raster (so the
 * perceptual cost of *both* quality reduction and downscaling shows up). Evaluations are memoized by
 * `quality:scale`; `recodeToJpeg` is not part of the key because the codec always emits JPEG, so recode
 * variants of the same operating point are identical.
 *
 * Only {@link PdfImage.slimmable} images (plain DCTDecode, Device gray/RGB, no mask/decode) are handled —
 * others are skipped and left untouched (re-encoding them would risk silent corruption).
 */
import {
  throwIfAborted,
  type Candidate,
  type EncodeParams,
  type ImageCodec,
  type ImageLever,
  type QualityMetric,
  type RasterImage,
} from '@onadiet/core'
import type { PdfImage } from './pdf-images'
import { resampleRaster } from './image-codec'

/** A search lever paired with the source image and its decoded original raster (kept for the apply step). */
export interface PdfImageLever {
  readonly image: PdfImage
  readonly raster: RasterImage
  readonly lever: ImageLever
}

export async function buildImageLevers(
  images: readonly PdfImage[],
  codec: ImageCodec,
  metric: QualityMetric,
  signal?: AbortSignal,
): Promise<PdfImageLever[]> {
  const levers: PdfImageLever[] = []
  for (const image of images) {
    if (!image.slimmable) continue // plain DCTDecode gray/RGB, no mask/decode (see PdfImage.slimmable)
    throwIfAborted(signal) // decoding every embedded image is unbounded work on a big deck — stay cancellable
    let raster: RasterImage
    try {
      raster = await codec.decode(image.stream.contents)
    } catch {
      continue // unreadable (corrupt) — leave the image untouched
    }
    if (raster.channels !== 1 && raster.channels !== 3) continue // gray/RGB only in v0.1

    const cache = new Map<string, Promise<Candidate>>()
    const evaluate = (params: EncodeParams): Promise<Candidate> => {
      const key = `${params.quality}:${params.scale}`
      let pending = cache.get(key)
      if (pending === undefined) {
        pending = evaluateOne(raster, params, codec, metric)
        cache.set(key, pending)
      }
      return pending
    }

    levers.push({
      image,
      raster,
      lever: { id: image.ref.tag, originalBytes: image.bytes, evaluate },
    })
  }
  return levers
}

async function evaluateOne(
  raster: RasterImage,
  params: EncodeParams,
  codec: ImageCodec,
  metric: QualityMetric,
): Promise<Candidate> {
  const encoded = await codec.encode(raster, params)
  const decoded = await codec.decode(encoded)
  const comparable =
    decoded.width === raster.width && decoded.height === raster.height
      ? decoded
      : await resampleRaster(decoded, raster.width, raster.height)
  return { params, bytes: encoded.length, quality: metric.measure(raster, comparable) }
}
