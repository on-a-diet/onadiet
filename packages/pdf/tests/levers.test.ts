import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { sharpImageCodec, ssimMetric } from '../src/index'
import { buildImageLevers } from '../src/levers'
import { findImages } from '../src/pdf-images'
import { makePdfWithImage, makePdfWithSMaskedImage, makeTextPdf, photoJpeg } from './helpers'

async function leversFor(pdf: Uint8Array): ReturnType<typeof buildImageLevers> {
  return buildImageLevers(findImages(await PDFDocument.load(pdf)), sharpImageCodec, ssimMetric)
}

describe('buildImageLevers', () => {
  it('builds a lever per slimmable JPEG image', async () => {
    const levers = await leversFor(await makePdfWithImage(await photoJpeg(400, 400)))
    expect(levers).toHaveLength(1)
    expect(levers[0]?.raster.width).toBe(400)
    expect(levers[0]?.lever.originalBytes).toBeGreaterThan(0)
  })

  it('skips non-slimmable images (soft-masked) and image-free PDFs', async () => {
    expect(await leversFor(await makePdfWithSMaskedImage(await photoJpeg(400, 400)))).toHaveLength(
      0,
    )
    expect(await leversFor(await makeTextPdf())).toHaveLength(0)
  })

  it('memoizes evaluate by quality+scale (recode variants collapse to one call)', async () => {
    const levers = await leversFor(await makePdfWithImage(await photoJpeg(400, 400)))
    const lever = levers[0]?.lever
    if (lever === undefined) throw new Error('expected a lever')
    const a = await lever.evaluate({ quality: 80, scale: 1, recodeToJpeg: false })
    const b = await lever.evaluate({ quality: 80, scale: 1, recodeToJpeg: true }) // same op point
    expect(b.bytes).toBe(a.bytes)
    expect(b.quality).toBe(a.quality)
  })
})
