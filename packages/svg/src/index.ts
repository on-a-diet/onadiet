/**
 * `@onadiet/svg` — the SVG (vector) {@link FormatAdapter}.
 *
 * Slims SVG files with svgo: strip editor cruft (cleanse, rendering-identical) through reduced number
 * precision (keto/crash), holding onadiet's safety guards — never a bigger file, keep the original when it
 * can't be beaten, honest `TARGET_INFEASIBLE`. Permissive-only (svgo is MIT); no rasterization.
 */
export { svgAdapter, looksLikeSvg } from './adapter'
export { configForPlan, optimizeSvg } from './optimize'
