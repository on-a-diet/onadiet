import { configDefaults, defineConfig } from 'vitest/config'

// Fast inner-loop + PR-matrix suite: unit + conformance + the synthetic capability probe. The real-file
// golden corpus (*.integration.test.ts) is excluded here and runs in the dedicated `test:integration`
// task (see vitest.integration.config.ts) — it slims a 9 MB deck and takes minutes, not seconds.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/**/*.integration.test.ts'],
    // These tests do real sharp encode/decode/resample + SSIM over full images; the search can run many
    // candidates per image. That comfortably exceeds vitest's 5s default on slower CI runners.
    testTimeout: 30_000,
  },
})
