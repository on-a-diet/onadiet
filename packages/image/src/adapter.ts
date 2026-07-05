/**
 * The standalone-image {@link FormatAdapter} — `detect` · `weigh` · `slim`.
 *
 * `slim` composes the pure `@onadiet/core` SizeSearch over a single image, run **once per candidate output
 * format**, then picks the best result across formats — the format-switch lever (WebP/AVIF are valid outputs
 * for a standalone file, unlike inside a PDF). Behind the safety guards: never write a bigger file, don't
 * silently drop alpha, refuse animated/unsupported inputs.
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
  Candidate,
  DietPlan,
  FormatAdapter,
  ImageFormat,
  OnadietErrorCode,
  SearchResult,
  SlimRequest,
  SlimResult,
  Weight,
} from '@onadiet/core'
import sharp from 'sharp'
import { sharpImageCodec, MAX_INPUT_PIXELS } from './image-codec'
import { buildFormatLevers, type ImageFormatLever } from './levers'

/** Magic-byte signatures — sniff the header, don't trust the extension. */
function detect(input: Uint8Array): boolean {
  return sniffImageFormat(input) !== null
}

/** The container format of `input` by magic bytes, or `null` if it isn't a supported raster image. */
export function sniffImageFormat(input: Uint8Array): ImageFormat | null {
  const b = input
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'png'
  }
  if (b.length >= 12 && ascii(b, 0) === 'RIFF' && ascii(b, 8) === 'WEBP') return 'webp'
  if (b.length >= 12 && ascii(b, 4) === 'ftyp' && isAvifFtyp(b)) return 'avif'
  return null
}

/**
 * An ISO-BMFF `ftyp` box declares an AVIF if its major brand is `avif`/`avis`, OR (common in the wild) its
 * major brand is `mif1`/`msf1` with `avif` among the compatible brands. Scan the brand list within the box.
 */
function isAvifFtyp(b: Uint8Array): boolean {
  const major = ascii(b, 8)
  if (major === 'avif' || major === 'avis') return true
  if (major !== 'mif1' && major !== 'msf1') return false
  const boxSize = Math.min((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!, b.length)
  // Compatible brands are 4-byte tags starting at offset 16 (after major brand + minor version).
  for (let at = 16; at + 4 <= boxSize; at += 4) {
    if (ascii(b, at) === 'avif' || ascii(b, at) === 'avis') return true
  }
  return false
}

function ascii(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!)
}

async function weigh(input: Uint8Array): Promise<Weight> {
  if (sniffImageFormat(input) === null) {
    throw new OnadietError('UNSUPPORTED_INPUT', 'Not a supported image (JPEG/PNG/WebP/AVIF).')
  }
  let meta
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new OnadietError('UNSUPPORTED_INPUT', `Could not read image: ${message}`)
  }
  const shape = `${meta.width ?? 0}×${meta.height ?? 0} ${meta.format ?? 'image'}`
  const alpha = meta.hasAlpha ? ' (alpha)' : ''
  const content = (await estimateContent(input)) === 'photo' ? 'photo-like' : 'flat/graphic'
  return {
    bytes: input.length,
    causes: [{ label: `${shape}${alpha}, ${content}`, bytes: input.length }],
  }
}

/** A cheap photo-vs-flat estimate from a downsampled entropy read (deterministic, no ML). */
async function estimateContent(input: Uint8Array): Promise<'photo' | 'flat'> {
  try {
    // .stats() forces a full decode — apply the same pixel cap as the codec so a crafted bomb can't slip
    // through the `weigh` path at sharp's looser default.
    const { entropy } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize(256, 256, { fit: 'inside' })
      .stats()
    return entropy >= 4.5 ? 'photo' : 'flat'
  } catch {
    return 'photo' // if stats fail, don't bias toward lossless
  }
}

