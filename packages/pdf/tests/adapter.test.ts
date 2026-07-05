import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnadietError } from '@onadiet/core'
import { PDFDocument } from 'pdf-lib'
import { pdfAdapter } from '../src/index'
import { runFormatAdapterConformance } from '@onadiet/testkit'
import { makePdfWithImage, photoJpeg } from './helpers'

// Compressible gradient so the conformance slim actually slims (noise wouldn't hold the balanced floor).
const makeValid = async (): Promise<Uint8Array> => makePdfWithImage(await photoJpeg(400, 400))

runFormatAdapterConformance(
  'pdf',
  pdfAdapter,
  makeValid,
  new TextEncoder().encode('this is not a pdf'),
)

async function imageFreePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([100, 100])
  return doc.save()
}

describe('pdfAdapter.weigh', () => {
  it('attributes embedded image bytes', async () => {
    const weight = await pdfAdapter.weigh(await makeValid())
    const images = weight.causes.find((c) => c.label === 'embedded images')
    expect(images?.bytes).toBeGreaterThan(0)
  })

  it('reports an image-free PDF as all-other', async () => {
    const weight = await pdfAdapter.weigh(await imageFreePdf())
    expect(weight.causes.find((c) => c.label === 'embedded images')?.bytes).toBe(0)
    expect(weight.causes.find((c) => c.label.startsWith('other'))?.bytes).toBe(weight.bytes)
  })
})

describe('pdfAdapter.detect', () => {
  it('detects a header after leading junk', () => {
    expect(pdfAdapter.detect(new TextEncoder().encode('\n\n   %PDF-1.7 rest'))).toBe(true)
  })

  it('does not detect a look-alike header', () => {
    expect(pdfAdapter.detect(new TextEncoder().encode('%PDX-1.7'))).toBe(false)
  })

  it('does not detect empty input', () => {
    expect(pdfAdapter.detect(new Uint8Array())).toBe(false)
  })
})

describe('pdfAdapter.weigh — error mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const header = (): Uint8Array => new TextEncoder().encode('%PDF-1.7\n%%EOF') // passes detect

  it('rejects a non-PDF with UNSUPPORTED_INPUT (typed)', async () => {
    const bytes = new TextEncoder().encode('nope')
    await expect(pdfAdapter.weigh(bytes)).rejects.toBeInstanceOf(OnadietError)
    await expect(pdfAdapter.weigh(bytes)).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' })
  })

  it('maps an encrypted PDF to ENCRYPTED_PDF (via the isEncrypted flag, not the broken error class)', async () => {
    // pdf-lib loads encrypted docs with ignoreEncryption and sets isEncrypted=true; we detect that.
    vi.spyOn(PDFDocument, 'load').mockResolvedValue({ isEncrypted: true } as unknown as PDFDocument)
    await expect(pdfAdapter.weigh(header())).rejects.toMatchObject({ code: 'ENCRYPTED_PDF' })
  })

  it('maps a generic parse failure to UNSUPPORTED_INPUT', async () => {
    vi.spyOn(PDFDocument, 'load').mockRejectedValue(new Error('corrupt xref'))
    await expect(pdfAdapter.weigh(header())).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' })
  })

  it('does not throw a raw error even if load rejects with a non-Error', async () => {
    vi.spyOn(PDFDocument, 'load').mockRejectedValue('a string, not an Error')
    await expect(pdfAdapter.weigh(header())).rejects.toBeInstanceOf(OnadietError)
  })
})
