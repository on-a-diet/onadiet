import { configDefaults, defineConfig } from 'vitest/config'

// Fast inner-loop + PR-matrix suite: unit + conformance. The real-file golden corpus
// (*.integration.test.ts) is excluded here and runs in the dedicated `test:integration` task (see
// vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/**/*.integration.test.ts'],
  },
})