async function slim(input: Uint8Array, request: SlimRequest): Promise<SlimResult> {
  const inputFormat = sniffImageFormat(input)
  if (inputFormat === null) {
    return fail('UNSUPPORTED_INPUT', 'Not a supported image (expected JPEG, PNG, WebP, or AVIF).')
  }

  try {
    throwIfAborted(request.signal) // bail promptly if already cancelled, before any decode
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    if ((meta.pages ?? 1) > 1) {
      return fail('UNSUPPORTED_INPUT', 'Animated/multi-frame images are not supported in v0.2.')
    }
    const hasAlpha = meta.hasAlpha === true

    const spec = resolvePlan(request.plan)
    const ladder = ladderForPlan(spec)
    const floor = request.floor ?? provisionalFloor(spec)
    const constraints = {
      floor,
      ...(request.targetBytes !== undefined ? { targetBytes: request.targetBytes } : {}),
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
      ...(request.fast === true ? { fast: true } : {}),
    }

    // Already under the target? Keep the original untouched.
    if (request.targetBytes !== undefined && input.length <= request.targetBytes) {
      return keptOriginal(input.length, spec.plan, 'already under target')
    }

    // cleanse is lossless-only. v0.2 has no lossless re-optimization (oxipng/jpegtran) yet, so it makes no
    // change — say so honestly rather than run an empty ladder and report a misleading "nothing beat it".
    if (spec.plan === 'cleanse') {
      if (request.targetBytes !== undefined) {
        return fail(
          'TARGET_INFEASIBLE',
          'cleanse is lossless and makes no changes in v0.2, so it can’t reach a byte target ' +
            '(lossless re-optimization is deferred). Try --plan balanced/lowcarb/keto.',
        )
      }
      return keptOriginal(
        input.length,
        spec.plan,
        'cleanse is lossless — no re-optimization in v0.2',
      )
    }

    const formats = candidateFormats(inputFormat, hasAlpha, spec.plan, request.format)
    const levers = await buildFormatLevers(input, formats, sharpImageCodec, ssimMetric)

    // Search each candidate format for its floor-holding minimum. The formats are independent — each has its
    // own lever with a private encode cache, and the one-time source decode they share (raster + SSIM
    // reference) is read-only — so searching them CONCURRENTLY is a pure latency win with an identical winner.
    // Serialized, AVIF's slow search stacks on top of WebP/JPEG (the `--format auto` / keto / crash hot spot
    // the perf harness measured, ~9-20 s); overlapped, the total drops to ≈ the slowest single format
    // (measured ~1.6×). Native concurrency is still bounded by libuv's encode threadpool.
    const searchOneFormat = async (lever: ImageFormatLever): Promise<FormatRun | null> => {
      try {
        return { lever, result: await searchSize([lever.lever], 0, ladder, constraints) }
      } catch (error) {
        // A cancellation must NOT be mistaken for a codec that can't encode this input — re-throw it so the
        // outer catch maps it to an honest ABORTED (otherwise every format's search re-aborts and gets
        // swallowed → a misleading "no format could encode this image").
        if (error instanceof OnadietError && error.code === 'ABORTED') throw error
        // else: this output format couldn't encode this image — drop it so a surviving format can still win.
        return null
      }
    }
    // Concurrent formats raise peak memory (each holds an in-flight encode/decode pipeline over the shared
    // decode), bounded by the format count (≤~4). A caller that ALREADY parallelizes at a higher level — the
    // folder runner, which fans out across files — passes `serialFormats` so a multi-format slim doesn't
    // multiply the in-flight raster pipelines and blow the folder's ~concurrency memory bound; there it's
    // serial-per-file (the file pool fills the cores anyway). Single-format plans (`balanced`/`lowcarb`
    // keep-format) have one lever, so both branches are identical + memory-unchanged from before.
    const settled = request.serialFormats
      ? await sequentialMap(levers, searchOneFormat)
      : await Promise.all(levers.map(searchOneFormat))
    // Preserve the original (candidateFormats) order so the winner tie-break stays byte-for-byte deterministic.
    const runs: FormatRun[] = settled.filter((run): run is FormatRun => run !== null)
    if (runs.length === 0) {
      return fail('UNSUPPORTED_INPUT', 'No candidate output format could encode this image.')
    }

    const winner = chooseWinner(runs, request.targetBytes)
    if (winner.kind === 'kept') {
      return keptOriginal(input.length, spec.plan, 'nothing beat the original within the floor')
    }
    if (winner.kind === 'floor-hit') {
      return fail(
        'TARGET_INFEASIBLE',
        `Smallest without dropping below the ${spec.plan} quality floor is ~${winner.smallest} bytes. ` +
          `Try a more aggressive plan (keto/crash), a lower floor (--force), ${
            request.format === 'auto' || request.format === undefined
              ? 'or a higher target.'
              : 'a different --format (or --format auto), or a higher target.'
          }`,
      )
    }
    if (winner.kind === 'infeasible') {
      return fail(
        'TARGET_INFEASIBLE',
        `Can't reach the target even at this plan's most aggressive settings (smallest ~${winner.smallest} bytes).`,
      )
    }

    // winner.kind === 'ok' — reuse the exact bytes the search chose (no re-encode) and apply the guards.
    const output = await winner.run.lever.encodedFor(winner.chosen.params)
    if (output.length >= input.length) {
      return keptOriginal(input.length, spec.plan, 'result was not smaller')
    }
    if (request.targetBytes !== undefined && output.length > request.targetBytes) {
      return fail(
        'TARGET_INFEASIBLE',
        `Best result ${output.length} bytes is still over the ${request.targetBytes}-byte target.`,
      )
    }

    const chosenFormat = winner.run.lever.format
    return {
      outcome: {
        ok: true,
        inputBytes: input.length,
        outputBytes: output.length,
        plan: spec.plan,
        method: describe(winner.chosen, chosenFormat, inputFormat, hasAlpha),
        keptOriginal: false,
      },
      output,
    }
  } catch (error) {
    if (error instanceof OnadietError) return fail(error.code, error.message)
    const message = error instanceof Error ? error.message : String(error)
    return fail('UNSUPPORTED_INPUT', `Could not slim image: ${message}`)
  }
}

