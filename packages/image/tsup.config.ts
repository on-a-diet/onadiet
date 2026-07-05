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
  // sharp stays external — it's a native runtime `dependency` the consumer installs and must never be
  // bundled. @onadiet/core is external (peer package in the workspace).
  external: ['sharp', '@onadiet/core'],
})
