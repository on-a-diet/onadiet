import { describe, expect, it } from 'vitest'
import { ssimMetric } from '@onadiet/core'
import type { EncodeParams } from '@onadiet/core'
import { sharpImageCodec } from '../src/image-codec'
import { buildFormatLevers } from '../src/levers'
import { gradientPng } from './helpers'

const params = (over: Partial<EncodeParams>): EncodeParams => ({
  quality: 80,
  scale: 1,
  recodeToJpeg: false,
  ...over,
})

describe('buildFormatLevers', () => {
  it('builds one lever per requested format, tagged by format', async () => {
    const levers = await buildFormatLevers(
      await gradientPng(96, 96),
      ['webp', 'avif', 'jpeg'],
      sharpImageCodec,
      ssimMetric,
    )
    expect(levers.map((l) => l.format)).toEqual(['webp', 'avif', 'jpeg'])
    expect(levers.map((l) => l.lever.id)).toEqual(['webp', 'avif', 'jpeg'])
    // originalBytes is the source file size, shared across formats.
    const bytes = (await gradientPng(96, 96)).length
    expect(levers.every((l) => l.lever.originalBytes === bytes)).toBe(true)
  })

  it('evaluate injects the lever format and returns a scored candidate', async () => {
    const [webp] = await buildFormatLevers(
      await gradientPng(128, 128),
      ['webp'],
      sharpImageCodec,
      ssimMetric,
    )
    const candidate = await webp!.lever.evaluate(params({ quality: 80 }))
    expect(candidate.params.format).toBe('webp')
    expect(candidate.bytes).toBeGreaterThan(0)
    expect(candidate.quality).toBeGreaterThan(0)
    expect(candidate.quality).toBeLessThanOrEqual(1)
  })

  it('scores a gentler encode higher than an aggressive one (SSIM tracks quality)', async () => {
    const [webp] = await buildFormatLevers(
      await gradientPng(160, 160),
      ['webp'],
      sharpImageCodec,
      ssimMetric,
    )
    const gentle = await webp!.lever.evaluate(params({ quality: 90, scale: 1 }))
    const harsh = await webp!.lever.evaluate(params({ quality: 40, scale: 0.5 }))
    expect(gentle.quality).toBeGreaterThan(harsh.quality)
    expect(harsh.bytes).toBeLessThan(gentle.bytes)
  })

  it('memoizes evaluations by quality:scale (same params → same candidate)', async () => {
    const [webp] = await buildFormatLevers(
      await gradientPng(96, 96),
      ['webp'],
      sharpImageCodec,
      ssimMetric,
    )
    const a = await webp!.lever.evaluate(params({ quality: 75, scale: 1 }))
    const b = await webp!.lever.evaluate(params({ quality: 75, scale: 1 }))
    expect(b).toBe(a) // identical object from the cache
  })
})
