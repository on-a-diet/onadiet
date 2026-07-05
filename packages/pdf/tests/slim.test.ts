import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import type { DietPlan } from '@onadiet/core'
import { pdfAdapter } from '../src/index'
import { findImages } from '../src/pdf-images'
import {
  bigJpeg,
  grayJpeg,
  makePdfWithImage,
  makePdfWithImages,
  makePdfWithSMaskedImage,
  makeSignedPdf,
  makeTextPdf,
  photoJpeg,
} from './helpers'

/** A one-page PDF dominated by an embedded noise JPEG (hardest to compress; kept modest for CI speed). */
const imageHeavyPdf = async (): Promise<Uint8Array> => makePdfWithImage(await bigJpeg(900, 900))
/** A one-page PDF with a compressible gradient image (a slim is feasible within a quality floor). */
const photoPdf = async (): Promise<Uint8Array> => makePdfWithImage(await photoJpeg(900, 900))

describe('pdfAdapter.slim — happy path', () => {
  it('hits an aggressive byte target (floorless), stays smaller, keeps a valid PDF', async () => {
    const input = await imageHeavyPdf()
    const target = Math.floor(input.length / 3)
    const result = await pdfAdapter.slim(input, { plan: 'crash', targetBytes: target })

    expect(result.outcome.ok).toBe(true)
    expect(result.output).not.toBeNull()
    const output = result.output as Uint8Array
    expect(output.length).toBeLessThanOrEqual(target)
    expect(output.length).toBeLessThan(input.length)
    if (result.outcome.ok) {
      expect(result.outcome.keptOriginal).toBe(false)
      expect(result.outcome.outputBytes).toBe(output.length)
    }

    // Output is a valid PDF with the page preserved and a smaller embedded image.
    const reloaded = await PDFDocument.load(output)
    expect(reloaded.getPageCount()).toBe(1)
    const before = findImages(await PDFDocument.load(input))[0]?.bytes ?? 0
    const after = findImages(reloaded)[0]?.bytes ?? 0
    expect(after).toBeLessThan(before)
  })

  it('slims a compressible image plan-only while holding a real quality floor', async () => {
    const input = await photoPdf()
    const result = await pdfAdapter.slim(input, { plan: 'balanced' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).not.toBeNull()
    expect((result.output as Uint8Array).length).toBeLessThan(input.length)
  })

  it('a lower quality floor lets it go smaller than a strict floor (the floor really binds)', async () => {
    const input = await photoPdf()
    const strict = await pdfAdapter.slim(input, { plan: 'lowcarb' }) // floor 0.96
    const loose = await pdfAdapter.slim(input, { plan: 'crash' }) // floor 0
    const strictLen = (strict.output as Uint8Array).length
    const looseLen = (loose.output as Uint8Array).length
    expect(strictLen).toBeLessThan(input.length)
    expect(looseLen).toBeLessThan(strictLen)
  })

  it('slims a grayscale image and keeps it grayscale (DeviceGray path)', async () => {
    const input = await makePdfWithImage(await grayJpeg(800, 800))
    const result = await pdfAdapter.slim(input, {
      plan: 'crash',
      targetBytes: Math.floor(input.length / 2),
    })
    expect(result.outcome.ok).toBe(true)
    const output = result.output as Uint8Array
    expect(output.length).toBeLessThan(input.length)
    const image = findImages(await PDFDocument.load(output))[0]
    const meta = await sharp(Buffer.from(image?.stream.contents ?? new Uint8Array())).metadata()
    expect(meta.channels).toBe(1) // still grayscale, not ballooned to RGB
  })

  it('slims every image in a multi-image PDF', async () => {
    const input = await makePdfWithImages([await photoJpeg(700, 700), await photoJpeg(600, 800)])
    const before = findImages(await PDFDocument.load(input)).map((i) => i.bytes)
    const result = await pdfAdapter.slim(input, {
      plan: 'crash',
      targetBytes: Math.floor(input.length / 3),
    })
    expect(result.outcome.ok).toBe(true)
    if (result.outcome.ok) expect(result.outcome.method).toMatch(/re-encoded 2 images/)
    const after = findImages(await PDFDocument.load(result.output as Uint8Array)).map(
      (i) => i.bytes,
    )
    expect(after).toHaveLength(2)
    expect(after[0]).toBeLessThan(before[0] ?? 0)
    expect(after[1]).toBeLessThan(before[1] ?? 0)
  })
})

describe('pdfAdapter.slim — cancellation', () => {
  it('returns an honest ABORTED (not a throw) when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const result = await pdfAdapter.slim(await photoPdf(), { plan: 'balanced', signal: ac.signal })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('ABORTED')
    expect(result.output).toBeNull()
  })
})

