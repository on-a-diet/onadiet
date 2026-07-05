import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  // See packages/core/tsup.config.ts — build-only tsconfig with `ignoreDeprecations: '6.0'` for the dts emit.
  tsconfig: '../../tsconfig.build.json',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  // svgo is a runtime `dependency` the consumer installs — never bundle it. @onadiet/core is external
  // (peer package in the workspace).
  external: ['svgo', '@onadiet/core'],
})
