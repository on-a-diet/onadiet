/**
 * IMAGE GOLDEN CORPUS (v0.2 step B) — the raster size-search proven against real, non-synthetic images.
 *
 * The unit suites build small synthetic rasters; this one drives the actual {@link imageAdapter.slim}
 * pipeline over three genuine images spanning the content classes (see corpus/README.md) and asserts the
 * things the trust pitch rests on:
 *   1. a plan slims each image smaller and the output is a valid, decodable image (never bigger);
 *   2. the SSIM floors HOLD on real content, measured the same way the engine measures them (up-direction) —
 *      `lowcarb` stays visually-lossless (≥ its 0.96 floor) AND strictly higher-fidelity than `balanced` on a
 *      real photograph, where the floors actually bind (unlike palette-friendly graphics);
 *   3. an infeasible target is refused HONESTLY — the receipt names the QUALITY FLOOR as the binding
 *      constraint (a floor-hit), not the target;
 *   4. the plan floors bind MONOTONICALLY in bytes on real content (gentler plan ⇒ larger floor-limited
 *      minimum), across all three images;
 *   5. the format-switch lever pays off — `--format auto` on a flat PNG reaches a fraction of the
 *      keep-format minimum by switching to WebP/AVIF;
 *   6. a real RGBA export whose alpha is fully opaque slims to a valid smaller image (the redundant channel
 *      is handled, not corrupted) — genuine non-opaque transparency is covered by the `transparentPng` unit;
 *   7. cleanse keeps the original (a lossless no-op in v0.2);
 *   8. the input buffers are never mutated.
 *
 * FLOOR RE-TUNE — what this proves, and what it doesn't: the provisional floors (lowcarb 0.96 · balanced
 * 0.90 · keto 0.80), first set on the v0.1 PDF corpus, were re-measured here on standalone images. Each plan
 * HOLDS its floor and BINDS SENSIBLY on the photo (up-direction SSIM lowcarb 0.982 · balanced 0.944 · keto
 * 0.814 — each just above its floor; both bytes AND quality monotonic across plans), so we found no reason to
 * change the thresholds. This validates the floors are *enforced* and *behave sensibly on real content* — it
 * does NOT claim the specific numbers are provably optimal (the machinery holds whatever floor it's handed).
 * The suite pins the invariants that must not regress; it does NOT pin exact byte counts (a future libvips
 * bump must not make it brittle) — every size assertion is relative or a generous margin.
 *
 * The expensive per-image slims run ONCE in `beforeAll` (memoized); the tests are fast assertions over the
 * results. Runs in the dedicated `test:integration` task, out of the fast inner loop.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { ssimMetric } from '@onadiet/core'
import type { SlimResult } from '@onadiet/core'
import { imageAdapter, resampleRaster, sharpImageCodec, sniffImageFormat } from '../../src/index'
import { inspect } from '../helpers'

// Exact byte sizes of the fixtures — if one is swapped, these guards force the measured invariants below to
// be re-derived, not silently trusted.
const PHOTO_BYTES = 431_044 // earth-apollo17.jpg  (NASA public domain)
const GRAPHIC_BYTES = 1_037_007 // illustration.png    (author's own; flat, no alpha)
const CARD_BYTES = 144_788 // card.png            (author's own; flat RGBA, fully-opaque alpha)

const corpus = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./corpus/${name}`, import.meta.url))))

/** Output length of a slim, or the original length when the plan kept the original (a no-op). */
function slimmedSize(result: SlimResult, original: Uint8Array): number {
  return result.output === null ? original.length : result.output.length
}

/**
 * The SSIM the slim actually held vs the original — measured EXACTLY as the adapter's floor does
 * ([`levers.ts`](../../src/levers.ts)): decode both to flattened RGB, and if the output was downscaled,
 * resample the CANDIDATE back UP to the original geometry before comparing. This captures the perceptual cost
 * of the downscale (comparing at the reduced size would hide it and inflate the score), so an assertion on
 * this value validates the same floor the adapter claims to hold.
 */