describe('pdfAdapter.slim — safety guards', () => {
  it('refuses a signed PDF by default', async () => {
    const input = await makeSignedPdf(await bigJpeg(800, 800))
    const result = await pdfAdapter.slim(input, { plan: 'balanced', targetBytes: 1000 })
    expect(result.outcome.ok).toBe(false)
    expect(result.output).toBeNull()
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('SIGNED_PDF')
  })

  it('proceeds on a signed PDF when allowSigned is set', async () => {
    const input = await makeSignedPdf(await photoJpeg(1200, 1200))
    const result = await pdfAdapter.slim(input, {
      plan: 'crash',
      targetBytes: Math.floor(input.length / 2),
      allowSigned: true,
    })
    // Not refused for being signed — the floorless crash plan should actually slim it.
    expect(result.outcome.ok).toBe(true)
    expect(result.output).not.toBeNull()
  })

  it('refuses a non-PDF with UNSUPPORTED_INPUT (no throw)', async () => {
    const result = await pdfAdapter.slim(new TextEncoder().encode('not a pdf'), {
      plan: 'balanced',
    })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('UNSUPPORTED_INPUT')
  })

  it('refuses an encrypted PDF with ENCRYPTED_PDF', async () => {
    vi.spyOn(PDFDocument, 'load').mockResolvedValue({ isEncrypted: true } as unknown as PDFDocument)
    const header = new TextEncoder().encode('%PDF-1.7\n%%EOF')
    const result = await pdfAdapter.slim(header, { plan: 'balanced' })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('ENCRYPTED_PDF')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

describe('pdfAdapter.slim — honest non-success', () => {
  it('reports TARGET_INFEASIBLE when the target is unreachable within the floor', async () => {
    const input = await imageHeavyPdf()
    const result = await pdfAdapter.slim(input, { plan: 'lowcarb', targetBytes: 1024 })
    expect(result.outcome.ok).toBe(false)
    expect(result.output).toBeNull()
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('TARGET_INFEASIBLE')
  })

  it('keeps the original when already under target', async () => {
    const input = await imageHeavyPdf()
    const result = await pdfAdapter.slim(input, { plan: 'balanced', targetBytes: input.length * 2 })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull() // nothing to write
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })

  it('keeps a text-only PDF (nothing to slim) in plan-only mode', async () => {
    const result = await pdfAdapter.slim(await makeTextPdf(), { plan: 'balanced' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })

  it('is infeasible for a target on a PDF with no slimmable images', async () => {
    const input = await makeTextPdf()
    const result = await pdfAdapter.slim(input, { plan: 'balanced', targetBytes: 100 })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('TARGET_INFEASIBLE')
  })

  it('skips an image with a soft mask rather than corrupting its transparency', async () => {
    const input = await makePdfWithSMaskedImage(await photoJpeg(800, 800))
    const result = await pdfAdapter.slim(input, { plan: 'crash' })
    // The only image carries an /SMask → not slimmable → nothing to slim → original kept untouched.
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })

  it('reports a receipt method describing what was done', async () => {
    const input = await photoPdf()
    const result = await pdfAdapter.slim(input, {
      plan: 'crash',
      targetBytes: Math.floor(input.length / 2),
    })
    expect(result.outcome.ok).toBe(true)
    if (result.outcome.ok) expect(result.outcome.method).toMatch(/re-encoded 1 image: q\d+/)
  })
})

describe('pdfAdapter.slim — invalid request returns a failure (never throws)', () => {
  it('maps an out-of-range floor to a typed failure', async () => {
    const input = await photoPdf()
    const result = await pdfAdapter.slim(input, { plan: 'balanced', floor: 1.5 })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('INVALID_SIZE')
  })

  it('maps an unknown plan to a typed failure', async () => {
    const input = await photoPdf()
    const result = await pdfAdapter.slim(input, { plan: 'bogus' as DietPlan })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('UNKNOWN_PLAN')
  })
})
