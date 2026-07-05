import { configDefaults, defineConfig } from 'vitest/config'

// Fast inner-loop + PR-matrix suite: unit + conformance. The real-file golden corpus
// (*.integration.test.ts) is excluded here and runs in the dedicated `test:integration` task (see
// vitest.integration.config.ts) — it slims real photos/graphics and is slower by design.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Both the golden-corpus integration suite AND the local perf suite are excluded here — each runs in its
    // own dedicated task (`test:integration` / `test:perf`), out of this fast PR-matrix gate. The `*` in the
    // include glob matches dots, so `foo.perf.test.ts` WOULD otherwise be pulled in and slow (or flake) CI.
    exclude: [
      ...configDefaults.exclude,
      'tests/**/*.integration.test.ts',
      'tests/**/*.perf.test.ts',
    ],
    // Real sharp encode/decode/resample + SSIM over full images; the search runs many candidates per
    // format. Comfortably over vitest's 5s default on slower CI runners.
    testTimeout: 30_000,
  },
})