async function heldSsim(original: Uint8Array, out: Uint8Array): Promise<number> {
  const reference = await sharpImageCodec.decodeRgb(original)
  const decoded = await sharpImageCodec.decodeRgb(out)
  const comparable =
    decoded.width === reference.width && decoded.height === reference.height
      ? decoded
      : await resampleRaster(decoded, reference.width, reference.height)
  return ssimMetric.measure(reference, comparable)
}

describe('image golden corpus (real photo + RGB graphic + RGBA card)', () => {
  const photo = corpus('earth-apollo17.jpg')
  const graphic = corpus('illustration.png')
  const card = corpus('card.png')
  const snapshots = [Uint8Array.from(photo), Uint8Array.from(graphic), Uint8Array.from(card)]

  // Photo (keep-format JPEG): floor-limited minimums per plan + the balanced output + a self-calibrated
  // floor-hit target (midpoint of balanced's floor-binding band: above its floorless ladder min, below its
  // floored min → the floor, not the ladder, is the blocker).
  let photoLowcarb: SlimResult
  let photoBalanced: SlimResult
  let photoKeto: SlimResult
  let photoFloorHit: SlimResult
  let photoFloorHitTarget: number

  // Graphic: keep-format mins (byte-monotonicity) + the auto (format-switch) balanced output.
  let graphicLowcarb: SlimResult
  let graphicBalanced: SlimResult
  let graphicKeto: SlimResult
  let graphicAutoBalanced: SlimResult

  // Card: keep-format mins + the auto balanced output (opaque RGBA handled) + cleanse (no-op).
  let cardLowcarb: SlimResult
  let cardBalanced: SlimResult
  let cardKeto: SlimResult
  let cardAutoBalanced: SlimResult
  let cardCleanse: SlimResult

  beforeAll(async () => {
    expect(photo.length).toBe(PHOTO_BYTES)
    expect(graphic.length).toBe(GRAPHIC_BYTES)
    expect(card.length).toBe(CARD_BYTES)

    // Photo — lowcarb/balanced keep the JPEG (deterministic band; no switch to confuse the floor-hit math).
    // keto is left in its DEFAULT mode: `keto`/`crash` force the format switch (candidateFormats in
    // adapter.ts), so passing `format:'keep'` would be a no-op lie — this is the minimum a `keto` user gets.
    photoLowcarb = await imageAdapter.slim(photo, { plan: 'lowcarb', format: 'keep' })
    photoBalanced = await imageAdapter.slim(photo, { plan: 'balanced', format: 'keep' })
    photoKeto = await imageAdapter.slim(photo, { plan: 'keto' })
    const photoFloorless = await imageAdapter.slim(photo, {
      plan: 'balanced',
      format: 'keep',
      floor: 0,
    })
    photoFloorHitTarget = Math.round(
      (slimmedSize(photoFloorless, photo) + slimmedSize(photoBalanced, photo)) / 2,
    )
    photoFloorHit = await imageAdapter.slim(photo, {
      plan: 'balanced',
      format: 'keep',
      targetBytes: photoFloorHitTarget,
    })

    // Graphic — lowcarb/balanced keep format, keto in its default (auto-switching) mode; plus balanced auto
    // to exercise the PNG→WebP/AVIF format switch head-to-head against balanced keep.
    graphicLowcarb = await imageAdapter.slim(graphic, { plan: 'lowcarb', format: 'keep' })
    graphicBalanced = await imageAdapter.slim(graphic, { plan: 'balanced', format: 'keep' })
    graphicKeto = await imageAdapter.slim(graphic, { plan: 'keto' })
    graphicAutoBalanced = await imageAdapter.slim(graphic, { plan: 'balanced', format: 'auto' })

    // Card — lowcarb/balanced keep, keto default; auto (opaque RGBA handled cleanly), cleanse (no-op).
    cardLowcarb = await imageAdapter.slim(card, { plan: 'lowcarb', format: 'keep' })
    cardBalanced = await imageAdapter.slim(card, { plan: 'balanced', format: 'keep' })
    cardKeto = await imageAdapter.slim(card, { plan: 'keto' })
    cardAutoBalanced = await imageAdapter.slim(card, { plan: 'balanced', format: 'auto' })
    cardCleanse = await imageAdapter.slim(card, { plan: 'cleanse' })
    // This inline hook timeout OVERRIDES the config's `hookTimeout`, so it must carry the full budget: the
    // AVIF (aom) searches are far slower on a 2-core CI runner than locally (~40s). 15 min, matching the PDF
    // suite; the integration job is out of the fast loop and pdf/image run in parallel.
  }, 900_000)

  it('slims each image smaller under balanced and keeps a valid, decodable image', async () => {
    for (const [label, result, input, fmt] of [
      ['photo', photoBalanced, photo, 'jpeg'],
      ['graphic', graphicBalanced, graphic, 'png'],
      ['card', cardBalanced, card, 'png'],
    ] as const) {
      expect(result.outcome.ok, label).toBe(true)
      expect(result.output, label).not.toBeNull()
      const out = result.output as Uint8Array
      expect(out.length, label).toBeLessThan(input.length) // never bigger
      expect((await inspect(out)).format, label).toBe(fmt) // keep-format stayed put
      if (result.outcome.ok) {
        expect(result.outcome.outputBytes, label).toBe(out.length)
        expect(result.outcome.keptOriginal, label).toBe(false)
      }
    }
  })

  it('delivers visually-lossless lowcarb on a real photo, and strictly higher fidelity than balanced', async () => {
    // Two things here. (1) A floor-REGRESSION guard: the 0.96 is hard-coded (not read from the plan), so if
    // lowcarb's floor were ever lowered, the delivered quality would drop below 0.96 and trip this — measured
    // the SAME way the engine's floor is (heldSsim, up-direction), so it's the real held quality, not an
    // inflated proxy. (Measured ~0.982 @ ~24% smaller; the photo winner is scale-1, so no downscale term.)
    // (2) Independent signal beyond re-deriving the gate: lowcarb must deliver STRICTLY higher fidelity than
    // balanced on the same photo — a floor inversion (lowcarb ≤ balanced) would fail here even if both clear
    // their own floors. Measured lowcarb 0.982 vs balanced 0.944.
    expect(photoLowcarb.outcome.ok).toBe(true)
    const lowcarbSsim = await heldSsim(photo, photoLowcarb.output as Uint8Array)
    const balancedSsim = await heldSsim(photo, photoBalanced.output as Uint8Array)
    expect((photoLowcarb.output as Uint8Array).length).toBeLessThan(photo.length)
    expect(lowcarbSsim).toBeGreaterThanOrEqual(0.96) // visually-lossless floor genuinely held
    expect(lowcarbSsim).toBeGreaterThan(balancedSsim) // gentler plan ⇒ genuinely higher delivered quality
  })

  it('refuses honestly below the photo floor — TARGET_INFEASIBLE that names the quality floor', () => {
    // The target sits in balanced's floor-binding band, so the floor (not the ladder) blocks it.
    expect(photoFloorHit.outcome.ok).toBe(false)
    expect(photoFloorHit.output).toBeNull()
    if (!photoFloorHit.outcome.ok) {
      expect(photoFloorHit.outcome.reason).toBe('TARGET_INFEASIBLE')
      expect(photoFloorHit.outcome.detail).toMatch(/quality floor/) // the floor-hit branch, specifically
    }
  })

  it('yields a monotonic size ladder across plans (lowcarb > balanced > keto) in each plan default mode', () => {
    // Each plan's floor-limited minimum in the mode a user actually gets by default: lowcarb/balanced keep
    // format, keto auto-switches (candidateFormats forces auto for keto/crash — adapter.ts). So this is the
    // user-facing size ladder, not an apples-to-apples same-mode comparison: it proves the plans get
    // progressively more aggressive, part of it (keto < balanced) driven by keto's format switch by design.
    for (const [label, lowcarb, balanced, keto, input] of [
      ['photo', photoLowcarb, photoBalanced, photoKeto, photo],
      ['graphic', graphicLowcarb, graphicBalanced, graphicKeto, graphic],
      ['card', cardLowcarb, cardBalanced, cardKeto, card],
    ] as const) {
      const lc = slimmedSize(lowcarb, input)
      const bl = slimmedSize(balanced, input)
      const kt = slimmedSize(keto, input)
      expect(lc, `${label} lowcarb < original`).toBeLessThan(input.length)
      expect(bl, `${label} balanced < lowcarb`).toBeLessThan(lc)
      expect(kt, `${label} keto < balanced`).toBeLessThan(bl)
    }
  })

  it('pays off the format-switch lever — auto slims a flat PNG far below its keep-format minimum', () => {
    // A flat graphic kept as PNG can only lose so much; switching to WebP/AVIF is transformative.
    expect(graphicAutoBalanced.outcome.ok).toBe(true)
    const autoLen = slimmedSize(graphicAutoBalanced, graphic)
    const keepLen = slimmedSize(graphicBalanced, graphic)
    expect(autoLen).toBeLessThan(keepLen * 0.5) // measured ~8 KB (auto) vs ~210 KB (keep) — an order of magnitude
    expect(autoLen).toBeLessThan(graphic.length * 0.1) // > 90% smaller than the original PNG
    if (graphicAutoBalanced.outcome.ok)
      expect(graphicAutoBalanced.outcome.method).toMatch(/from png/)
  })

  it('slims a fully-opaque RGBA export to a valid smaller image, format-switch and all', async () => {
    // card.png is RGBA but every alpha byte is 255 (opaque) — the common "exported with alpha, nothing
    // transparent" case. The redundant channel must be handled cleanly: a valid, decodable, smaller image,
    // and auto still switches format to beat the keep-PNG minimum. (Genuine transparency → transparentPng
    // unit test.)
    expect(cardAutoBalanced.outcome.ok).toBe(true)
    const out = cardAutoBalanced.output as Uint8Array
    expect(out.length).toBeLessThan(slimmedSize(cardBalanced, card)) // auto beat keep-format PNG
    const meta = await inspect(out)
    expect(['jpeg', 'png', 'webp', 'heif']).toContain(meta.format) // a real, known format — not corrupted
    const decoded = await sharpImageCodec.decode(out)
    expect(decoded.width).toBeGreaterThan(0) // decodes cleanly (the search may have downscaled it)
    expect(decoded.width).toBeLessThanOrEqual(1080)
    expect(decoded.width).toBe(decoded.height) // square aspect preserved
    // FIDELITY, not just structure: a regression that dropped the opaque channel wrong (e.g. baked it black,
    // or shifted colors) would still decode to a valid square image — so measure that the pixels actually
    // survived. balanced's floor is 0.90; measured ~0.979. Proves the opaque-RGBA path preserves content.
    expect(await heldSsim(card, out)).toBeGreaterThanOrEqual(0.9)
  })

  it('keeps the original under cleanse (a lossless no-op in v0.2)', () => {
    expect(cardCleanse.outcome.ok).toBe(true)
    if (cardCleanse.outcome.ok) expect(cardCleanse.outcome.keptOriginal).toBe(true)
    expect(cardCleanse.output).toBeNull()
  })

  it('never mutates the input buffers (across every slim above)', () => {
    for (const [i, input] of [photo, graphic, card].entries()) {
      expect(Buffer.compare(Buffer.from(input), Buffer.from(snapshots[i]!)), `input ${i}`).toBe(0)
    }
  })

  it('slims to a sane format on each content class (sanity on the winning encoder)', () => {
    // A cheap guard that the pipeline emits a real known format for each class (not that a specific codec
    // won — that's the encoder's call). Uses the auto/keep outputs already computed.
    expect(sniffImageFormat(photoBalanced.output as Uint8Array)).toBe('jpeg')
    expect(sniffImageFormat(graphicAutoBalanced.output as Uint8Array)).not.toBeNull()
    expect(sniffImageFormat(cardAutoBalanced.output as Uint8Array)).not.toBeNull()
  })
})
