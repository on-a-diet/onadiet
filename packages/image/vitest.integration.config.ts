import { configDefaults, defineConfig } from 'vitest/config'

// Golden-corpus integration suite: real photos/graphics, driven through the full slim pipeline with
// measured before/after savings + the SSIM the plan floors actually hold. Slower than the unit suite (many
// sharp encodes per image, including AVIF), so it's its own task — `pnpm run test:integration` locally and
// a dedicated CI job — not part of the fast `test`.
//
// The expensive per-image slims run once in `beforeAll`, so the heavy budget is the HOOK timeout; the
// individual tests are fast assertions over the memoized results.
export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    exclude: [...configDefaults.exclude],
    testTimeout: 60_000,
    // beforeAll runs the per-image plan slims across 3 corpus images (keep + auto). The `auto`/keto slims
    // search AVIF (aom), which is CPU-heavy and *much* slower on a 2-core CI runner than locally (~40s local
    // → it blew past a 300s cap on CI). Match the PDF suite's 15-min hook budget — the integration job is out
    // of the fast loop and pdf/image run in parallel, so this doesn't extend wall-time.
    hookTimeout: 900_000,
  },
})
