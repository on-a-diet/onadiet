/**
 * Plan → svgo configuration, and the thin svgo wrapper the adapter drives.
 *
 * SVG is a **vector** format: there's no raster to re-encode, no perceptual (SSIM) floor, and no downscale.
 * The size levers are (1) stripping non-rendering cruft (editor metadata, comments, empty defs) and
 * (2) shrinking path/number precision. So the diet plans map to svgo aggressiveness, with **float precision
 * as the quality knob** — higher precision = larger + closer to the source geometry:
 *
 *   - `cleanse`  — rendering-IDENTICAL: strip only non-rendering cruft, never touch geometry. Truly lossless.
 *   - `lowcarb`  — visually-lossless: svgo's curated `preset-default` at high precision (5).
 *   - `balanced` — the default: `preset-default` at svgo's own default precision (3).
 *   - `keto`     — aggressive: precision 2 + reuse duplicate paths.
 *   - `crash`    — tiny: precision 1 + reuse duplicate paths.
 *
 * `preset-default` is svgo's rendering-safe curated plugin set. We deliberately do NOT enable `removeScripts`,
 * `removeViewBox`, `removeDimensions`, or `removeTitle`/`removeDesc` beyond the preset — those change
 * behaviour, scaling, or accessibility, which would violate "preserve what the user can see / relies on".
 */
import { optimize as runSvgo } from 'svgo'
import type { Config, PluginConfig } from 'svgo'
import { OnadietError } from '@onadiet/core'
import type { DietPlan } from '@onadiet/core'

/** `preset-default` at a given float precision, plus any extra rendering-safe plugins. */
function preset(floatPrecision: number, extra: readonly PluginConfig[] = []): Config {
  return {
    multipass: true,
    plugins: [{ name: 'preset-default', params: { floatPrecision } }, ...extra],
  }
}

const CONFIGS: Readonly<Record<DietPlan, Config>> = {
  // Rendering-identical: only non-rendering cruft, no geometry/precision changes. No preset-default (its
  // path/number optimizers would round coordinates).
  cleanse: {
    multipass: true,
    plugins: [
      'removeComments',
      'removeMetadata',
      'removeEditorsNSData',
      'removeDoctype',
      'removeXMLProcInst',
      'cleanupAttrs',
      'removeEmptyAttrs',
      'removeEmptyText',
      'removeEmptyContainers',
      'removeUnusedNS',
    ],
  },
  lowcarb: preset(5),
  balanced: preset(3),
  keto: preset(2, ['reusePaths']),
  crash: preset(1, ['reusePaths']),
}

/** The svgo {@link Config} for a plan. */
export function configForPlan(plan: DietPlan): Config {
  const config = CONFIGS[plan]
  if (config === undefined) {
    throw new OnadietError('UNKNOWN_PLAN', `No SVG config for plan: "${plan}".`)
  }
  return config
}

/**
 * Optimize an SVG string under a plan. Returns the optimized markup. Throws a typed
 * {@link OnadietError} (`UNSUPPORTED_INPUT`) if svgo can't parse the input as SVG.
 */
export function optimizeSvg(input: string, plan: DietPlan): string {
  let result
  try {
    result = runSvgo(input, configForPlan(plan))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new OnadietError('UNSUPPORTED_INPUT', `Could not parse SVG: ${message}`)
  }
  return result.data
}