interface FormatRun {
  readonly lever: ImageFormatLever
  readonly result: SearchResult
}

/** Map `items` to results ONE AT A TIME, preserving order — the serial counterpart to `Promise.all` (used
 * when the caller already parallelizes at a higher level and must not multiply in-flight work). */
async function sequentialMap<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (const item of items) out.push(await fn(item))
  return out
}

type Winner =
  | { kind: 'ok'; run: FormatRun; chosen: Candidate }
  | { kind: 'floor-hit'; smallest: number }
  | { kind: 'infeasible'; smallest: number }
  | { kind: 'kept' }

/**
 * Pick the best format run. Target mode: among formats that hit the target, the highest-quality result
 * (tie-break smaller); else the honest floor-hit/infeasible verdict with the smallest achievable size.
 * Plan-only mode: the smallest floor-holding result across formats (or keep-original if none beat it).
 */
function chooseWinner(runs: readonly FormatRun[], targetBytes: number | undefined): Winner {
  const chosenOf = (r: FormatRun): Candidate | null => r.result.decisions[0]?.chosen ?? null

  if (targetBytes !== undefined) {
    const winners = runs.filter((r) => r.result.outcome === 'under-target' && chosenOf(r) !== null)
    if (winners.length > 0) {
      const best = winners.reduce((a, b) => pickBetterQuality(a, b, chosenOf))
      return { kind: 'ok', run: best, chosen: chosenOf(best)! }
    }
    const smallest = Math.min(...runs.map((r) => r.result.totalBytes))
    const floorHit = runs.some((r) => r.result.outcome === 'infeasible-floor-hit')
    return floorHit ? { kind: 'floor-hit', smallest } : { kind: 'infeasible', smallest }
  }

  // Plan-only: smallest result that actually beat the original.
  const made = runs.filter((r) => chosenOf(r) !== null)
  if (made.length === 0) return { kind: 'kept' }
  const best = made.reduce((a, b) => (chosenOf(b)!.bytes < chosenOf(a)!.bytes ? b : a))
  return { kind: 'ok', run: best, chosen: chosenOf(best)! }
}

/** Higher SSIM wins; equal quality → smaller bytes. */
function pickBetterQuality(
  a: FormatRun,
  b: FormatRun,
  chosenOf: (r: FormatRun) => Candidate | null,
): FormatRun {
  const ca = chosenOf(a)!
  const cb = chosenOf(b)!
  if (cb.quality > ca.quality) return b
  if (cb.quality < ca.quality) return a
  return cb.bytes < ca.bytes ? b : a
}

/**
 * Which output formats to try, from the policy: an explicit `--format` forces one; `keep` (default) holds the
 * input format unless the plan is aggressive; `auto` (or keto/crash) tries the efficient formats compatible
 * with the source's alpha, plus the input format so keeping is always in the running.
 */
function candidateFormats(
  inputFormat: ImageFormat,
  hasAlpha: boolean,
  plan: DietPlan,
  request: SlimRequest['format'],
): ImageFormat[] {
  const req = request ?? 'keep'
  if (req !== 'keep' && req !== 'auto') return [req] // explicit format
  const auto = req === 'auto' || plan === 'keto' || plan === 'crash'
  if (!auto) return [inputFormat] // keep-format

  const set = new Set<ImageFormat>(['webp', 'avif', inputFormat])
  if (hasAlpha) set.add('png')
  else set.add('jpeg')
  if (hasAlpha) set.delete('jpeg') // JPEG can't preserve transparency — excluded from auto when alpha
  return [...set]
}

function describe(
  chosen: Candidate,
  chosenFormat: ImageFormat,
  inputFormat: ImageFormat,
  hadAlpha: boolean,
): string {
  const scale = chosen.params.scale < 1 ? ` @${Math.round(chosen.params.scale * 100)}%` : ''
  const q = chosenFormat === 'png' ? 'lossless' : `q${chosen.params.quality}`
  const from = chosenFormat !== inputFormat ? ` (from ${inputFormat})` : ''
  const flat = chosenFormat === 'jpeg' && hadAlpha ? ' (alpha flattened to white)' : ''
  return `${chosenFormat} ${q}${scale}${from}${flat}`
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

/** The standalone-image format adapter. */
export const imageAdapter: FormatAdapter = {
  kind: 'image',
  detect,
  weigh,
  slim,
}
