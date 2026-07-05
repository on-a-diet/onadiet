import { describe, expect, it } from 'vitest'
import { runFormatAdapterConformance } from '@onadiet/testkit'
import { imageAdapter, sniffImageFormat } from '../src/adapter'
import {
  alphaRange,
  flatPng,
  gradientJpeg,
  gradientPng,
  inspect,
  noisePng,
  noiseWebp,
  transparentPng,
} from './helpers'

// The shared FormatAdapter contract, same spec every adapter passes.
runFormatAdapterConformance(
  'image',
  imageAdapter,
  () => gradientPng(64, 64),
  new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
)

describe('detect / sniffImageFormat', () => {
  it('recognizes JPEG/PNG/WebP/AVIF by magic bytes', async () => {
    expect(sniffImageFormat(await gradientJpeg(32, 32))).toBe('jpeg')
    expect(sniffImageFormat(await gradientPng(32, 32))).toBe('png')
    // build a real webp/avif via the codec-independent helper path
    const { sharpImageCodec } = await import('../src/image-codec')
    const raster = await sharpImageCodec.decode(await gradientPng(32, 32))
    expect(
      sniffImageFormat(
        await sharpImageCodec.encode(raster, {
          quality: 80,
          scale: 1,
          recodeToJpeg: false,
          format: 'webp',
        }),
      ),
    ).toBe('webp')
    expect(
      sniffImageFormat(
        await sharpImageCodec.encode(raster, {
          quality: 60,
          scale: 1,
          recodeToJpeg: false,
          format: 'avif',
        }),
      ),
    ).toBe('avif')
  })

  it('rejects non-images (PDF header, garbage)', () => {
    expect(sniffImageFormat(new TextEncoder().encode('%PDF-1.7\n...'))).toBeNull()
    expect(sniffImageFormat(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull()
    expect(imageAdapter.detect(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(false)
    expect(imageAdapter.detect(new TextEncoder().encode('%PDF-1.7'))).toBe(false)
  })
})

describe('weigh', () => {
  it('reports bytes + a descriptive cause (dims, format)', async () => {
    const png = await flatPng(128, 96)
    const w = await imageAdapter.weigh(png)
    expect(w.bytes).toBe(png.length)
    expect(w.causes).toHaveLength(1)
    expect(w.causes[0]!.label).toMatch(/128×96 png/)
    expect(w.causes[0]!.bytes).toBe(png.length)
  })

  it('estimates content (flat vs photo) and flags alpha', async () => {
    expect((await imageAdapter.weigh(await flatPng(128, 128))).causes[0]!.label).toMatch(
      /flat\/graphic/,
    )
    expect((await imageAdapter.weigh(await noisePng(128, 128))).causes[0]!.label).toMatch(
      /photo-like/,
    )
    expect((await imageAdapter.weigh(await transparentPng(96, 96))).causes[0]!.label).toMatch(
      /\(alpha\)/,
    )
  })
})

describe('slim — cancellation', () => {
  it('returns an honest ABORTED result (not a throw) when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const result = await imageAdapter.slim(await gradientPng(400, 400), {
      plan: 'balanced',
      signal: ac.signal,
    })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('ABORTED')
    expect(result.output).toBeNull() // nothing produced → nothing to write
  })

  it('surfaces ABORTED (not "unsupported") when the deadline lands mid-search', async () => {
    // The per-format loop's catch used to swallow the search's ABORTED throw and report "no format could
    // encode this image". A 1 ms deadline fires DURING the multi-ms SSIM search, after the top-of-slim
    // pre-check — so this exercises the in-loop path specifically.
    const result = await imageAdapter.slim(await gradientPng(500, 500), {
      plan: 'balanced',
      signal: AbortSignal.timeout(1),
    })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('ABORTED') // not UNSUPPORTED_INPUT
    expect(result.output).toBeNull()
  })
})

describe('slim — fast path', () => {
  it('encodes once at nominal quality: valid + smaller, but not as small as the full search', async () => {
    const jpg = await gradientJpeg(400, 400, 95) // high quality → a nominal re-encode shrinks it
    const fast = await imageAdapter.slim(jpg, { plan: 'balanced', fast: true })
    const full = await imageAdapter.slim(jpg, { plan: 'balanced' }) // full ladder search
    expect(fast.outcome.ok).toBe(true)
    expect(fast.output).not.toBeNull()
    const fastLen = (fast.output as Uint8Array).length
    expect(fastLen).toBeLessThan(jpg.length) // still beats the original (never-bigger holds)
    // The flag is honored END-TO-END: fast chose the NOMINAL point — top quality, full scale, no downscale
    // (`jpeg q85`, no `@…%`). A `>=` size check alone would pass even if `fast` were silently dropped in the
    // plumbing (fast === full); this method string can only appear when fast is live, since the full search
    // downscales this smooth gradient hard. Guards adapter/CLI plumbing the core counting test can't reach.
    if (fast.outcome.ok) expect(fast.outcome.method).toBe('jpeg q85')
    // ...and the full search reaches a strictly deeper floor-min (it downscales), so it is strictly smaller —
    // proving the two paths genuinely diverge (the size relationship below is not vacuously true on equality).
    const fullLen = full.output ? (full.output as Uint8Array).length : jpg.length
    expect(fullLen).toBeLessThan(fastLen)
    if (full.outcome.ok) expect(full.outcome.method).not.toBe('jpeg q85') // full picked a deeper (downscaled) point
  })

  it('keeps the original when a nominal re-encode cannot beat it', async () => {
    // An already-lossy, incompressible input: nominal quality only inflates it → keep the original.
    const result = await imageAdapter.slim(await noiseWebp(200, 200), {
      plan: 'balanced',
      fast: true,
    })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })
})

describe('slim — format-search concurrency (serialFormats)', () => {
  it('gives byte-identical output whether the candidate formats are searched serially or concurrently', async () => {
    // `serialFormats` is a pure latency/memory tradeoff (the folder runner sets it so a multi-format slim
    // doesn't multiply the per-file raster pool) — it must NOT change the winner or its exact bytes. `auto`
    // searches ~4 formats, so this exercises the real multi-format path both ways.
    const png = await gradientPng(400, 400)
    const concurrent = await imageAdapter.slim(png, { plan: 'balanced', format: 'auto' })
    const serial = await imageAdapter.slim(png, {
      plan: 'balanced',
      format: 'auto',
      serialFormats: true,
    })
    expect(concurrent.outcome.ok).toBe(true)
    expect(serial.outcome.ok).toBe(true)
    expect(serial.output).not.toBeNull()
    expect(concurrent.output).not.toBeNull()
    expect(Buffer.compare(Buffer.from(serial.output!), Buffer.from(concurrent.output!))).toBe(0)
    if (serial.outcome.ok && concurrent.outcome.ok) {
      expect(serial.outcome.method).toBe(concurrent.outcome.method) // same winning format + params
    }
  })
})

describe('slim — happy path & format policy', () => {
  it('keeps the input format by default (balanced, no --format)', async () => {
    const result = await imageAdapter.slim(await gradientPng(400, 400), { plan: 'balanced' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).not.toBeNull()
    const out = result.output as Uint8Array
    expect((await inspect(out)).format).toBe('png') // stayed PNG
    expect(out.length).toBeLessThan((await gradientPng(400, 400)).length)
  })

  it('--format auto picks the SMALLEST floor-holding format across candidates', async () => {
    const png = await gradientPng(400, 400)
    const auto = await imageAdapter.slim(png, { plan: 'balanced', format: 'auto' })
    expect(auto.outcome.ok).toBe(true)
    const autoLen = (auto.output as Uint8Array).length
    // Compare against each explicit format on the same input: auto must be ≤ the best of them.
    const explicit = await Promise.all(
      (['webp', 'avif', 'jpeg', 'png'] as const).map(async (format) => {
        const r = await imageAdapter.slim(png, { plan: 'balanced', format })
        return r.output ? r.output.length : png.length
      }),
    )
    expect(autoLen).toBeLessThanOrEqual(Math.min(...explicit))
    if (auto.outcome.ok) expect(auto.outcome.method).toMatch(/from png/)
  })

  it('honours an explicit --format', async () => {
    const result = await imageAdapter.slim(await gradientPng(300, 300), {
      plan: 'balanced',
      format: 'webp',
    })
    expect((await inspect(result.output as Uint8Array)).format).toBe('webp')
  })

  it('--format keep (explicit) preserves the input format, like the default', async () => {
    const result = await imageAdapter.slim(await gradientPng(300, 300), {
      plan: 'balanced',
      format: 'keep',
    })
    expect((await inspect(result.output as Uint8Array)).format).toBe('png')
  })

  it('keto/crash auto-switch format without --format', async () => {
    const png = await gradientPng(400, 400)
    const keto = await imageAdapter.slim(png, { plan: 'keto' }) // no --format
    expect(keto.outcome.ok).toBe(true)
    // keto enables auto implicitly, so a gradient PNG should switch to a more efficient format.
    expect((await inspect(keto.output as Uint8Array)).format).not.toBe('png')
  })

  it('hits a feasible byte target and stays under it', async () => {
    const png = await gradientPng(500, 500)
    const target = Math.floor(png.length / 4)
    const result = await imageAdapter.slim(png, {
      plan: 'balanced',
      format: 'auto',
      targetBytes: target,
    })
    expect(result.outcome.ok).toBe(true)
    expect((result.output as Uint8Array).length).toBeLessThanOrEqual(target)
  })

  it('keeps the original when it is already under the target', async () => {
    const png = await gradientPng(100, 100)
    const result = await imageAdapter.slim(png, {
      plan: 'balanced',
      targetBytes: png.length + 1000,
    })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })
})

/** Slim to a plan's floor-limited minimum for one format (plan-only), returning the output length. */
async function floorMin(
  png: Uint8Array,
  plan: 'balanced' | 'keto',
  floor?: number,
): Promise<number> {
  const r = await imageAdapter.slim(png, {
    plan,
    format: 'webp',
    ...(floor !== undefined ? { floor } : {}),
  })
  return r.output ? r.output.length : png.length
}

describe('slim — honest outcomes', () => {
  it('reports a FLOOR-HIT (names the quality floor) when the floor, not the ladder, blocks the target', async () => {
    // Self-calibrate a target inside webp's floor-binding band: above the floorless min, below the floored
    // min. There the floor is the binding constraint ⇒ the honest `infeasible-floor-hit` branch.
    const png = await noisePng(320, 320)
    const flooredMin = await floorMin(png, 'balanced') // holds the 0.90 floor
    const floorlessMin = await floorMin(png, 'balanced', 0) // ladder min, no floor
    expect(floorlessMin).toBeLessThan(flooredMin) // the floor genuinely binds on noise
    const target = Math.round((floorlessMin + flooredMin) / 2)

    const result = await imageAdapter.slim(png, {
      plan: 'balanced',
      format: 'webp',
      targetBytes: target,
    })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('TARGET_INFEASIBLE')
      expect(result.outcome.detail).toMatch(/quality floor/) // the floor-hit branch, specifically
    }
  })

  it('reports a plain INFEASIBLE (most-aggressive) when even floorless cannot reach the target', async () => {
    // A gentle plan (lowcarb) + an impossibly tiny target: even floorless, its ladder can't get there.
    const png = await noisePng(320, 320)
    const result = await imageAdapter.slim(png, {
      plan: 'lowcarb',
      format: 'webp',
      targetBytes: 500,
    })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('TARGET_INFEASIBLE')
      expect(result.outcome.detail).toMatch(/most aggressive/) // NOT the floor-hit branch
    }
  })

  it('keeps the original when nothing beats it within the floor (never a bigger file)', async () => {
    // An already-lossy low-q noise WebP: higher-q re-encodes inflate, downscales fail the floor ⇒ nothing
    // beats it (exercises chooseWinner's 'kept' branch + the never-bigger guard).
    const webp = await noiseWebp(200, 200, 45)
    const result = await imageAdapter.slim(webp, { plan: 'lowcarb', format: 'webp' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })

  it('cleanse is an honest lossless no-op in v0.2', async () => {
    const png = await gradientPng(200, 200)
    const planOnly = await imageAdapter.slim(png, { plan: 'cleanse' })
    expect(planOnly.outcome.ok).toBe(true)
    expect(planOnly.output).toBeNull()
    if (planOnly.outcome.ok) expect(planOnly.outcome.keptOriginal).toBe(true)
    // With a byte target it refuses honestly (points at a lossy plan), rather than pretending.
    const targeted = await imageAdapter.slim(png, { plan: 'cleanse', targetBytes: 100 })
    expect(targeted.outcome.ok).toBe(false)
    if (!targeted.outcome.ok) expect(targeted.outcome.reason).toBe('TARGET_INFEASIBLE')
  })

  it('rejects unsupported input', async () => {
    const result = await imageAdapter.slim(new Uint8Array([1, 2, 3, 4]), { plan: 'balanced' })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('UNSUPPORTED_INPUT')
  })
})

describe('slim — alpha safety', () => {
  it('preserves real transparency through --format auto (never JPEG for an alpha source)', async () => {
    const result = await imageAdapter.slim(await transparentPng(400, 400), {
      plan: 'balanced',
      format: 'auto',
    })
    expect(result.outcome.ok).toBe(true)
    const out = result.output as Uint8Array
    const fmt = (await inspect(out)).format
    expect(['webp', 'heif', 'png']).toContain(fmt) // never jpeg
    const { min, max } = await alphaRange(out)
    expect(max - min).toBeGreaterThan(50) // the alpha gradient survived
  })

  it('an explicit --format jpeg on an alpha source flattens and notes it', async () => {
    const result = await imageAdapter.slim(await transparentPng(300, 300), {
      plan: 'balanced',
      format: 'jpeg',
    })
    expect(result.outcome.ok).toBe(true)
    expect((await inspect(result.output as Uint8Array)).format).toBe('jpeg')
    if (result.outcome.ok) expect(result.outcome.method).toMatch(/flattened/)
  })
})
