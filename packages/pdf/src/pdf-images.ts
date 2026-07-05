/**
 * Low-level pdf-lib helpers for finding, describing, and replacing embedded image XObjects, plus signature
 * detection. The pdf-lib object-model details live here so the adapter/levers stay readable.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFDocument,
  type PDFRef,
} from 'pdf-lib'

/** One embedded image: its indirect ref, its stream, the encoded byte size it occupies, and dimensions. */
export interface PdfImage {
  readonly ref: PDFRef
  readonly stream: PDFRawStream
  /** Encoded bytes the image contributes to the file. */
  readonly bytes: number
  readonly width: number
  readonly height: number
  /**
   * Safe to re-encode in v0.1: a plain DCTDecode (JPEG) image in a Device gray/RGB colorspace with no
   * soft-mask, color-key mask, or `/Decode` remap. Anything else is left untouched — re-encoding it would
   * risk silent corruption (lost transparency, inverted colors, colorspace shift).
   */
  readonly slimmable: boolean
}

/** Every image XObject in the document. */
export function findImages(doc: PDFDocument): PdfImage[] {
  const images: PdfImage[] = []
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (obj.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue
    images.push({
      ref,
      stream: obj,
      bytes: obj.contents.length,
      width: numberEntry(obj, 'Width'),
      height: numberEntry(obj, 'Height'),
      slimmable: isSimplySlimmable(obj),
    })
  }
  return images
}

/** Total encoded bytes across all embedded images. */
export function imageByteTotal(doc: PDFDocument): number {
  let total = 0
  for (const image of findImages(doc)) total += image.bytes
  return total
}

/**
 * Replace an image XObject in place with new JPEG (DCTDecode) bytes — the pattern proven by the capability
 * probe. Clones the original dict (preserving unrelated keys) and fixes dimensions/length/colorspace. Only
 * called on {@link PdfImage.slimmable} images, so there is no live SMask/Mask/Decode to worry about; we drop
 * those keys defensively anyway.
 */
export function replaceImageWithJpeg(
  doc: PDFDocument,
  image: PdfImage,
  jpegBytes: Uint8Array,
  width: number,
  height: number,
  channels: number,
): void {
  const dict = image.stream.dict.clone(doc.context)
  dict.set(PDFName.of('Width'), PDFNumber.of(width))
  dict.set(PDFName.of('Height'), PDFNumber.of(height))
  dict.set(PDFName.of('Length'), PDFNumber.of(jpegBytes.length))
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
  dict.set(PDFName.of('ColorSpace'), PDFName.of(channels === 1 ? 'DeviceGray' : 'DeviceRGB'))
  dict.delete(PDFName.of('SMask'))
  dict.delete(PDFName.of('DecodeParms'))
  dict.delete(PDFName.of('Decode'))
  doc.context.assign(image.ref, PDFRawStream.of(dict, jpegBytes))
}

/**
 * Does the document carry a digital signature? Fail-safe (refuse when unsure): the AcroForm `SigFlags`
 * SignaturesExist bit, OR any AcroForm field of type `/Sig` (some producers omit `SigFlags`), OR a
 * certification `/Perms` entry. A re-save invalidates all of these, so the adapter refuses unless `allowSigned`.
 */
export function hasSignature(doc: PDFDocument): boolean {
  // lookupMaybe (not lookup(key, type)) — the two-arg lookup THROWS when the key is absent.
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  if (acroForm) {
    const sigFlags = acroForm.lookupMaybe(PDFName.of('SigFlags'), PDFNumber)
    if (sigFlags && (sigFlags.asNumber() & 1) !== 0) return true // SignaturesExist
    const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray)
    if (fields && fieldsContainSignature(fields, 0)) return true
  }
  return doc.catalog.lookupMaybe(PDFName.of('Perms'), PDFDict) !== undefined
}

/** Recursively scan AcroForm fields (and their `/Kids`) for a signature field. Depth-capped against cycles. */
function fieldsContainSignature(fields: PDFArray, depth: number): boolean {
  if (depth > 50) return false
  for (let i = 0; i < fields.size(); i += 1) {
    const field = fields.lookupMaybe(i, PDFDict)
    if (!field) continue
    if (field.lookup(PDFName.of('FT')) === PDFName.of('Sig')) return true
    const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray)
    if (kids && fieldsContainSignature(kids, depth + 1)) return true
  }
  return false
}

function numberEntry(stream: PDFRawStream, key: string): number {
  const value = stream.dict.lookup(PDFName.of(key))
  return value instanceof PDFNumber ? value.asNumber() : 0
}

/**
 * True only for images we can faithfully round-trip in v0.1: a single-filter DCTDecode stream, a Device
 * gray/RGB colorspace, and no soft-mask / color-key mask / `/Decode` remap. Chained filters, ICCBased/
 * Indexed/CMYK/Separation colorspaces, and masked or decode-remapped images are all excluded.
 */
function isSimplySlimmable(stream: PDFRawStream): boolean {
  const dict = stream.dict
  if (dict.lookup(PDFName.of('Filter')) !== PDFName.of('DCTDecode')) return false
  const cs = dict.lookup(PDFName.of('ColorSpace'))
  if (cs !== PDFName.of('DeviceRGB') && cs !== PDFName.of('DeviceGray')) return false
  return (
    dict.lookup(PDFName.of('SMask')) === undefined &&
    dict.lookup(PDFName.of('Mask')) === undefined &&
    dict.lookup(PDFName.of('Decode')) === undefined
  )
}
