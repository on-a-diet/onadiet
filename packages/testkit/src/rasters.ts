/** Deterministic {@link RasterImage} fixtures for the pure metric/conformance suites (no sharp, no I/O). */
import type { RasterImage } from '@onadiet/core'

/** A smooth RGB gradient raster. */
export function gradientRaster(width: number, height: number): RasterImage {
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

/** The same raster with every sample shifted by `delta` (a uniform perturbation → quality < 1). */
export function perturbRaster(img: RasterImage, delta: number): RasterImage {
  const pixels = new Uint8Array(img.pixels.length)
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = Math.min(255, Math.max(0, img.pixels[i]! + delta))
  }
  return { width: img.width, height: img.height, channels: img.channels, pixels }
}
