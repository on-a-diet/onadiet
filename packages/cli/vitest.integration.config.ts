import { configDefaults, defineConfig } from 'vitest/config'

// Folder golden-corpus integration suite (v0.3 sub-phase 3): builds a mixed tree of REAL files (jpeg/png/
// svg/pdf + a signed pdf + unknowns + nested dirs) on a real temp filesystem, then drives `diet ./dir`
// end-to-end through the actual CLI (`run` + `nodePorts`) and the real adapters — proving the fan-out,
// structure preservation, copy-through, budgets, and determinism on real bytes. Slower than the unit suite
// (real sharp/pdf-lib encodes to build the corpus + real slims across the tree), so it's its own task —
// `pnpm run test:integration` locally and a dedicated CI job — not part of the fast `test`.
export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    exclude: [...configDefaults.exclude],
    testTimeout: 120_000,
    // The corpus is built once in `beforeAll` (many real encodes); match the other suites' generous hook
    // budget so a slow 2-core CI runner never times out. The integration job is out of the fast loop.
    hookTimeout: 900_000,
  },
})
