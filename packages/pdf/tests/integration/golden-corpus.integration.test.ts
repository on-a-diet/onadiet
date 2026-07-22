/**
 * GOLDEN CORPUS (v0.1 step 5) — the size-search proven against a real, non-synthetic PDF.
 *
 * The unit suites build small synthetic PDFs; this one drives the actual {@link pdfAdapter.slim} pipeline
 * over a genuine 9 MB, 224-image deck (a public SEC-filed IPO roadshow — see corpus/README.md) and asserts
 * the things the trust pitch rests on:
 *   1. a plan slims the file smaller and the output is still a structurally-intact PDF;
 *   2. an infeasible target is refused HONESTLY — the receipt names the QUALITY FLOOR as the binding
 *      constraint, not the target (distinguishing a floor-hit from a structural miss);
 *   3. a more aggressive plan reaches a target the default can't, at the same target;
 *   4. the plan floors bind MONOTONICALLY on real content (gentler plan ⇒ larger floor-limited minimum);
 *   5. every non-slimmable image (SMask / ICCBased / Indexed / Flate) is left BYTE-FOR-BYTE while slimmable
 *      ones are actually re-encoded — the leave-alone guard, exercised at real scale;
 *   6. cleanse keeps the original (a lossless no-op in v0.1);
 *   7. the input buffer is never mutated.
 *
 * Every expensive real-file slim runs ONCE in `beforeAll` (memoized); the tests are then fast assertions
 * over the results. That keeps any single `it` well under the per-test timeout — only the shared setup is
 * slow, governed by the hook timeout. Runs in the dedicated `test:integration` task, out of the fast inner
 * loop. Assertions use margins / relative comparisons, not exact byte counts, so a minor encoder change
 * (e.g. a future libvips/mozjpeg bump) doesn't make them brittle. Measured numbers are recorded in
 * [the PDF guide](../../../../docs/guide/pdf.md) and [the roadmap](../../../../docs/ROADMAP.md).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import type { SlimResult } from '@onadiet/core'
import { pdfAdapter } from '../../src/index'
import { findImages } from '../../src/pdf-images'

// Measured facts about the fixture (see corpus/README.md). Structure assertions pin these exactly; all
// byte-size assertions are relative (targets derived from measured floor-minimums), never exact byte counts.
const ORIGINAL_BYTES = 9_023_477
const PAGE_COUNT = 60
const IMAGE_COUNT = 224

const corpusPath = fileURLToPath(new URL('./corpus/spacex-roadshow.pdf', import.meta.url))

/** Count image XObjects — the leave-alone guard must preserve every one, slimmable or not. */
function imageCount(doc: PDFDocument): number {
  let n = 0
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFRawStream &&
      obj.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image')
    ) {
      n += 1
    }
  }
  return n
}

/** sha256 of every image stream's encoded bytes, partitioned by the adapter's own slimmable verdict. */
async function imageHashes(
  bytes: Uint8Array,
): Promise<{ slimmable: string[]; nonSlimmable: string[] }> {
  const doc = await PDFDocument.load(bytes)
  const slimmable: string[] = []
  const nonSlimmable: string[] = []
  for (const image of findImages(doc)) {
    const hash = createHash('sha256').update(image.stream.contents).digest('hex')
    ;(image.slimmable ? slimmable : nonSlimmable).push(hash)
  }
  return { slimmable, nonSlimmable }
}

/** Output length of a slim, or the original length when the plan kept the original (a no-op). */
function slimmedSize(result: SlimResult, original: Uint8Array): number {
  return result.output === null ? original.length : result.output.length
}

