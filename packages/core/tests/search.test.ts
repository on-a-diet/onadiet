import { describe, expect, it } from 'vitest'
import {
  OnadietError,
  ladderForPlan,
  provisionalFloor,
  resolvePlan,
  searchSize,
} from '../src/index'
import type { Candidate, EncodeParams, ImageLever, Ladder } from '../src/index'

/**
 * A deterministic fake image with a known cost curve — the whole point of a pure SizeSearch is that we can
 * exercise convergence, floor-holding, and infeasibility with zero real encoding.
 *
 * bytes shrink with quality and (area-wise) with scale; SSIM drops as either drops.
 */
function fakeLever(id: string, originalBytes: number): ImageLever {
  return {
    id,
    originalBytes,
    evaluate: (p: EncodeParams): Promise<Candidate> => Promise.resolve(curve(p, originalBytes)),
  }
}

/** The shared cost curve used by the fakes. */
function curve(p: EncodeParams, originalBytes: number): Candidate {
  const bytes = Math.round(originalBytes * p.scale * p.scale * (p.quality / 100))
  const quality = Math.max(0, Math.min(1, 1 - (100 - p.quality) / 300 - (1 - p.scale) / 4))
  return { params: p, bytes, quality }
}

/** A pathologically incompressible image — every candidate is bigger than the original. */
function stubbornLever(id: string, originalBytes: number): ImageLever {
  return {
    id,
    originalBytes,
    evaluate: (p: EncodeParams): Promise<Candidate> =>
      Promise.resolve({ params: p, bytes: originalBytes + 10, quality: 1 }),
  }
}

/**
 * A losslessly-stored photo (FlateDecode): only a JPEG recode (`recodeToJpeg:true`) shrinks it — the
 * lossless re-encode (`false`) stays at original size, so it never enters the chain.
 */
function recodeLever(id: string, originalBytes: number): ImageLever {
  return {
    id,
    originalBytes,
    evaluate: (p: EncodeParams): Promise<Candidate> =>
      Promise.resolve(
        p.recodeToJpeg ? curve(p, originalBytes) : { params: p, bytes: originalBytes, quality: 1 },
      ),
  }
}

const balanced = ladderForPlan(resolvePlan('balanced'))
const balancedFloor = provisionalFloor(resolvePlan('balanced'))

/** The smallest floor-holding size the balanced ladder reaches for a 1MB fake image (scale .85, q85). */
const BALANCED_MIN_1MB = 614_125

/** Assert no chosen candidate ever dropped below the floor. */
function assertFloorHeld(decisions: readonly { chosen: Candidate | null }[], floor: number): void {
  for (const d of decisions) {
    if (d.chosen !== null) expect(d.chosen.quality).toBeGreaterThanOrEqual(floor)
  }
}

