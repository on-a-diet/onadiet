import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { RasterImage } from '@onadiet/core'
import { sharpImageCodec, ssimMetric } from '../src/index'
import { runImageCodecConformance, runQualityMetricConformance } from '@onadiet/testkit'
import { bigJpeg } from './helpers'

runImageCodecConformance('sharp-jpeg', sharpImageCodec, () => bigJpeg(256, 256))

// The QualityMetric contract lives here (pdf has @onadiet/testkit); core can't depend on testkit without a
// cycle, so its ssim test is self-contained. ssimMetric is re-exported by @onadiet/pdf for API stability.
runQualityMetricConformance('ssim', ssimMetric)

const flat = (width: number, height: number, channels: number, fill: number): RasterImage => ({
  width,
  height,
  channels,
  pixels: new Uint8Array(width * height * channels).fill(fill),
})

describe('sharpImageCodec specifics', () => {
  it('emits JPEG (DCTDecode-compatible) bytes', async () => {
    const raster = await sharpImageCodec.decode(await bigJpeg(128, 128))
    const bytes = await sharpImageCodec.encode(raster, {
      quality: 70,
      scale: 1,
      recodeToJpeg: false,
    })
    const meta = await sharp(Buffer.from(bytes)).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('scales dimensions proportionally', async () => {
    const raster = await sharpImageCodec.decode(await bigJpeg(400, 200))
    const bytes = await sharpImageCodec.encode(raster, {
      quality: 80,
      scale: 0.5,
      recodeToJpeg: false,
    })
    const back = await sharpImageCodec.decode(bytes)
    expect(back.width).toBe(200)
    expect(back.height).toBe(100)
  })

  it('encodes a grayscale (1-channel) raster to JPEG', async () => {
    const bytes = await sharpImageCodec.encode(flat(8, 8, 1, 100), {
      quality: 80,
      scale: 1,
      recodeToJpeg: false,
    })
    expect((await sharp(Buffer.from(bytes)).metadata()).format).toBe('jpeg')
  })

  it('flattens an RGBA (4-channel) raster to an alpha-free JPEG', async () => {
    const bytes = await sharpImageCodec.encode(flat(8, 8, 4, 128), {
      quality: 80,
      scale: 1,
      recodeToJpeg: false,
    })
    const meta = await sharp(Buffer.from(bytes)).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.hasAlpha).toBe(false)
  })

  it('composites transparent gray+alpha (2-channel) onto white, not black', async () => {
    // gray 0, alpha 0 everywhere → fully transparent. Correct = white (~255); the old bug baked it black.
    const bytes = await sharpImageCodec.encode(flat(8, 8, 2, 0), {
      quality: 95,
      scale: 1,
      recodeToJpeg: false,
    })
    const { data } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(230)
  })

  it('wraps a decode of non-image bytes in a typed error', async () => {
    await expect(
      sharpImageCodec.decode(new TextEncoder().encode('not an image')),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_INPUT',
    })
  })
})