describe('golden corpus: spacex-roadshow.pdf (9 MB, 60 pages, 224 images)', () => {
  let input: Uint8Array
  let inputSnapshot: Uint8Array
  let inputHashes: { slimmable: string[]; nonSlimmable: string[] }

  // Floor-limited minimums per plan (plan-only = slim as far as the floor allows).
  let lowcarbMin: number
  let balancedMin: number
  let ketoMin: number
  let balancedFloor: SlimResult // the balanced floor-min slim — reused as the "successful output" sample

  // A target inside balanced's FLOOR-BINDING BAND: above what balanced's ladder reaches floorless, below
  // what it reaches while holding its 0.90 floor. There, balanced's floor is the binding constraint
  // (a floor-hit, not a structural miss), while keto's looser 0.80 floor clears it. All computed once here.
  let floorHitTarget: number
  let balancedInfeasible: SlimResult
  let ketoAtTarget: SlimResult

  beforeAll(async () => {
    input = new Uint8Array(readFileSync(corpusPath))
    // Guard the fixture: if it's swapped, these numbers must be re-measured, not silently trusted.
    expect(input.length).toBe(ORIGINAL_BYTES)
    inputSnapshot = Uint8Array.from(input) // for the immutability check after all slims below
    inputHashes = await imageHashes(input)

    // Sequential (not Promise.all) to bound peak memory — each slim decodes many full rasters.
    const lowcarb = await pdfAdapter.slim(input, { plan: 'lowcarb' })
    balancedFloor = await pdfAdapter.slim(input, { plan: 'balanced' }) // balanced floored min (floor 0.90)
    const keto = await pdfAdapter.slim(input, { plan: 'keto' })
    const balancedFloorless = await pdfAdapter.slim(input, { plan: 'balanced', floor: 0 }) // ladder min
    lowcarbMin = slimmedSize(lowcarb, input)
    balancedMin = slimmedSize(balancedFloor, input)
    ketoMin = slimmedSize(keto, input)

    // Midpoint of the floor-binding band — derived from measured mins, so it self-calibrates per platform
    // (never a hard-coded byte count) and always lands where the floor, not the ladder, is the blocker.
    floorHitTarget = Math.round((slimmedSize(balancedFloorless, input) + balancedMin) / 2)
    balancedInfeasible = await pdfAdapter.slim(input, {
      plan: 'balanced',
      targetBytes: floorHitTarget,
    })
    ketoAtTarget = await pdfAdapter.slim(input, { plan: 'keto', targetBytes: floorHitTarget })
  }, 900_000) // ~490s of real-file slims measured on 2-core CI; 15 min headroom against a noisy runner

  it('slims the deck smaller and keeps a structurally-intact PDF (all pages + images preserved)', async () => {
    expect(balancedFloor.outcome.ok).toBe(true)
    expect(balancedFloor.output).not.toBeNull()
    const output = balancedFloor.output as Uint8Array
    expect(output.length).toBeLessThan(input.length)
    if (balancedFloor.outcome.ok) {
      expect(balancedFloor.outcome.keptOriginal).toBe(false)
      expect(balancedFloor.outcome.outputBytes).toBe(output.length)
      expect(balancedFloor.outcome.inputBytes).toBe(input.length)
    }

    const reloaded = await PDFDocument.load(output)
    expect(reloaded.getPageCount()).toBe(PAGE_COUNT)
    expect(imageCount(reloaded)).toBe(IMAGE_COUNT) // no image object dropped, slimmable or not
  })

  it('refuses honestly below the floor — TARGET_INFEASIBLE that names the quality floor', () => {
    expect(balancedInfeasible.outcome.ok).toBe(false)
    expect(balancedInfeasible.output).toBeNull()
    if (!balancedInfeasible.outcome.ok) {
      expect(balancedInfeasible.outcome.reason).toBe('TARGET_INFEASIBLE')
      // "…without dropping below the balanced quality floor…" — unique to the floor-hit branch, so this
      // proves the FLOOR bound (not a structural miss, whose message omits "quality floor").
      expect(balancedInfeasible.outcome.detail).toMatch(/quality floor/)
    }
  })

  it('reaches with a more aggressive plan a target the default plan cannot (same target)', async () => {
    expect(balancedInfeasible.outcome.ok).toBe(false) // balanced can't hold its floor and reach it
    expect(ketoAtTarget.outcome.ok).toBe(true) // keto (looser floor) can
    expect(ketoAtTarget.output).not.toBeNull()
    const output = ketoAtTarget.output as Uint8Array
    expect(output.length).toBeLessThanOrEqual(floorHitTarget)
    const reloaded = await PDFDocument.load(output)
    expect(reloaded.getPageCount()).toBe(PAGE_COUNT)
    expect(imageCount(reloaded)).toBe(IMAGE_COUNT)
  })

  it('binds plan floors monotonically — a gentler plan yields a larger floor-limited minimum', () => {
    expect(lowcarbMin).toBeLessThan(input.length) // even the gentle plan saves something
    expect(balancedMin).toBeLessThan(lowcarbMin)
    expect(ketoMin).toBeLessThan(balancedMin)
  })

  it('leaves every non-slimmable image byte-for-byte and re-encodes slimmable ones', async () => {
    const out = await imageHashes(balancedFloor.output as Uint8Array)
    // Non-slimmable images (has-SMask / ICCBased / Indexed / Flate / Decode) survive exactly — same
    // multiset of stream hashes in the output as in the input.
    expect(out.nonSlimmable.slice().sort()).toEqual(inputHashes.nonSlimmable.slice().sort())
    // And the slim actually did something: at least one slimmable image's bytes changed.
    const outSlimmable = new Set(out.slimmable)
    const unchanged = inputHashes.slimmable.filter((h) => outSlimmable.has(h)).length
    expect(unchanged).toBeLessThan(inputHashes.slimmable.length)
  })

  it('keeps the original under cleanse (a lossless no-op in v0.1)', async () => {
    const result = await pdfAdapter.slim(input, { plan: 'cleanse' })
    expect(result.outcome.ok).toBe(true)
    if (result.outcome.ok) {
      expect(result.outcome.keptOriginal).toBe(true)
    }
    expect(result.output).toBeNull() // nothing smaller produced ⇒ nothing to write
  })

  it('never mutates the input buffer (across every slim above)', () => {
    // `input` was passed to seven slims in beforeAll; if any mutated it in place, it now differs.
    expect(Buffer.compare(Buffer.from(input), Buffer.from(inputSnapshot))).toBe(0)
  })
})
