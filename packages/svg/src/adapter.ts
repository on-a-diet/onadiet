/**
 * The SVG {@link FormatAdapter} — `detect` · `weigh` · `slim`.
 *
 * A **vector** pipeline: no raster, no SSIM floor, no downscale. `slim` runs svgo at a plan-derived
 * aggressiveness (see {@link optimizeSvg}) and applies the same honest safety guards as the other adapters —
 * never write a bigger file, keep the original when it can't be beaten, refuse non-SVG input with a typed
 * error. Because SVG optimization is deterministic and fast, there's no size-search — one optimize pass per
 * plan, then the guards.
 */
import { OnadietError, resolvePlan, throwIfAborted } from '@onadiet/core'
import type {
  DietPlan,
  FormatAdapter,
  OnadietErrorCode,
  SlimRequest,
  SlimResult,
  Weight,
} from '@onadiet/core'
import { optimizeSvg } from './optimize'

const SNIFF_BYTES = 65_536
const decoder = new TextDecoder('utf-8', { fatal: false }) // lenient: detect/weigh only sniff, never rewrite
const strictDecoder = new TextDecoder('utf-8', { fatal: true }) // slim: throw on non-UTF-8, don't corrupt
const encoder = new TextEncoder()

/**
 * Magic-sniff for SVG: it's text, so decode a prefix, skip any leading XML declaration / DOCTYPE / comments,
 * and require the FIRST real element to be `<svg>`. Requiring it be *first* (not merely present) rejects an
 * HTML/XHTML document that embeds an `<svg>`; skipping the prolog means a valid SVG behind a large license
 * comment still detects. Not a full XML parse — `slim`/`weigh` do the real parse (via svgo) and fail
 * honestly if the markup is malformed. A leading prolog longer than the sniff window reads as non-SVG.
 */
export function looksLikeSvg(input: Uint8Array): boolean {
  if (input.length === 0) return false
  // TextDecoder('utf-8') strips a leading BOM; trim the rest of the leading whitespace ourselves.
  let s = decoder.decode(input.subarray(0, SNIFF_BYTES)).trimStart()
  for (;;) {
    if (s.startsWith('<?')) {
      const end = s.indexOf('?>')
      if (end < 0) return false
      s = s.slice(end + 2).trimStart()
    } else if (s.startsWith('<!--')) {
      const end = s.indexOf('-->')
      if (end < 0) return false
      s = s.slice(end + 3).trimStart()
    } else if (/^<!doctype/i.test(s)) {
      // A DOCTYPE may carry an internal subset in [...]; its real end is the '>' after any ']'.
      const bracket = s.indexOf('[')
      const gt = s.indexOf('>')
      if (gt < 0) return false
      if (bracket >= 0 && bracket < gt) {
        const close = s.indexOf(']>', bracket)
        if (close < 0) return false
        s = s.slice(close + 2).trimStart()
      } else {
        s = s.slice(gt + 1).trimStart()
      }
    } else {
      break
    }
  }
  return /^<svg[\s/>]/i.test(s) // the first real element must be an <svg> root
}

function detect(input: Uint8Array): boolean {
  return looksLikeSvg(input)
}

/** The `WxH` of an SVG from its width/height attrs, else its viewBox, else `null`. Cheap regex, no parse. */
function parseDimensions(svg: string): string | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ''
  const w = /\bwidth\s*=\s*["']?([\d.]+)/i.exec(open)?.[1]
  const h = /\bheight\s*=\s*["']?([\d.]+)/i.exec(open)?.[1]
  if (w !== undefined && h !== undefined) return `${w}×${h}`
  const vb = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(open)?.[1]
  if (vb !== undefined) {
    const parts = vb.trim().split(/[\s,]+/)
    if (parts.length === 4) return `${parts[2]}×${parts[3]} (viewBox)`
  }
  return null
}

async function weigh(input: Uint8Array): Promise<Weight> {
  if (!looksLikeSvg(input)) {
    throw new OnadietError('UNSUPPORTED_INPUT', 'Not an SVG (expected an <svg> root element).')
  }
  const text = decoder.decode(input)
  const dims = parseDimensions(text)
  const elements = (text.match(/<[a-zA-Z]/g) ?? []).length
  const shape = dims !== null ? `${dims} svg` : 'svg'
  const label = `${shape}, ${elements} element${elements === 1 ? '' : 's'}`
  return { bytes: input.length, causes: [{ label, bytes: input.length }] }
}

async function slim(input: Uint8Array, request: SlimRequest): Promise<SlimResult> {
  if (!looksLikeSvg(input)) {
    return fail('UNSUPPORTED_INPUT', 'Not an SVG (expected an <svg> root element).')
  }
  const spec = resolvePlan(request.plan)

  // Already small enough? Keep the original untouched (never rewrite for nothing).
  if (request.targetBytes !== undefined && input.length <= request.targetBytes) {
    return keptOriginal(input.length, spec.plan, 'already under target')
  }

  // Decode STRICTLY: the round-trip re-encodes as UTF-8, so a lenient decode of a non-UTF-8 SVG (a declared
  // ISO-8859-1 / Windows-1252 file, say) would silently replace every non-ASCII byte with U+FFFD and ship a
  // smaller-but-corrupted result as a "win" — violating the never-silently-corrupt invariant. Refuse honestly
  // instead; re-saving as UTF-8 is the fix. (detect/weigh stay lenient — they don't rewrite bytes.)
  let svgText: string
  try {
    svgText = strictDecoder.decode(input)
  } catch {
    return fail(
      'UNSUPPORTED_INPUT',
      'SVG is not valid UTF-8 (a legacy/declared non-UTF-8 encoding). Re-save it as UTF-8 and try again.',
    )
  }

  let output: Uint8Array
  try {
    throwIfAborted(request.signal) // svgo is one fast pass, but honour cancellation before spending it
    output = encoder.encode(optimizeSvg(svgText, spec.plan))
  } catch (error) {
    if (error instanceof OnadietError) return fail(error.code, error.message)
    const message = error instanceof Error ? error.message : String(error)
    return fail('UNSUPPORTED_INPUT', `Could not optimize SVG: ${message}`)
  }

  // Never write a bigger file — an already-minified SVG can't be beaten; keep it.
  if (output.length >= input.length) {
    return keptOriginal(input.length, spec.plan, 'already optimized — nothing to trim')
  }

  // Target mode: SVG has no perceptual floor, so a plan is either enough or it isn't. If this plan's
  // optimize doesn't reach the target, refuse honestly and point at a more aggressive plan.
  if (request.targetBytes !== undefined && output.length > request.targetBytes) {
    return fail(
      'TARGET_INFEASIBLE',
      `${spec.plan} optimizes this SVG to ~${output.length} bytes, over the ${request.targetBytes}-byte ` +
        `target. Try a more aggressive plan (keto/crash) — SVG can only shrink so far.`,
    )
  }

  return {
    outcome: {
      ok: true,
      inputBytes: input.length,
      outputBytes: output.length,
      plan: spec.plan,
      method: describe(spec.plan),
      keptOriginal: false,
    },
    output,
  }
}

/** A human note on what the plan does — cleanse is genuinely lossless; the rest reduce number precision. */
function describe(plan: DietPlan): string {
  if (plan === 'cleanse')
    return 'svgo cleanse (rendering-identical: cruft removed, geometry untouched)'
  return `svgo ${plan}`
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

/** The SVG format adapter. */
export const svgAdapter: FormatAdapter = {
  kind: 'svg',
  detect,
  weigh,
  slim,
}
