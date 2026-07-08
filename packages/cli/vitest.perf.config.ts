import { configDefaults, defineConfig } from 'vitest/config'

// LOCAL/manual perf suite (`pnpm run test:perf`) — NOT wired into CI. Measures folder fan-out throughput
// (sequential vs the default parallel) + peak RSS across two tree sizes (the bounded-memory evidence), on a
// real temp-filesystem tree built once in `beforeAll`. Kept out of the fast `test`/`test:integration` loop.
export default defineConfig({
  test: {
    include: ['tests/**/*.perf.test.ts'],
    exclude: [...configDefaults.exclude],
    testTimeout: 60_000,
    hookTimeout: 900_000,
    fileParallelism: false,
    // The harness's product is its printed tables — let them flow straight to stdout, not vitest's buffer.
    disableConsoleIntercept: true,
  },
})
