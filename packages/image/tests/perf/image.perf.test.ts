/**
 * IMAGE PERF HARNESS (v0.4 P4) — LOCAL/manual `pnpm run test:perf`, NOT in CI.
 *
 * Measures the two hot-path numbers the performance pillar ([docs/08-PERFORMANCE.md]) promises, on the real
 * golden-corpus photo:
 *   1. latency-by-plan — what a caller waits for `diet photo.jpg --plan X` (default mode per plan);
 *   2. the fixed-quality fast-path win — `--fast` (one nominal encode) vs the full ladder search.
 *
 * Absolute numbers are machine-dependent, so this asserts only ROBUST relative invariants — fast is faster
 * than the full search, every slim is valid — and PRINTS the absolutes (+ a delta vs the committed
 * `baseline.json`) for the README. It never hard-fails on an absolute threshold. See [../../src] + the
 * integration corpus for the fixtures.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { measure, mib, reportPerf } from '@onadiet/testkit'
import type { PerfSample } from '@onadiet/testkit'
import type { DietPlan, SlimResult } from '@onadiet/core'
import { imageAdapter } from '../../src/index'

const PHOTO_BYTES = 431_044 // earth-apollo17.jpg (NASA public domain) — the integration corpus photo
const photo = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../integration/corpus/earth-apollo17.jpg', import.meta.url))),
)

/** Committed baseline (label → ms); absent on the very first run, which then seeds it. */
const baseline: Record<string, number> = (() => {
  try {
    return JSON.parse(
      readFileSync(fileURLToPath(new URL('./baseline.json', import.meta.url)), 'utf8'),
    )
  } catch {
    return {}
  }
})()

/** The five plans in default (user-facing) mode: lowcarb/balanced keep the JPEG, keto/crash auto-switch. */
const PLANS: readonly DietPlan[] = ['cleanse', 'lowcarb', 'balanced', 'keto', 'crash']

interface Measured {
  readonly sample: PerfSample
  readonly result: SlimResult
}
const runs = new Map<string, Measured>()
const timed = async (label: string, run: () => Promise<SlimResult>): Promise<void> => {
  let result!: SlimResult
  const sample = await measure(async () => {
    result = await run()
  })
  runs.set(label, { sample, result })
}
const outBytes = (m: Measured): number =>
  m.result.output === null ? photo.length : m.result.output.length

describe('image perf — latency by plan + the fast-path win (real photo)', () => {
  beforeAll(async () => {
    expect(photo.length).toBe(PHOTO_BYTES)
    // Warm sharp/libvips once so native-addon init doesn't land on the first measured plan.
    await imageAdapter.slim(photo, { plan: 'balanced', format: 'keep' })

    for (const plan of PLANS) await timed(plan, () => imageAdapter.slim(photo, { plan }))
    await timed('balanced (auto)', () =>
      imageAdapter.slim(photo, { plan: 'balanced', format: 'auto' }),
    )
    await timed('balanced --fast', () =>
      imageAdapter.slim(photo, { plan: 'balanced', format: 'keep', fast: true }),
    )
  }, 900_000)

  it('every measured slim produced a valid outcome', () => {
    for (const [label, m] of runs) expect(m.result.outcome.ok, label).toBe(true)
  })

  it('the fast path is faster than the full ladder search (its whole point)', () => {
    const fast = runs.get('balanced --fast')!
    const full = runs.get('balanced')! // balanced default on a JPEG = keep-format full search
    // Fast does ONE nominal encode+SSIM vs the full 32-point grid, so it is strictly less work → faster.
    expect(fast.sample.ms).toBeLessThan(full.sample.ms)
    // ...and honest: it still shrinks the photo (never-bigger holds), just less than the deeper search.
    expect(outBytes(fast)).toBeLessThan(photo.length)
    expect(outBytes(fast)).toBeGreaterThanOrEqual(outBytes(full))
  })

  it('prints the latency-by-plan + fast-path tables (the README numbers)', () => {
    const pct = (m: Measured): string =>
      `${Math.round((1 - outBytes(m) / photo.length) * 100)}% smaller`
    reportPerf(
      `image latency by plan — earth-apollo17.jpg (${mib(photo.length)} MiB), peak RSS in note`,
      PLANS.map((p) => {
        const m = runs.get(p)!
        return {
          label: p,
          ms: m.sample.ms,
          note: `→ ${pct(m)}, RSS ${mib(m.sample.peakRssBytes)} MiB`,
        }
      }),
      baseline,
    )
    const fast = runs.get('balanced --fast')!
    const full = runs.get('balanced')!
    const auto = runs.get('balanced (auto)')!
    reportPerf(
      'fast path vs full search (balanced, keep-format)',
      [
        { label: 'balanced --fast', ms: fast.sample.ms, note: `→ ${pct(fast)} (1 nominal encode)` },
        { label: 'balanced (full)', ms: full.sample.ms, note: `→ ${pct(full)} (32-point ladder)` },
        {
          label: 'balanced --format auto',
          ms: auto.sample.ms,
          note: `→ ${pct(auto)} (WebP/AVIF search)`,
        },
      ],
      baseline,
    )
    // Emit a machine-readable line so a new baseline is trivial to seed: copy the JSON into baseline.json.
    const asBaseline = Object.fromEntries(
      [...runs].map(([label, m]) => [label, Math.round(m.sample.ms)]),
    )
    console.log(`baseline.json seed:\n${JSON.stringify(asBaseline, null, 2)}`)
    expect(runs.size).toBeGreaterThan(0)
  })
})
