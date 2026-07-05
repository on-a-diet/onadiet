/**
 * The PDF {@link FormatAdapter} — `detect` · `weigh` · `slim`.
 *
 * `slim` composes the pure `@onadiet/core` SizeSearch over per-image levers (sharp/mozjpeg re-encode + SSIM)
 * and applies the winners by replacing image XObjects in place (the pattern proven by the capability probe),
 * behind the safety guards: refuse encrypted, refuse signed unless opted in, and never write a bigger file.
 */
import {
  OnadietError,
  ladderForPlan,
  provisionalFloor,
  resolvePlan,
  searchSize,
  ssimMetric,
  throwIfAborted,
} from '@onadiet/core'
import type {
  DietPlan,
  EncodeParams,
  FormatAdapter,
  OnadietErrorCode,
  SlimRequest,
  SlimResult,
  Weight,
} from '@onadiet/core'
import { PDFDocument } from 'pdf-lib'
import { findImages, hasSignature, imageByteTotal, replaceImageWithJpeg } from './pdf-images'
import { buildImageLevers } from './levers'
import { sharpImageCodec } from './image-codec'

/** `%PDF-` may sit after a few bytes of leading junk; readers scan the head, so we do too. */
const HEADER = new TextEncoder().encode('%PDF-')
const HEADER_SCAN_WINDOW = 1024

