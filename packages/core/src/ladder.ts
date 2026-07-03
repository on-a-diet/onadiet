/**
 * Plan → degrade-ladder + quality-floor derivation.
 *
 * Turns a {@link PlanSpec} into the {@link Ladder} the size-search walks and the SSIM floor it must hold.
 *
 * **VALIDATED against the golden corpus (v0.1 step 5).** These floors were reasoned starting points, then
 * measured on a real 9 MB / 224-image deck — each plan's floor-limited slim came out at
 * `cleanse` 0% off (lossless no-op in v0.1) · `lowcarb` ~10% · `balanced` ~47% · `keto` ~59% · `crash` ~64%,
 * a clean monotonic progression, so the numbers stand. The integration test enforces the core ordering
 * (`lowcarb` > `balanced` > `keto`) plus the `cleanse` no-op; the `cleanse`/`crash` endpoints above are
 * measured, not asserted. See [docs/05-PDF-WEDGE](../../../docs/05-PDF-WEDGE.md) and that test.
 *
 * **RE-MEASURED on standalone images (v0.2 step B).** The same table is shared with `@onadiet/image`, so it
 * was re-measured on a real photo + flat graphic + RGBA card. Each plan HOLDS its floor and BINDS SENSIBLY on
 * the photo (up-direction SSIM, i.e. counting downscale cost): `lowcarb` 0.982 (≥ 0.96) @ ~24% smaller,
 * `balanced` 0.944 (≥ 0.90) @ ~55%, `keto` 0.814 (just above 0.80) @ ~88% — bytes AND quality monotonic
 * across plans. So there's no reason to move the thresholds. (This confirms the floors are *enforced* and
 * *behave sensibly on real content* — it does not claim the numbers are provably optimal.) The floor is
 * codec-agnostic, so the format-switch lever (WebP/AVIF) changes the *savings*, not the guaranteed quality.
 * See [docs/06-IMAGES](../../../docs/06-IMAGES.md) and the image golden-corpus integration test.
 */
import { OnadietError } from './types'
import type { DietPlan } from './types'
import type { PlanSpec } from './plans'
import type { Ladder } from './seams'

/** A plan's provisional tuning: its degrade ladder plus the SSIM floor the search must hold. */
export interface PlanTuning {
  readonly ladder: Ladder
  /** Minimum SSIM to hold, `0..1`. `0` = floorless (accepts any loss). */
  readonly floor: number
}

// Provisional per-plan tuning. cleanse is lossless (no lossy ladder); crash is floorless (accepts loss).
const TUNING: Readonly<Record<DietPlan, PlanTuning>> = {
  cleanse: {
    // Lossless: never re-encode lossily — structural savings only, handled outside the image search.
    ladder: { quality: [], scale: [1], allowRecodeToJpeg: false },
    floor: 1,
  },
  balanced: {
    ladder: { quality: [85, 80, 75, 70], scale: [1, 0.85, 0.7, 0.5], allowRecodeToJpeg: true },
    floor: 0.9,
  },
  lowcarb: {
    // Visually-lossless: strict floor, gentle ladder.
    ladder: { quality: [92, 88, 85], scale: [1, 0.85], allowRecodeToJpeg: true },
    floor: 0.96,
  },
  keto: {
    ladder: { quality: [80, 70, 60, 50], scale: [1, 0.7, 0.5, 0.35], allowRecodeToJpeg: true },
    floor: 0.8,
  },
  crash: {
    // Floorless: chase the target, accept visible loss (still standard formats out).
    ladder: { quality: [70, 55, 40, 30], scale: [1, 0.6, 0.4, 0.25], allowRecodeToJpeg: true },
    floor: 0,
  },
}

/** The provisional tuning (ladder + floor) for a plan. */
export function tuningForPlan(spec: PlanSpec): PlanTuning {
  const tuning = TUNING[spec.plan]
  if (tuning === undefined) {
    throw new OnadietError('UNKNOWN_PLAN', `No ladder tuning for plan: "${spec.plan}".`)
  }
  return tuning
}

/** The degrade ladder for a plan. */
export function ladderForPlan(spec: PlanSpec): Ladder {
  return tuningForPlan(spec).ladder
}

/** The provisional SSIM floor for a plan. */
export function provisionalFloor(spec: PlanSpec): number {
  return tuningForPlan(spec).floor
}
