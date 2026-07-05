import { describe, expect, it } from 'vitest'
import { OnadietError } from '@onadiet/core'
import type { DietPlan } from '@onadiet/core'
import { configForPlan, optimizeSvg } from '../src/optimize'
import { messySvg, pathHeavySvg, text } from './helpers'

const PLANS: DietPlan[] = ['cleanse', 'lowcarb', 'balanced', 'keto', 'crash']
const bytes = (s: string): number => new TextEncoder().encode(s).length

describe('configForPlan', () => {
  it('returns a config with plugins for every plan', () => {
    for (const plan of PLANS) {
      const config = configForPlan(plan)
      expect(Array.isArray(config.plugins), plan).toBe(true)
      expect(config.plugins!.length, plan).toBeGreaterThan(0)
    }
  })
})

describe('optimizeSvg', () => {
  it('shrinks an editor-export SVG and keeps valid <svg> markup', () => {
    const input = text(messySvg())
    const out = optimizeSvg(input, 'balanced')
    expect(bytes(out)).toBeLessThan(bytes(input))
    expect(out).toMatch(/<svg[\s>]/)
  })

  it('cleanse is rendering-identical: strips cruft, keeps geometry, and is gentler than balanced', () => {
    const input = text(messySvg())
    const cleansed = optimizeSvg(input, 'cleanse')
    // Cruft gone…
    expect(cleansed).not.toMatch(/<!--/) // comment
    expect(cleansed).not.toMatch(/<metadata/) // editor metadata
    expect(cleansed).not.toMatch(/inkscape:/) // editor namespace
    // …but the drawing survives (a lossless clean never drops shapes).
    expect(cleansed).toMatch(/<circle/)
    expect(cleansed).toMatch(/<rect/)
    // Gentler than the optimizing plans: it leaves more bytes on the table (no geometry/precision changes).
    expect(bytes(cleansed)).toBeGreaterThan(bytes(optimizeSvg(input, 'balanced')))
  })

  it('reduces number precision monotonically by plan (lowcarb > balanced > keto > crash)', () => {
    const input = text(pathHeavySvg())
    const size = (plan: DietPlan): number => bytes(optimizeSvg(input, plan))
    expect(size('lowcarb')).toBeGreaterThan(size('balanced'))
    expect(size('balanced')).toBeGreaterThan(size('keto'))
    expect(size('keto')).toBeGreaterThan(size('crash'))
    expect(size('lowcarb')).toBeLessThan(bytes(input)) // even the gentlest still shrinks path-heavy data
  })

  it('throws a typed OnadietError on markup svgo cannot parse', () => {
    expect(() => optimizeSvg('<svg><g attr="', 'balanced')).toThrowError(OnadietError)
  })
})
