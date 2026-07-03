import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAN, DIET_PLANS, OnadietError, PLAN_SPECS, resolvePlan } from '../src/index'

describe('diet plans', () => {
  it('has exactly one spec per plan', () => {
    for (const plan of DIET_PLANS) {
      expect(PLAN_SPECS[plan].plan).toBe(plan)
    }
    expect(Object.keys(PLAN_SPECS)).toHaveLength(DIET_PLANS.length)
  })

  it('defaults to balanced', () => {
    expect(resolvePlan().plan).toBe(DEFAULT_PLAN)
    expect(DEFAULT_PLAN).toBe('balanced')
  })

  it('resolves case-insensitively', () => {
    expect(resolvePlan('KETO').plan).toBe('keto')
  })

  it('marks only cleanse as lossless', () => {
    expect(resolvePlan('cleanse').lossless).toBe(true)
    expect(resolvePlan('balanced').lossless).toBe(false)
  })

  it('throws UNKNOWN_PLAN for a bogus name', () => {
    expect(() => resolvePlan('bogus')).toThrowError(OnadietError)
  })
})
