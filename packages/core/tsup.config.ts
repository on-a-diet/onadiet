import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  // Build-only tsconfig with `ignoreDeprecations: '6.0'` — tsup's dts emit injects the deprecated
  // `baseUrl`, which TS 6.0 errors on. Kept off tsconfig.json so typecheck stays honest.
  tsconfig: '../../tsconfig.build.json',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
})
