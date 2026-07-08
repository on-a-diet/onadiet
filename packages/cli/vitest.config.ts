import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The real-file folder golden corpus (*.integration.test.ts) and the local perf suite (*.perf.test.ts)
    // each run in their own dedicated task (`test:integration` / `test:perf`), out of this fast PR-matrix
    // gate. The `*` in the include glob matches dots, so `foo.perf.test.ts` WOULD otherwise be pulled into CI.
    exclude: [
      ...configDefaults.exclude,
      'tests/**/*.integration.test.ts',
      'tests/**/*.perf.test.ts',
    ],
    // CLI tests drive the real PDF engine (sharp/pdf-lib) end-to-end; raise the 5s default for slow CI.
    testTimeout: 30_000,
  },
})
