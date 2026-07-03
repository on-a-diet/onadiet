/**
 * Conformance suites for the pluggable seams — every implementation (`@onadiet/pdf`, `@onadiet/image`, …)
 * runs the SAME spec, so a new adapter/codec/metric can't quietly diverge from the contract. Invoke each
 * from an implementation's own test file with the concrete instance (+ a sample-bytes provider).
 */
import { describe, expect, it } from 'vitest'
import { OnadietError } from '@onadiet/core'
import type { FormatAdapter, ImageCodec, QualityMetric } from '@onadiet/core'
import { gradientRaster, perturbRaster } from './rasters'

/** Every {@link QualityMetric} must pass this. */
export function runQualityMetricConformance(name: string, metric: QualityMetric): void {
  describe(`QualityMetric conformance: ${name}`, () => {
    it('has a kind', () => {
      expect(metric.kind.length).toBeGreaterThan(0)
    })

    it('scores identical images as 1', () => {
      const img = gradientRaster(32, 32)
      expect(metric.measure(img, img)).toBe(1)
    })

    it('scores a degraded image in [0, 1)', () => {
      const ref = gradientRaster(32, 32)
      const worse = perturbRaster(ref, 40)
      const score = metric.measure(ref, worse)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThan(1)
    })

    it('is symmetric', () => {
      const a = gradientRaster(32, 32)
      const b = perturbRaster(a, 25)
      expect(metric.measure(a, b)).toBeCloseTo(metric.measure(b, a), 10)
    })

    it('rejects mismatched dimensions', () => {
      expect(() => metric.measure(gradientRaster(32, 32), gradientRaster(16, 16))).toThrowError(
        OnadietError,
      )
    })
  })
}

/** Every {@link ImageCodec} must pass this (given a provider of sample encoded bytes). */
export function runImageCodecConformance(
  name: string,
  codec: ImageCodec,
  sampleEncoded: () => Promise<Uint8Array>,
): void {
  describe(`ImageCodec conformance: ${name}`, () => {
    it('has a kind', () => {
      expect(codec.kind.length).toBeGreaterThan(0)
    })

    it('decodes to a coherent raster', async () => {
      const raster = await codec.decode(await sampleEncoded())
      expect(raster.width).toBeGreaterThan(0)
      expect(raster.height).toBeGreaterThan(0)
      expect(raster.channels).toBeGreaterThanOrEqual(1)
      expect(raster.pixels.length).toBe(raster.width * raster.height * raster.channels)
    })

    it('round-trips dimensions at scale 1', async () => {
      const raster = await codec.decode(await sampleEncoded())
      const bytes = await codec.encode(raster, { quality: 80, scale: 1, recodeToJpeg: false })
      expect(bytes.length).toBeGreaterThan(0)
      const back = await codec.decode(bytes)
      expect(back.width).toBe(raster.width)
      expect(back.height).toBe(raster.height)
    })

    it('produces fewer bytes at lower quality', async () => {
      const raster = await codec.decode(await sampleEncoded())
      const high = await codec.encode(raster, { quality: 90, scale: 1, recodeToJpeg: false })
      const low = await codec.encode(raster, { quality: 30, scale: 1, recodeToJpeg: false })
      expect(low.length).toBeLessThan(high.length)
    })

    it('downscales when scale < 1', async () => {
      const raster = await codec.decode(await sampleEncoded())
      const half = await codec.encode(raster, { quality: 80, scale: 0.5, recodeToJpeg: false })
      const back = await codec.decode(half)
      expect(back.width).toBeLessThan(raster.width)
    })
  })
}

/** Every {@link FormatAdapter} must pass this (given a valid-input provider + an invalid sample). */
export function runFormatAdapterConformance(
  name: string,
  adapter: FormatAdapter,
  makeValid: () => Promise<Uint8Array>,
  invalid: Uint8Array,
): void {
  describe(`FormatAdapter conformance: ${name}`, () => {
    it('has a kind', () => {
      expect(adapter.kind.length).toBeGreaterThan(0)
    })

    it('detects its own format and rejects others', async () => {
      expect(adapter.detect(await makeValid())).toBe(true)
      expect(adapter.detect(invalid)).toBe(false)
    })

    it('weighs a valid input into causes that sum to the total', async () => {
      const input = await makeValid()
      const weight = await adapter.weigh(input)
      expect(weight.bytes).toBe(input.length)
      expect(weight.causes.length).toBeGreaterThan(0)
      const summed = weight.causes.reduce((sum, cause) => sum + cause.bytes, 0)
      expect(summed).toBe(weight.bytes)
      for (const cause of weight.causes) expect(cause.bytes).toBeGreaterThanOrEqual(0)
    })

    it('rejects weighing an unsupported input with a typed OnadietError', async () => {
      // Enforces the "typed errors, never raw throws" contract for every adapter.
      await expect(adapter.weigh(invalid)).rejects.toBeInstanceOf(OnadietError)
    })

    it('slims a valid input to a SlimResult that never grows the file', async () => {
      const input = await makeValid()
      const result = await adapter.slim(input, { plan: 'balanced' })
      expect(typeof result.outcome.ok).toBe('boolean')
      if (result.output !== null) expect(result.output.length).toBeLessThanOrEqual(input.length)
    })

    it('returns an honest failure (not a throw) when slimming an unsupported input', async () => {
      const result = await adapter.slim(invalid, { plan: 'balanced' })
      expect(result.outcome.ok).toBe(false)
      expect(result.output).toBeNull()
    })
  })
}
