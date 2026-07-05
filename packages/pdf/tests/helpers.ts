/** Shared test fixtures — deterministic image + PDF builders (no disk, no randomness). */
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import { findImages } from '../src/pdf-images'

/** A high-frequency RGB pattern that compresses to a non-trivial JPEG (solid colors would be tiny). */
export async function bigJpeg(width = 1600, height = 1600, quality = 95): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      raw[i] = (x ^ y) & 255
      raw[i + 1] = (x * 2) & 255
      raw[i + 2] = (y * 3) & 255
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer()
}

/**
 * A smooth-gradient JPEG — realistic, compressible content whose SSIM stays high under moderate
 * quality/scale reduction (unlike {@link bigJpeg}'s pure noise, which is adversarial for SSIM). Use this
 * where a slim must be *feasible* within a quality floor.
 */
export async function photoJpeg(width = 1200, height = 1200, quality = 92): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      raw[i] = Math.round((x * 255) / (width - 1))
      raw[i + 1] = Math.round((y * 255) / (height - 1))
      raw[i + 2] = Math.round(((x + y) * 255) / (width + height - 2))
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer()
}

/** A smooth-gradient GRAYSCALE (1-channel) JPEG — exercises the DeviceGray path. */
export async function grayJpeg(width = 800, height = 800, quality = 90): Promise<Buffer> {
  const raw = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raw[y * width + x] = Math.round(((x + y) * 255) / (width + height - 2))
    }
  }
  // toColourspace('b-w') → a true 1-component (DeviceGray) JPEG; plain .jpeg() would emit 3-channel sRGB.
  return sharp(raw, { raw: { width, height, channels: 1 } })
    .toColourspace('b-w')
    .jpeg({ quality })
    .toBuffer()
}

/** A one-page PDF with a single embedded JPEG drawn to fill the page. */
export async function makePdfWithImage(jpeg: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(jpeg)
  const page = doc.addPage([612, 792])
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 })
  return doc.save()
}

/** A one-page PDF with several embedded JPEGs (distinct XObjects), stacked. */
export async function makePdfWithImages(jpegs: readonly Buffer[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  let y = 0
  for (const jpeg of jpegs) {
    const img = await doc.embedJpg(jpeg)
    page.drawImage(img, { x: 0, y, width: 306, height: 396 })
    y += 396
  }
  return doc.save()
}

/**
 * A PDF whose (DCTDecode) image carries an `/SMask` — must be treated as NOT slimmable (re-encoding it
 * would drop the soft transparency). Built by round-tripping so the image stream is real, then injecting
 * the key.
 */
export async function makePdfWithSMaskedImage(jpeg: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makePdfWithImage(jpeg))
  const image = findImages(doc)[0]
  if (image === undefined) throw new Error('expected an embedded image')
  image.stream.dict.set(
    PDFName.of('SMask'),
    doc.context.register(doc.context.obj({ Type: 'XObject', Subtype: 'Image' })),
  )
  return doc.save()
}

/** A one-page text-only PDF (no image XObjects). */
export async function makeTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText('onadiet test document — no images here', { x: 40, y: 700, size: 18, font })
  return doc.save()
}

/** A PDF flagged as signed (AcroForm `SigFlags` SignaturesExist bit) — enough for the refuse-or-warn guard. */
export async function makeSignedPdf(jpeg: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(jpeg)
  const page = doc.addPage([612, 792])
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 })
  const acroForm = doc.context.obj({ SigFlags: 3, Fields: [] })
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acroForm))
  return doc.save()
}
