/**
 * CAPABILITY PROBE (v0.1 step 2) — the one real unknown behind the whole PDF adapter:
 * can pdf-lib **replace an existing image XObject in place** with a smaller re-encoded JPEG and
 * re-serialize a still-valid, smaller PDF?
 *
 * A real, self-contained test: it builds a PDF with a large embedded JPEG, swaps that image for a
 * downscaled/lower-quality one via sharp, and asserts the output is both smaller and re-parseable with the
 * same page count. If this holds, the extract→re-encode→re-embed plan is viable on a 100%-permissive stack;
 * if it ever breaks, the adapter's core assumption broke. (This is the pattern `slim` builds on in step 3.)
 */
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import sharp from 'sharp'
import { findImages } from '../../src/pdf-images'
import { bigJpeg, makePdfWithImage } from '../helpers'

describe('capability probe: replace an image XObject in place', () => {
  it('produces a smaller, still-valid PDF after swapping the image for a re-encoded one', async () => {
    const original = await makePdfWithImage(await bigJpeg(1600, 1600))
    const doc = await PDFDocument.load(original)

    const images = findImages(doc)
    expect(images.length).toBe(1) // sanity: we embedded exactly one image
    const image = images[0]
    if (image === undefined) throw new Error('no image stream found')

    // Extract the embedded JPEG (a DCTDecode stream's contents ARE the JPEG bytes) and re-encode smaller.
    const originalJpeg = Buffer.from(image.stream.contents)
    const reencoded = await sharp(originalJpeg)
      .resize({ width: 800 })
      .jpeg({ quality: 45 })
      .toBuffer()
    const meta = await sharp(reencoded).metadata()

    // Replace in place: clone the (valid) image dict, fix dimensions + length, swap the bytes, reassign ref.
    const newDict = image.stream.dict.clone(doc.context)
    newDict.set(PDFName.of('Width'), PDFNumber.of(meta.width ?? 0))
    newDict.set(PDFName.of('Height'), PDFNumber.of(meta.height ?? 0))
    newDict.set(PDFName.of('Length'), PDFNumber.of(reencoded.length))
    newDict.delete(PDFName.of('SMask')) // none here; guard against a stale alpha mask
    newDict.delete(PDFName.of('DecodeParms'))
    doc.context.assign(image.ref, PDFRawStream.of(newDict, reencoded))

    const slimmed = await doc.save()

    // (1) Smaller.
    expect(slimmed.length).toBeLessThan(original.length)

    // (2) Still a valid PDF with the same structure.
    const reloaded = await PDFDocument.load(slimmed)
    expect(reloaded.getPageCount()).toBe(1)
    const reloadedImages = findImages(reloaded)
    expect(reloadedImages.length).toBe(1)
    expect(reloadedImages[0]?.width).toBe(meta.width)

    // (3) The swapped image really is the smaller JPEG (decodes, and is much smaller than the source).
    const swappedBytes = Buffer.from(reloadedImages[0]?.stream.contents ?? new Uint8Array())
    expect(swappedBytes.length).toBeLessThan(originalJpeg.length)
    const check = await sharp(swappedBytes).metadata()
    expect(check.format).toBe('jpeg')
    expect(check.width).toBe(meta.width)
  })
})
