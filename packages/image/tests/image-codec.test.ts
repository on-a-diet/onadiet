import { describe, expect, it } from 'vitest'
import { runImageCodecConformance } from '@onadiet/testkit'
import type { EncodeParams, ImageFormat } from '@onadiet/core'
import { sharpImageCodec, resampleRaster, extensionFor } from '../src/image-codec'
import { alphaRange, gradientPng, inspect, transparentPng } from './helpers'

// The shared ImageCodec contract (exercises the default JPEG round-trip: encode with no format → jpeg).
runImageCodecConformance('sharp-multi', sharpImageCodec, () => gradientPng(64, 64))

const params = (over: Partial<EncodeParams>): EncodeParams => ({
  quality: 80,
  scale: 1,
  recodeToJpeg: false,
  ...over,
})

describe('sharpImageCodec.decode', () => {
  it('preserves the channel count of an RGB source', async () => {
    const raster = await sharpImageCodec.decode(await gradientPng(64, 48))
    expect(raster.width).toBe(64)
    expect(raster.height).toBe(48)
    expect(raster.channels).toBe(3)
    expect(raster.pixels.length).toBe(64 * 48 * 3)
  })

  it('preserves the alpha channel of an RGBA source', async () => {
    const raster = await sharpImageCodec.decode(await transparentPng(64, 64))
    expect(raster.channels).toBe(4)
  })

  it('throws a typed error on undecodable bytes', async () => {
    await expect(sharpImageCodec.decode(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      /Could not decode/,
    )
  })
})

describe('sharpImageCodec.decodeRgb', () => {
  it('flattens any alpha to a 3-channel raster', async () => {
    const rgb = await sharpImageCodec.decodeRgb(await transparentPng(80, 80))
    expect(rgb.channels).toBe(3)
    expect(rgb.pixels.length).toBe(80 * 80 * 3)
  })
})

describe('sharpImageCodec.encode', () => {
  const FORMATS: ImageFormat[] = ['jpeg', 'png', 'webp', 'avif']

  it.each(FORMATS)('emits a valid, decodable %s', async (format) => {
    const raster = await sharpImageCodec.decode(await gradientPng(96, 96))
    const out = await sharpImageCodec.encode(raster, params({ format }))
    const meta = await inspect(out)
    // sharp reports AVIF/HEIF containers as 'heif'.
    expect(meta.format).toBe(format === 'avif' ? 'heif' : format)
    expect(meta.width).toBe(96)
  })

  it('downscales when scale < 1', async () => {
    const raster = await sharpImageCodec.decode(await gradientPng(200, 200))
    const out = await sharpImageCodec.encode(raster, params({ format: 'webp', scale: 0.5 }))
    expect((await inspect(out)).width).toBe(100)
  })

  it('preserves real transparency for alpha-capable formats (webp/avif/png)', async () => {
    const raster = await sharpImageCodec.decode(await transparentPng(96, 96))
    for (const format of ['webp', 'avif', 'png'] as const) {
      const out = await sharpImageCodec.encode(raster, params({ format, quality: 90 }))
      const { min, max } = await alphaRange(out)
      expect(max - min, `${format} should keep the alpha gradient`).toBeGreaterThan(50)
    }
  })

  it('flattens alpha onto white for JPEG (no alpha channel)', async () => {
    const raster = await sharpImageCodec.decode(await transparentPng(96, 96))
    const out = await sharpImageCodec.encode(raster, params({ format: 'jpeg' }))
    expect((await inspect(out)).hasAlpha).toBe(false)
  })

  it('a lower quality yields a smaller lossy encode', async () => {
    const raster = await sharpImageCodec.decode(await gradientPng(160, 160))
    const hi = await sharpImageCodec.encode(raster, params({ format: 'webp', quality: 90 }))
    const lo = await sharpImageCodec.encode(raster, params({ format: 'webp', quality: 40 }))
    expect(lo.length).toBeLessThan(hi.length)
  })
})

describe('resampleRaster', () => {
  it('resizes to exact target dimensions', async () => {
    const raster = await sharpImageCodec.decode(await gradientPng(120, 90))
    const out = await resampleRaster(raster, 60, 45)
    expect(out.width).toBe(60)
    expect(out.height).toBe(45)
  })
})

describe('extensionFor', () => {
  it('maps formats to file extensions (jpeg → jpg)', () => {
    expect(extensionFor('jpeg')).toBe('jpg')
    expect(extensionFor('png')).toBe('png')
    expect(extensionFor('webp')).toBe('webp')
    expect(extensionFor('avif')).toBe('avif')
  })
})
