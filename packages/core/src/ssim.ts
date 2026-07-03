/**
 * SSIM {@link QualityMetric} — how close a re-encoded image stayed to its original.
 *
 * Mean SSIM over non-overlapping 8×8 luma blocks (Wang et al. 2004). `1` = identical, lower = more visible
 * loss. Deterministic and pure — it operates only on raster samples, so it lives in the pure core and is
 * shared by every adapter (`@onadiet/pdf`, `@onadiet/image`, …). `measure` requires the two rasters to be
 * the **same dimensions** — the adapter resamples a downscaled candidate back to the reference size first
 * (that's where the perceptual cost of downscaling shows up).
 */
import { OnadietError } from './types'
import type { QualityMetric, RasterImage } from './seams'

const BLOCK = 8
const L = 255 // dynamic range of 8-bit samples
const C1 = (0.01 * L) ** 2
const C2 = (0.03 * L) ** 2

/** BT.601 luma, one sample per pixel. */
function toLuma(img: RasterImage): Float64Array {
  const { width, height, channels, pixels } = img
  const luma = new Float64Array(width * height)
  for (let p = 0; p < width * height; p += 1) {
    const o = p * channels
    luma[p] =
      channels >= 3
        ? 0.299 * pixels[o]! + 0.587 * pixels[o + 1]! + 0.114 * pixels[o + 2]!
        : pixels[o]!
  }
  return luma
}

/** SSIM for one aligned block, given its pixel accumulators. */
function blockSsim(
  sumX: number,
  sumY: number,
  sumXX: number,
  sumYY: number,
  sumXY: number,
  n: number,
): number {
  const meanX = sumX / n
  const meanY = sumY / n
  const varX = sumXX / n - meanX * meanX
  const varY = sumYY / n - meanY * meanY
  const covXY = sumXY / n - meanX * meanY
  const numerator = (2 * meanX * meanY + C1) * (2 * covXY + C2)
  const denominator = (meanX * meanX + meanY * meanY + C1) * (varX + varY + C2)
  return numerator / denominator
}

function measure(reference: RasterImage, candidate: RasterImage): number {
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new OnadietError(
      'INVALID_SIZE',
      `SSIM needs equal dimensions: ${reference.width}x${reference.height} vs ${candidate.width}x${candidate.height}`,
    )
  }
  const { width, height } = reference
  const x = toLuma(reference)
  const y = toLuma(candidate)

  const blocksX = Math.floor(width / BLOCK)
  const blocksY = Math.floor(height / BLOCK)

  // Images smaller than one block: score the whole image as a single window.
  if (blocksX === 0 || blocksY === 0) {
    let sX = 0
    let sY = 0
    let sXX = 0
    let sYY = 0
    let sXY = 0
    for (let i = 0; i < x.length; i += 1) {
      const a = x[i]!
      const b = y[i]!
      sX += a
      sY += b
      sXX += a * a
      sYY += b * b
      sXY += a * b
    }
    return clamp01(blockSsim(sX, sY, sXX, sYY, sXY, x.length))
  }

  let total = 0
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      let sX = 0
      let sY = 0
      let sXX = 0
      let sYY = 0
      let sXY = 0
      for (let dy = 0; dy < BLOCK; dy += 1) {
        const row = (by * BLOCK + dy) * width + bx * BLOCK
        for (let dx = 0; dx < BLOCK; dx += 1) {
          const a = x[row + dx]!
          const b = y[row + dx]!
          sX += a
          sY += b
          sXX += a * a
          sYY += b * b
          sXY += a * b
        }
      }
      total += blockSsim(sX, sY, sXX, sYY, sXY, BLOCK * BLOCK)
    }
  }
  return clamp01(total / (blocksX * blocksY))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** The default SSIM quality metric. */
export const ssimMetric: QualityMetric = {
  kind: 'ssim',
  measure,
}
