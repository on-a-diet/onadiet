# @onadiet/testkit

**Private — never published.** Shared test utilities used across the onadiet workspace; not part of the
public API.

- **Seam conformance suites** — `runFormatAdapterConformance`, `runQualityMetricConformance`,
  `runImageCodecConformance`: the contract that every implementation of a
  [`@onadiet/core`](../core) seam must pass.
- **Deterministic raster fixtures** — `gradientRaster`, `perturbRaster` for image tests (no randomness,
  no wall-clock).
- **Perf helpers** — `measure`, `reportPerf`, `mib`, `PerfSample`, `PerfRow` for the `test:perf` suites.

Source-only (`exports: "./src/index.ts"`, `private: true`, no build step) — imported directly by the other
packages' tests.
