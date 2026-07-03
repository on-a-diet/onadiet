/**
 * `@onadiet/core` — the pure engine.
 *
 * Public barrel for the pieces the CLI and the format adapters build on: size math (`size.ts`), the diet
 * plans / quality contracts (`plans.ts`), the typed errors + pipeline data types (`types.ts`), the pipeline
 * seam interfaces (`seams.ts`), the dual-constraint target-size search (`search.ts`), and the plan-derived
 * degrade ladders (`ladder.ts`). Everything here is PURE — no I/O, clock, or randomness (enforced by ESLint
 * + dependency-cruiser). The engine reaches the outside world only through injected ports.
 *
 * The pipeline this fills in: detect → weigh → plan → slim → verify → report.
 */
export { DIET_PLANS, OnadietError, throwIfAborted } from './types'
export type {
  DietPlan,
  OnadietErrorCode,
  WeightCause,
  Weight,
  DietSuccess,
  DietFailure,
  Outcome,
  SlimRequest,
  SlimResult,
  FormatRequest,
  FormatAdapter,
} from './types'

export { parseSize, formatBytes, savedPercent } from './size'

export { PLAN_SPECS, DEFAULT_PLAN, resolvePlan } from './plans'
export type { PlanSpec } from './plans'

export type {
  RasterImage,
  EncodeParams,
  ImageFormat,
  Candidate,
  ImageCodec,
  QualityMetric,
  ImageLever,
  Ladder,
  SlimConstraints,
  SlimOutcomeKind,
  ImageDecision,
  SearchResult,
} from './seams'

export { searchSize } from './search'

export { ssimMetric } from './ssim'

export { ladderForPlan, provisionalFloor, tuningForPlan } from './ladder'
export type { PlanTuning } from './ladder'

export {
  matchGlob,
  includeExclude,
  isSafeRelativePath,
  outputRelPath,
  aggregateFolder,
  classifyByExtension,
  weighFolder,
  checkFolder,
} from './folder'
export type {
  FolderFileAction,
  FolderFileEntry,
  FolderTotals,
  FolderManifest,
  FolderFileKind,
  FolderWeighEntry,
  FolderWeighReport,
  FolderCheckEntry,
  FolderCheckReport,
} from './folder'
