import { configDefaults, defineConfig } from 'vitest/config'

// LOCAL/manual perf suite (`pnpm run test:perf`) — NOT wired into CI. Measures wall-time + peak RSS of the
// real image slim across plans + the fast-path win, on the golden-corpus photo. The expensive slims run once
// in `beforeAll` (heavy budget = the HOOK timeout); the tests are fast assertions + a printed table whose
// numbers feed the README. Kept out of the fast `test` and `test:integration` tasks.
export default defineConfig({
  test: {
    include: ['tests/**/*.perf.test.ts'],
    exclude: [...configDefaults.exclude],
    testTimeout: 60_000,
    hookTimeout: 900_000,
    // Perf numbers must not be diluted by running suites in parallel on shared cores.
    fileParallelism: false,
    // The harness's product is its printed tables — let them flow straight to stdout, not vitest's buffer.
    disableConsoleIntercept: true,
  },
})
