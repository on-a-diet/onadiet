import { DIET_PLANS, OnadietError } from './types'
import type { DietPlan } from './types'

/** What a diet plan is allowed to do, in short. */
export interface PlanSpec {
  readonly plan: DietPlan
  readonly lossless: boolean
  readonly summary: string
}

export const PLAN_SPECS: Readonly<Record<DietPlan, PlanSpec>> = {
  cleanse: { plan: 'cleanse', lossless: true, summary: 'Flush junk only — zero visible change.' },
  balanced: { plan: 'balanced', lossless: false, summary: 'Meaningful slimming, low surprise.' },
  lowcarb: {
    plan: 'lowcarb',
    lossless: false,
    summary: 'Visually-lossless — held to a perceptual floor.',
  },
  keto: { plan: 'keto', lossless: false, summary: 'Aggressive — cut hard.' },
  crash: { plan: 'crash', lossless: false, summary: 'Tiny — accepts visible loss.' },
}

export const DEFAULT_PLAN: DietPlan = 'balanced'

/** Resolve + validate a diet-plan name (case-insensitive). Throws UNKNOWN_PLAN if not a known plan. */
export function resolvePlan(name: string = DEFAULT_PLAN): PlanSpec {
  const key = name.toLowerCase()
  if (!(DIET_PLANS as readonly string[]).includes(key)) {
    throw new OnadietError(
      'UNKNOWN_PLAN',
      `Unknown diet plan: "${name}". Try: ${DIET_PLANS.join(', ')}.`,
    )
  }
  return PLAN_SPECS[key as DietPlan]
}
