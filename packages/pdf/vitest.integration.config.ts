import { configDefaults, defineConfig } from 'vitest/config'

// Golden-corpus integration suite: real files, driven through the full slim pipeline with measured
// before/after savings. Slow by design (many sharp encodes over a 9 MB deck), so it's its own task —
// `pnpm run test:integration` locally and a dedicated CI job — not part of the fast `test`.
//
// All expensive real-file slims run once in `beforeAll`, so the heavy budget is the HOOK timeout; the
// individual tests are fast assertions over the memoized results.
export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    exclude: [...configDefaults.exclude],
    testTimeout: 60_000,
    // beforeAll runs ~6 real-file slims; measured ~490s on a 2-core CI runner. 15 min gives comfortable
    // headroom for a noisy/slow runner (CPU steal) so the shared setup never flakes on the clock.
    hookTimeout: 900_000,
  },
})