function detect(input: Uint8Array): boolean {
  const limit = Math.min(input.length - HEADER.length, HEADER_SCAN_WINDOW)
  for (let start = 0; start <= limit; start += 1) {
    let matched = true
    for (let i = 0; i < HEADER.length; i += 1) {
      if (input[start + i] !== HEADER[i]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

/**
 * Parse a PDF, throwing a typed {@link OnadietError} for the not-a-PDF, unparseable, and encrypted cases.
 * Loads with `ignoreEncryption` because pdf-lib 1.17.1's `EncryptedPDFError` is broken (ES5 `extends Error`
 * yields a plain Error, so `instanceof`/name checks never match) — we detect encryption via `isEncrypted`.
 */
async function loadPdf(input: Uint8Array): Promise<PDFDocument> {
  if (!detect(input)) {
    throw new OnadietError('UNSUPPORTED_INPUT', 'Not a PDF (no %PDF- header).')
  }
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new OnadietError('UNSUPPORTED_INPUT', `Could not parse PDF: ${message}`)
  }
  if (doc.isEncrypted) {
    throw new OnadietError('ENCRYPTED_PDF', 'Encrypted/password-protected PDF.')
  }
  return doc
}

async function weigh(input: Uint8Array): Promise<Weight> {
  const doc = await loadPdf(input)
  // Sums encoded bytes of image XObjects. Inline images (BI/ID/EI in content streams) aren't XObjects, so
  // they fall into "other" — an accepted estimate for v0.1 (they're typically tiny).
  const total = input.length
  const images = imageByteTotal(doc)
  const other = Math.max(0, total - images)
  return {
    bytes: total,
    causes: [
      { label: 'embedded images', bytes: images },
      { label: 'other (structure, fonts, text)', bytes: other },
    ],
  }
}

async function slim(input: Uint8Array, request: SlimRequest): Promise<SlimResult> {
  let doc: PDFDocument
  try {
    doc = await loadPdf(input)
  } catch (error) {
    return errorToFail(error)
  }

  // Everything past load can throw (resolvePlan, searchSize validation, sharp, pdf-lib save) — keep the
  // "typed result, never a raw throw" contract by funnelling any escape into a DietFailure.
  try {
    throwIfAborted(request.signal) // bail promptly if already cancelled
    if (hasSignature(doc) && request.allowSigned !== true) {
      return fail(
        'SIGNED_PDF',
        'Signed PDF — re-saving would invalidate the signature. Pass allowSigned to override.',
      )
    }

    const spec = resolvePlan(request.plan)
    const ladder = ladderForPlan(spec)
    const floor = request.floor ?? provisionalFloor(spec)

    const pdfLevers = await buildImageLevers(
      findImages(doc),
      sharpImageCodec,
      ssimMetric,
      request.signal,
    )
    const slimmableBytes = pdfLevers.reduce((sum, lever) => sum + lever.image.bytes, 0)
    const fixedBytes = Math.max(0, input.length - slimmableBytes)
    const byId = new Map(pdfLevers.map((lever) => [lever.lever.id, lever]))

    const constraints = {
      floor,
      ...(request.targetBytes !== undefined ? { targetBytes: request.targetBytes } : {}),
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
      ...(request.fast === true ? { fast: true } : {}),
    }
    const result = await searchSize(
      pdfLevers.map((lever) => lever.lever),
      fixedBytes,
      ladder,
      constraints,
    )

    if (result.outcome === 'already-under') {
      return keptOriginal(input.length, spec.plan, 'already under target')
    }
    if (result.outcome === 'infeasible-floor-hit') {
      return fail(
        'TARGET_INFEASIBLE',
        `Smallest without dropping below the ${spec.plan} quality floor is ~${result.totalBytes} bytes. ` +
          `Try a more aggressive plan (keto/crash), a lower floor (--force), or a higher target.`,
      )
    }
    if (result.outcome === 'infeasible') {
      return fail(
        'TARGET_INFEASIBLE',
        `Can't reach the target even at this plan's most aggressive settings (smallest ~${result.totalBytes} bytes).`,
      )
    }

    // under-target or slimmed-plan-only: re-encode + re-embed each chosen image.
    const methods = new Set<string>()
    let applied = 0
    for (const decision of result.decisions) {
      const chosen = decision.chosen
      const lever = byId.get(decision.id)
      if (chosen === null || lever === undefined) continue
      throwIfAborted(request.signal) // the apply loop is a second bank of full encodes — stay cancellable
      const encoded = await sharpImageCodec.encode(lever.raster, chosen.params)
      const meta = await sharpImageCodec.decode(encoded)
      replaceImageWithJpeg(doc, lever.image, encoded, meta.width, meta.height, meta.channels)
      methods.add(describe(chosen.params))
      applied += 1
    }
    if (applied === 0) return keptOriginal(input.length, spec.plan, 'nothing to slim')

    // updateFieldAppearances:false so an (unsigned) form's field appearances aren't regenerated/altered.
    const output = await doc.save({ updateFieldAppearances: false })
    if (output.length >= input.length) {
      return keptOriginal(input.length, spec.plan, 'result was not smaller')
    }
    if (request.targetBytes !== undefined && output.length > request.targetBytes) {
      return fail(
        'TARGET_INFEASIBLE',
        `Best result ${output.length} bytes is still over the ${request.targetBytes}-byte target.`,
      )
    }

    return {
      outcome: {
        ok: true,
        inputBytes: input.length,
        outputBytes: output.length,
        plan: spec.plan,
        method: `re-encoded ${applied} image${applied === 1 ? '' : 's'}: ${[...methods].join(', ')}`,
        keptOriginal: false,
      },
      output,
    }
  } catch (error) {
    return errorToFail(error)
  }
}

function errorToFail(error: unknown): SlimResult {
  if (error instanceof OnadietError) return fail(error.code, error.message)
  const message = error instanceof Error ? error.message : String(error)
  return fail('UNSUPPORTED_INPUT', `Could not slim PDF: ${message}`)
}

function describe(params: EncodeParams): string {
  const scale = params.scale < 1 ? `@${Math.round(params.scale * 100)}%` : ''
  return `q${params.quality}${scale}`
}

function fail(reason: OnadietErrorCode, detail: string): SlimResult {
  return { outcome: { ok: false, reason, detail }, output: null }
}

function keptOriginal(inputBytes: number, plan: DietPlan, why: string): SlimResult {
  return {
    outcome: {
      ok: true,
      inputBytes,
      outputBytes: inputBytes,
      plan,
      method: `kept original (${why})`,
      keptOriginal: true,
    },
    output: null,
  }
}

/** The PDF format adapter. */
export const pdfAdapter: FormatAdapter = {
  kind: 'pdf',
  detect,
  weigh,
  slim,
}
