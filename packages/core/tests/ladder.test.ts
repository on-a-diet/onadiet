import { describe, expect, it } from 'vitest'
import {
  DIET_PLANS,
  ladderForPlan,
  provisionalFloor,
  resolvePlan,
  tuningForPlan,
} from '../src/index'

describe('plan tuning (provisional ladders + floors)', () => {
  it('provides a ladder + floor for every plan', () => {
    for (const plan of DIET_PLANS) {
      const tuning = tuningForPlan(resolvePlan(plan))
      expect(tuning.ladder).toBeDefined()
      expect(tuning.floor).toBeGreaterThanOrEqual(0)
      expect(tuning.floor).toBeLessThanOrEqual(1)
    }
  })

  it('makes cleanse lossless — an empty lossy ladder held to floor 1', () => {
    expect(ladderForPlan(resolvePlan('cleanse')).quality).toHaveLength(0)
    expect(provisionalFloor(resolvePlan('cleanse'))).toBe(1)
  })

  it('makes crash floorless', () => {
    expect(provisionalFloor(resolvePlan('crash'))).toBe(0)
  })

  it('holds lowcarb to the strictest lossy floor', () => {
    const lossy = (['balanced', 'lowcarb', 'keto', 'crash'] as const).map((p) =>
      provisionalFloor(resolvePlan(p)),
    )
    expect(provisionalFloor(resolvePlan('lowcarb'))).toBe(Math.max(...lossy))
  })

  it('orders quality steps descending and scale steps descending from 1', () => {
    for (const plan of DIET_PLANS) {
      const { quality, scale } = ladderForPlan(resolvePlan(plan))
      for (let i = 1; i < quality.length; i += 1) {
        expect(quality[i]).toBeLessThan(quality[i - 1] as number)
      }
      expect(scale[0]).toBe(1) // always try native resolution first
      for (let i = 1; i < scale.length; i += 1) {
        expect(scale[i]).toBeLessThan(scale[i - 1] as number)
        expect(scale[i]).toBeGreaterThan(0)
      }
    }
  })
})
