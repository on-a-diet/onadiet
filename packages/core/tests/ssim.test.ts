import { describe, expect, it } from 'vitest'
import { OnadietError } from '../src/index'
import type { RasterImage } from '../src/index'
import { ssimMetric } from '../src/index'

// Inline raster fixtures — core is a dependency leaf, so it can't pull in @onadiet/testkit (that would make
// core ↔ testkit circular). The shared QualityMetric conformance suite runs against ssim from a package that
// already has testkit (see @onadiet/pdf); here we test the metric's own specifics directly.
function gradientRaster(width: number, height: number): RasterImage {
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      pixels[i] = (x + y) & 255
      pixels[i + 1] = (x * 2) & 255
      pixels[i + 2] = (y * 2) & 255
    }
  }
  return { width, height, channels: 3, pixels }
}

function perturbRaster(img: RasterImage, delta: number): RasterImage {
  const pixels = new Uint8Array(img.pixels.length)
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = Math.min(255, Math.max(0, img.pixels[i]! + delta))
  }
  return { width: img.width, height: img.height, channels: img.channels, pixels }
}

describe('ssimMetric', () => {
  it('has a kind and scores identical images as 1', () => {
    expect(ssimMetric.kind.length).toBeGreaterThan(0)
    const img = gradientRaster(32, 32)
    expect(ssimMetric.measure(img, img)).toBe(1)
  })

  it('scores a degraded image in [0, 1) and is symmetric', () => {
    const ref = gradientRaster(32, 32)
    const worse = perturbRaster(ref, 40)
    const score = ssimMetric.measure(ref, worse)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThan(1)
    expect(ssimMetric.measure(ref, worse)).toBeCloseTo(ssimMetric.measure(worse, ref), 10)
  })

  it('rejects mismatched dimensions with a typed error', () => {
    expect(() => ssimMetric.measure(gradientRaster(32, 32), gradientRaster(16, 16))).toThrowError(
      OnadietError,
    )
  })

  it('scores sub-block (< 8px) images via the whole-image path', () => {
    const a = gradientRaster(4, 4)
    expect(ssimMetric.measure(a, a)).toBe(1)
    const s = ssimMetric.measure(a, perturbRaster(a, 50))
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(1)
  })

  it('degrades monotonically with more perturbation', () => {
    const a = gradientRaster(64, 64)
    const near = ssimMetric.measure(a, perturbRaster(a, 10))
    const far = ssimMetric.measure(a, perturbRaster(a, 60))
    expect(far).toBeLessThan(near)
  })

  it('averages luma across channels: a 1-channel gray image matches its 3-channel equivalent', () => {
    const w = 16
    const h = 16
    const gray1: RasterImage = { width: w, height: h, channels: 1, pixels: new Uint8Array(w * h) }
    const gray3: RasterImage = {
      width: w,
      height: h,
      channels: 3,
      pixels: new Uint8Array(w * h * 3),
    }
    for (let p = 0; p < w * h; p += 1) {
      const v = (p * 7) & 255
      gray1.pixels[p] = v
      gray3.pixels[p * 3] = v
      gray3.pixels[p * 3 + 1] = v
      gray3.pixels[p * 3 + 2] = v
    }
    expect(ssimMetric.measure(gray1, gray1)).toBe(1) // exercises the channels < 3 luma path
    expect(ssimMetric.measure(gray1, gray3)).toBeCloseTo(1, 10) // luma(gray3) == gray1
  })
})
