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
  // pdf-lib and sharp stay external — they're runtime `dependencies` the consumer installs (sharp is native
  // and must never be bundled). @onadiet/core is also external (peer package in the workspace).
  external: ['sharp', 'pdf-lib', '@onadiet/core'],
})
