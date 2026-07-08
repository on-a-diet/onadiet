import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  tsconfig: '../../tsconfig.build.json',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  // Bundle the engine (@onadiet/*) into the published CLI so `npm i -g onadiet` is self-contained…
  noExternal: [/^@onadiet\//],
  // …but keep the real runtime deps external: sharp (native), pdf-lib, and svgo (large pure-JS tree — an
  // installed dependency, not worth inlining).
  external: ['sharp', 'pdf-lib', 'svgo'],
})