describe('searchSize — target mode', () => {
  it('leaves everything untouched when already under target', async () => {
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, {
      targetBytes: 2_000_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('already-under')
    expect(res.totalBytes).toBe(1_000_000)
    expect(res.decisions).toHaveLength(1)
    expect(res.decisions[0]?.chosen).toBeNull()
    expect(res.feasible).toBe(true)
  })

  it('treats a target exactly equal to the original as already-under', async () => {
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, {
      targetBytes: 1_000_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('already-under')
    expect(res.totalBytes).toBe(1_000_000)
  })

  it('converges under a reachable target while holding the floor', async () => {
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, {
      targetBytes: 800_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('under-target')
    expect(res.totalBytes).toBeLessThanOrEqual(800_000)
    expect(res.feasible).toBe(true)
    assertFloorHeld(res.decisions, balancedFloor)
  })

  it('stops exactly on the target when a step lands on it', async () => {
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, {
      targetBytes: 850_000, // the first ladder step (scale 1, q85) is exactly 850_000
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('under-target')
    expect(res.totalBytes).toBe(850_000)
  })

  it('prefers a quality step over a downscale step (ladder order)', async () => {
    // 900k is reachable by the first quality step (850k) alone — no downscale needed.
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, {
      targetBytes: 900_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('under-target')
    expect(res.decisions[0]?.chosen?.params.scale).toBe(1) // stayed at native resolution
    expect(res.decisions[0]?.chosen?.params.recodeToJpeg).toBe(false)
  })

  it('reports floor-limited infeasibility when only the floor blocks the target', async () => {
    // 500k is unreachable within the floor, but a floorless balanced run (down to 175k) would reach it.
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, {
      targetBytes: 500_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('infeasible-floor-hit')
    expect(res.feasible).toBe(false)
    expect(res.totalBytes).toBe(BALANCED_MIN_1MB) // the closest floor-holding config, maximally slimmed
    expect(res.decisions[0]?.chosen?.bytes).toBe(BALANCED_MIN_1MB)
    assertFloorHeld(res.decisions, balancedFloor)
  })

  it('a floorless plan (crash) reaches deeper than a floored one', async () => {
    const crash = ladderForPlan(resolvePlan('crash'))
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, crash, {
      targetBytes: 500_000,
      floor: provisionalFloor(resolvePlan('crash')), // 0 = floorless
    })
    expect(res.outcome).toBe('under-target')
    expect(res.totalBytes).toBeLessThanOrEqual(500_000)
  })

  it('attacks the fattest image first and leaves small ones alone once under target', async () => {
    const big = fakeLever('big', 2_000_000)
    const small = fakeLever('small', 100_000)
    const res = await searchSize([big, small], 0, balanced, {
      targetBytes: 1_600_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('under-target')
    expect(res.totalBytes).toBeLessThanOrEqual(1_600_000)
    expect(res.decisions.find((d) => d.id === 'big')?.chosen).not.toBeNull()
    expect(res.decisions.find((d) => d.id === 'small')?.chosen).toBeNull()
  })

  it('classifies fixed-bytes-exceed-target as hard infeasibility, not a floor hit', async () => {
    const res = await searchSize([fakeLever('a', 200_000)], 900_000, balanced, {
      targetBytes: 800_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('infeasible') // even floorless, fixed 900k already exceeds 800k
    expect(res.feasible).toBe(false)
    expect(res.totalBytes).toBeGreaterThan(800_000)
  })

  it('classifies an incompressible original as hard infeasibility and keeps it', async () => {
    const res = await searchSize([stubbornLever('a', 1_000_000)], 0, balanced, {
      targetBytes: 500_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('infeasible') // not the floor's fault — nothing compresses
    expect(res.decisions[0]?.chosen).toBeNull()
    expect(res.totalBytes).toBe(1_000_000)
  })

  it('accounts for fixedBytes in the total', async () => {
    const res = await searchSize([fakeLever('a', 1_000_000)], 250_000, balanced, {
      targetBytes: 5_000_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('already-under')
    expect(res.totalBytes).toBe(1_250_000)
  })

  it('handles an empty image set (hard-infeasible when fixed bytes exceed target)', async () => {
    const res = await searchSize([], 2_000_000, balanced, {
      targetBytes: 1_000_000,
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('infeasible')
    expect(res.decisions).toHaveLength(0)
    expect(res.totalBytes).toBe(2_000_000)
  })

  it('is deterministic and breaks ties toward the lower-index image', async () => {
    const inputs = [fakeLever('a', 1_000_000), fakeLever('b', 1_000_000)] as const
    const run = () =>
      searchSize([...inputs], 0, balanced, { targetBytes: 1_850_000, floor: balancedFloor })
    const first = await run()
    const second = await run()
    expect(first).toEqual(second) // identical inputs → identical result
    expect(first.decisions.find((d) => d.id === 'a')?.chosen).not.toBeNull() // tie → 'a' first
    expect(first.decisions.find((d) => d.id === 'b')?.chosen).toBeNull()
  })
})

describe('searchSize — the recode tier', () => {
  it('selects a JPEG-recode candidate for a losslessly-stored photo', async () => {
    const res = await searchSize([recodeLever('a', 1_000_000)], 0, balanced, {
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('slimmed-plan-only')
    expect(res.feasible).toBe(true)
    expect(res.decisions[0]?.chosen?.params.recodeToJpeg).toBe(true)
    expect(res.decisions[0]?.chosen?.bytes).toBe(BALANCED_MIN_1MB)
  })

  it('cannot slim that photo when the recode tier is disabled', async () => {
    const noRecode: Ladder = { quality: [85, 80], scale: [1], allowRecodeToJpeg: false }
    const res = await searchSize([recodeLever('a', 1_000_000)], 0, noRecode, {
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('slimmed-plan-only')
    expect(res.feasible).toBe(false)
    expect(res.decisions[0]?.chosen).toBeNull()
  })
})

describe('searchSize — plan-only mode (no target)', () => {
  it('slims each image as far as the floor allows', async () => {
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, { floor: balancedFloor })
    expect(res.outcome).toBe('slimmed-plan-only')
    expect(res.feasible).toBe(true)
    expect(res.totalBytes).toBe(BALANCED_MIN_1MB)
    assertFloorHeld(res.decisions, balancedFloor)
  })

  it('slims multiple images independently to their own floor minimums', async () => {
    const res = await searchSize(
      [fakeLever('big', 2_000_000), fakeLever('small', 1_000_000)],
      0,
      balanced,
      {
        floor: balancedFloor,
      },
    )
    expect(res.outcome).toBe('slimmed-plan-only')
    expect(res.decisions.find((d) => d.id === 'big')?.chosen?.bytes).toBe(BALANCED_MIN_1MB * 2)
    expect(res.decisions.find((d) => d.id === 'small')?.chosen?.bytes).toBe(BALANCED_MIN_1MB)
  })

  it('reports not-feasible (keeps original) when nothing can be slimmed', async () => {
    const res = await searchSize([stubbornLever('a', 1_000_000)], 0, balanced, {
      floor: balancedFloor,
    })
    expect(res.outcome).toBe('slimmed-plan-only')
    expect(res.feasible).toBe(false)
    expect(res.decisions[0]?.chosen).toBeNull()
    expect(res.totalBytes).toBe(1_000_000)
  })

  it('handles an empty image set', async () => {
    const res = await searchSize([], 500_000, balanced, { floor: balancedFloor })
    expect(res.outcome).toBe('slimmed-plan-only')
    expect(res.feasible).toBe(false)
    expect(res.decisions).toHaveLength(0)
    expect(res.totalBytes).toBe(500_000)
  })
})

describe('searchSize — a lossless (empty) ladder', () => {
  const cleanse: Ladder = ladderForPlan(resolvePlan('cleanse'))

  it('cannot slim images (structural savings live elsewhere) → hard infeasible', async () => {
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, cleanse, {
      targetBytes: 500_000,
      floor: provisionalFloor(resolvePlan('cleanse')),
    })
    expect(res.outcome).toBe('infeasible')
    expect(res.decisions[0]?.chosen).toBeNull()
    expect(res.totalBytes).toBe(1_000_000)
  })
})

describe('searchSize — input validation', () => {
  it('rejects a non-finite or negative fixedBytes with INVALID_SIZE', async () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        searchSize([fakeLever('a', 100)], bad, balanced, { floor: 0.9 }),
      ).rejects.toMatchObject({ code: 'INVALID_SIZE' })
    }
  })

  it('rejects an out-of-range or non-finite floor with INVALID_SIZE', async () => {
    for (const bad of [1.5, -0.1, Number.NaN]) {
      const res = searchSize([fakeLever('a', 100)], 0, balanced, { floor: bad })
      await expect(res).rejects.toBeInstanceOf(OnadietError)
      await expect(res).rejects.toMatchObject({ code: 'INVALID_SIZE' })
    }
  })

  it('rejects a non-positive or non-finite targetBytes with INVALID_SIZE', async () => {
    for (const bad of [0, -100, Number.NaN]) {
      await expect(
        searchSize([fakeLever('a', 100)], 0, balanced, { targetBytes: bad, floor: 0.9 }),
      ).rejects.toMatchObject({ code: 'INVALID_SIZE' })
    }
  })
})

describe('searchSize — cancellation', () => {
  /** A fake lever that counts evaluations and can abort the given controller on a chosen call. */
  const countingLever = (id: string, onEval: (n: number) => void): ImageLever => {
    let n = 0
    return {
      id,
      originalBytes: 1_000_000,
      evaluate: (p: EncodeParams): Promise<Candidate> => {
        n += 1
        onEval(n)
        return Promise.resolve(curve(p, 1_000_000))
      },
    }
  }

  it('bails immediately (ABORTED, zero evaluations) when the signal is already aborted', async () => {
    let evals = 0
    const ac = new AbortController()
    ac.abort()
    const lever = countingLever('a', () => (evals += 1))
    await expect(
      searchSize([lever], 0, balanced, { floor: balancedFloor, signal: ac.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(evals).toBe(0) // never touched the expensive grid
  })

  it('stops the grid walk mid-search when the signal fires (ABORTED, no full walk)', async () => {
    const ac = new AbortController()
    let evals = 0
    // Abort during the very first evaluation; the pre-check before the 2nd operating point then throws.
    const lever = countingLever('a', (n) => {
      evals = n
      if (n === 1) ac.abort()
    })
    await expect(
      searchSize([lever], 0, balanced, { floor: balancedFloor, signal: ac.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(evals).toBe(1) // the balanced grid has 32 points — it stopped after the first
  })

  it('runs to completion when the signal never fires', async () => {
    const ac = new AbortController()
    const res = await searchSize([fakeLever('a', 1_000_000)], 0, balanced, {
      floor: balancedFloor,
      signal: ac.signal,
    })
    expect(res.outcome).toBe('slimmed-plan-only') // a normal plan-only result, signal untriggered
  })
})

describe('searchSize — fast path', () => {
  /** Count how many operating points a lever is asked to evaluate. */
  const counted = (): { lever: ImageLever; evals: () => number } => {
    let n = 0
    return {
      lever: {
        id: 'a',
        originalBytes: 1_000_000,
        evaluate: (p: EncodeParams): Promise<Candidate> => {
          n += 1
          return Promise.resolve(curve(p, 1_000_000))
        },
      },
      evals: () => n,
    }
  }

  /** The full balanced grid size, derived from the ladder (quality × scale × the recode tier). */
  const fullGridSize =
    balanced.quality.length * balanced.scale.length * (balanced.allowRecodeToJpeg ? 2 : 1)

  it('evaluates ONLY the gentlest operating point (one encode), not the whole grid', async () => {
    const c = counted()
    const res = await searchSize([c.lever], 0, balanced, { floor: balancedFloor, fast: true })
    expect(c.evals()).toBe(1) // the balanced grid is 32 points; fast touches exactly one
    expect(res.outcome).toBe('slimmed-plan-only')
    // The chosen point is the NOMINAL one: the ladder's MAX quality + full scale + no recode. Asserting the
    // max (not just `params[0]`) guards the "nominal quality" promise against a future ascending-ladder edit,
    // which would silently make grid[0] the most aggressive point while a `scale/recode`-only check still passed.
    expect(res.decisions[0]?.chosen?.params).toMatchObject({
      quality: Math.max(...balanced.quality),
      scale: Math.max(...balanced.scale),
      recodeToJpeg: false,
    })
  })

  it('a full (non-fast) plan-only search evaluates the whole grid — the contrast fast avoids', async () => {
    const c = counted()
    await searchSize([c.lever], 0, balanced, { floor: balancedFloor })
    expect(c.evals()).toBe(fullGridSize) // walks the WHOLE ladder (32 points), not a truncated subset
  })

  it('keeps the original if the nominal point cannot beat it (never-bigger still holds)', async () => {
    // stubbornLever: every candidate is bigger than the original → the 1-point fast grid yields nothing.
    const res = await searchSize([stubbornLever('a', 1_000_000)], 0, balanced, {
      floor: balancedFloor,
      fast: true,
    })
    expect(res.decisions[0]?.chosen).toBeNull() // kept original
  })

  it('still enforces the floor under fast: a nominal point below the floor keeps the original', async () => {
    // The nominal balanced point (q85, scale 1) scores 0.95 on the fake curve; demand a 0.98 floor it can't
    // meet. Fast must NOT return the floor-failing encode — it runs the same floor filter as the full search,
    // so the point is dropped and the original kept honestly (no unmeasured/below-floor output ever ships).
    const c = counted()
    const res = await searchSize([c.lever], 0, balanced, { floor: 0.98, fast: true })
    expect(c.evals()).toBe(1) // only the nominal point was tried...
    expect(res.decisions[0]?.chosen).toBeNull() // ...it failed the floor → original kept, not returned
  })

  it('forgoes the recode tier under fast: a losslessly-stored photo is kept (only recode would shrink it)', async () => {
    // recodeLever only shrinks via the JPEG-recode points, which sit deep in the grid (excluded by fast).
    // Fast keeps the original honestly; the FULL search reaches the recode tier and does shrink it — the
    // documented trade-off (fast skips the lossless→JPEG recode, so Flate-stored PDF photos may see no savings).
    const fast = await searchSize([recodeLever('a', 1_000_000)], 0, balanced, {
      floor: balancedFloor,
      fast: true,
    })
    expect(fast.decisions[0]?.chosen).toBeNull() // nominal (no-recode) point can't shrink it → original kept
    const full = await searchSize([recodeLever('a', 1_000_000)], 0, balanced, {
      floor: balancedFloor,
    })
    expect(full.decisions[0]?.chosen).not.toBeNull() // the full search recodes it → a real saving
  })

  it('a byte target overrides fast: the full grid is searched (fast is ignored, not truncated)', async () => {
    // A library caller may pass both `fast` and a target; the CLI forbids the combo, but the core silently
    // favors the target (hitting a size needs the search). 800k is BELOW the nominal 850k point, so a
    // truncated 1-point fast grid could NOT reach it — the target being hit proves the full ladder ran.
    const c = counted()
    const res = await searchSize([c.lever], 0, balanced, {
      targetBytes: 800_000,
      floor: balancedFloor,
      fast: true,
    })
    expect(res.outcome).toBe('under-target') // reached the target...
    expect(res.totalBytes).toBeLessThanOrEqual(800_000)
    expect(c.evals()).toBeGreaterThan(1) // ...by walking the full ladder, not the 1-point fast grid
  })
})
