/**
 * `@onadiet/testkit` — internal, source-only test utilities shared across packages. Not published.
 *
 * The seam conformance suites (so every `FormatAdapter` / `ImageCodec` / `QualityMetric` implementation
 * passes the same spec) plus the deterministic raster fixtures the pure metric suites need.
 */
export {
  runQualityMetricConformance,
  runImageCodecConformance,
  runFormatAdapterConformance,
} from './conformance'
export { gradientRaster, perturbRaster } from './rasters'
export { measure, mib, reportPerf, type PerfSample, type PerfRow } from './perf'
