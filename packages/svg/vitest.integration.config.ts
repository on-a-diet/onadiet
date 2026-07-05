import { configDefaults, defineConfig } from 'vitest/config'

// Golden-corpus integration suite: a real editor-export SVG driven through the full slim pipeline with
// measured before/after. svgo is pure JS and fast (milliseconds), so — unlike the raster corpus — this
// needs no extended timeout; it's a separate task only to keep the golden-corpus convention consistent
// across adapters (`pnpm run test:integration` + the dedicated CI job).
export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    exclude: [...configDefaults.exclude],
  },
})
