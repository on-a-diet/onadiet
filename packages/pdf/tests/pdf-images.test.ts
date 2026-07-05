import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { findImages, hasSignature, imageByteTotal } from '../src/pdf-images'
import {
  bigJpeg,
  makePdfWithImage,
  makePdfWithSMaskedImage,
  makeSignedPdf,
  makeTextPdf,
  photoJpeg,
} from './helpers'

describe('pdf image enumeration', () => {
  it('finds no images in an image-free PDF', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    const loaded = await PDFDocument.load(await doc.save())
    expect(findImages(loaded)).toHaveLength(0)
    expect(imageByteTotal(loaded)).toBe(0)
  })

  it('finds an embedded image with its dimensions and encoded byte size', async () => {
    const doc = await PDFDocument.load(await makePdfWithImage(await bigJpeg(300, 200)))
    const images = findImages(doc)
    expect(images).toHaveLength(1)
    expect(images[0]?.width).toBe(300)
    expect(images[0]?.height).toBe(200)
    expect(images[0]?.bytes).toBeGreaterThan(0)
    expect(imageByteTotal(doc)).toBe(images[0]?.bytes)
  })

  it('marks a plain DCTDecode image slimmable, a soft-masked one not', async () => {
    const plain = await PDFDocument.load(await makePdfWithImage(await photoJpeg(300, 300)))
    expect(findImages(plain)[0]?.slimmable).toBe(true)

    const masked = await PDFDocument.load(await makePdfWithSMaskedImage(await photoJpeg(300, 300)))
    expect(findImages(masked)[0]?.slimmable).toBe(false)
  })
})

describe('hasSignature', () => {
  it('detects a signed PDF (SigFlags) and clears a plain one', async () => {
    expect(hasSignature(await PDFDocument.load(await makeSignedPdf(await bigJpeg(200, 200))))).toBe(
      true,
    )
    expect(hasSignature(await PDFDocument.load(await makeTextPdf()))).toBe(false)
  })
})
