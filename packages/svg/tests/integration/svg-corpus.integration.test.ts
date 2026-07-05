/**
 * SVG GOLDEN CORPUS (v0.2 step C) — the vector slim pipeline proven on a real editor-export SVG.
 *
 * The unit suites build small synthetic SVGs; this one drives the actual {@link svgAdapter.slim} over a
 * representative vector-editor export (metadata, sodipodi/inkscape namespaces, comments, high-precision
 * bezier coordinates — the cruft real tools emit) and asserts the things the pitch rests on:
 *   1. every plan slims it smaller and the output is still valid SVG (never bigger);
 *   2. `cleanse` is genuinely lossless — it strips non-rendering cruft (metadata/comments/editor NS) while
 *      leaving the geometry untouched (unlike the raster `cleanse`, which is a no-op in v0.2);
 *   3. the plans form a monotonic size ladder (cleanse ≥ lowcarb ≥ balanced ≥ keto ≥ crash), driven by
 *      float-precision reduction on the fractional path data;
 *   4. an infeasible target is refused HONESTLY, pointing at a more aggressive plan;
 *   5. the input buffer is never mutated.
 *
 * svgo is pure JS and fast, so — unlike the raster corpus — no extended timeout is needed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SlimResult } from '@onadiet/core'
import { looksLikeSvg, svgAdapter } from '../../src/index'

const ORIGINAL_BYTES = 2389 // editor-export.svg — guards against a silent fixture swap

const corpusPath = fileURLToPath(new URL('./corpus/editor-export.svg', import.meta.url))

function outLen(result: SlimResult, original: Uint8Array): number {
  return result.output === null ? original.length : result.output.length
}

describe('svg golden corpus (editor-export.svg)', () => {
  const input = new Uint8Array(readFileSync(corpusPath))
  const snapshot = Uint8Array.from(input)

  let cleanse: SlimResult
  let lowcarb: SlimResult
  let balanced: SlimResult
  let keto: SlimResult
  let crash: SlimResult

  beforeAll(async () => {
    expect(input.length).toBe(ORIGINAL_BYTES)
    cleanse = await svgAdapter.slim(input, { plan: 'cleanse' })
    lowcarb = await svgAdapter.slim(input, { plan: 'lowcarb' })
    balanced = await svgAdapter.slim(input, { plan: 'balanced' })
    keto = await svgAdapter.slim(input, { plan: 'keto' })
    crash = await svgAdapter.slim(input, { plan: 'crash' })
  })

  it('slims smaller under every plan and keeps valid SVG (never bigger)', () => {
    for (const [label, result] of [
      ['cleanse', cleanse],
      ['lowcarb', lowcarb],
      ['balanced', balanced],
      ['keto', keto],
      ['crash', crash],
    ] as const) {
      expect(result.outcome.ok, label).toBe(true)
      expect(result.output, label).not.toBeNull()
      const out = result.output as Uint8Array
      expect(out.length, label).toBeLessThan(input.length) // never bigger
      expect(looksLikeSvg(out), label).toBe(true) // still valid SVG markup
    }
  })

  it('cleanse is lossless — strips cruft, keeps the drawing, and is gentler than balanced', () => {
    const out = new TextDecoder().decode(cleanse.output as Uint8Array)
    expect(out).not.toMatch(/<!--/) // comment gone
    expect(out).not.toMatch(/<metadata/) // editor metadata gone
    expect(out).not.toMatch(/sodipodi:|inkscape:/) // editor namespaces gone
    expect(out).toMatch(/<circle|<path/) // the drawing survived
    if (cleanse.outcome.ok) expect(cleanse.outcome.keptOriginal).toBe(false)
    // Gentler than the optimizing plans (no geometry/precision changes) ⇒ leaves more bytes.
    expect(outLen(cleanse, input)).toBeGreaterThan(outLen(balanced, input))
  })

  it('forms a monotonic size ladder across plans (precision reduction on the fractional paths)', () => {
    const c = outLen(cleanse, input)
    const lc = outLen(lowcarb, input)
    const bl = outLen(balanced, input)
    const kt = outLen(keto, input)
    const cr = outLen(crash, input)
    expect(c).toBeGreaterThanOrEqual(lc)
    expect(lc).toBeGreaterThanOrEqual(bl)
    expect(bl).toBeGreaterThanOrEqual(kt)
    expect(kt).toBeGreaterThanOrEqual(cr)
    expect(cr).toBeLessThan(c) // the ladder actually spans a real range end to end
  })

  it('refuses honestly when a plan cannot reach an impossible target', async () => {
    const result = await svgAdapter.slim(input, { plan: 'balanced', targetBytes: 50 })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('TARGET_INFEASIBLE')
      expect(result.outcome.detail).toMatch(/more aggressive plan/)
    }
  })

  it('never mutates the input buffer (across every slim above)', () => {
    expect(Buffer.compare(Buffer.from(input), Buffer.from(snapshot))).toBe(0)
  })
})
