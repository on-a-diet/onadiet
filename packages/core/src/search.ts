/**
 * SizeSearch — the pure, dual-constraint convergence loop.
 *
 * Two constraints at once: hit an optional **byte target** AND hold a hard **quality floor**. It walks the
 * degrade ladder (quality → downscale → recode) building a per-image chain of floor-holding candidates,
 * then greedily applies the biggest byte savings first until the target is met — or reports honest
 * infeasibility when every image is already at its floor. See [the PDF guide](../../../docs/guide/pdf.md).
 *
 * Purity: this drives images only through the injected {@link ImageLever.evaluate}; it never touches pixels,
 * I/O, the clock, or randomness. That is what makes it fully unit-testable with fake levers.
 */
import { OnadietError, throwIfAborted } from './types'
import type {
  Candidate,
  EncodeParams,
  ImageDecision,
  ImageLever,
  Ladder,
  SearchResult,
  SlimConstraints,
} from './seams'

/** The ladder as a flat list of operating points, in try-order (quality first, then downscale, then recode). */
function orderedGrid(ladder: Ladder): EncodeParams[] {
  const grid: EncodeParams[] = []
  const recodeFlags = ladder.allowRecodeToJpeg ? [false, true] : [false]
  for (const recodeToJpeg of recodeFlags) {
    for (const scale of ladder.scale) {
      for (const quality of ladder.quality) {
        grid.push({ quality, scale, recodeToJpeg })
      }
    }
  }
  return grid
}

/** Evaluate an image at every ladder operating point (in ladder order). Aborts promptly between operating
 * points — each `evaluate` is a full encode+decode+SSIM, so this is the finest-grained cancellation point. */
async function evaluateGrid(
  lever: ImageLever,
  grid: readonly EncodeParams[],
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const evaluated: Candidate[] = []
  for (const params of grid) {
    throwIfAborted(signal)
    evaluated.push(await lever.evaluate(params))
  }
  return evaluated
}

/**
 * A **monotonically shrinking** chain from a list of candidates (in ladder order): each kept candidate is
 * strictly smaller than the gentlest one before it, and than the original — so a chosen candidate never
 * grows the file. Filter by the floor *before* calling this (a below-floor tiny candidate must not shadow a
 * larger floor-holding one).
 */
function monotonicChain(candidates: readonly Candidate[], originalBytes: number): Candidate[] {
  const chain: Candidate[] = []
  let smallestSoFar = originalBytes
  for (const candidate of candidates) {
    if (candidate.bytes < smallestSoFar) {
      chain.push(candidate)
      smallestSoFar = candidate.bytes
    }
  }
  return chain
}

/** The smallest bytes reachable from a chain, or the original if the chain is empty. */
function minBytesOf(chain: readonly Candidate[], originalBytes: number): number {
  const last = chain[chain.length - 1]
  return last?.bytes ?? originalBytes
}

/** Sum of the currently-chosen (or original) bytes across all images, plus the fixed bytes. */
function totalOf(decisions: readonly ImageDecision[], fixedBytes: number): number {
  let total = fixedBytes
  for (const d of decisions) total += d.chosen?.bytes ?? d.originalBytes
  return total
}

/**
 * Converge a set of slimmable images toward the constraints.
 *
 * @param images     the slimmable images, each exposing an injected `evaluate`
 * @param fixedBytes bytes the search can't reduce (structure, text, fonts)
 * @param ladder     the plan-derived degrade ladder
 * @param constraints the byte target (optional) + quality floor
 */
export async function searchSize(
  images: readonly ImageLever[],
  fixedBytes: number,
  ladder: Ladder,
  constraints: SlimConstraints,
): Promise<SearchResult> {
  if (!Number.isFinite(fixedBytes) || fixedBytes < 0) {
    throw new OnadietError(
      'INVALID_SIZE',
      `fixedBytes must be a non-negative number, got ${fixedBytes}`,
    )
  }
  if (constraints.floor < 0 || constraints.floor > 1 || !Number.isFinite(constraints.floor)) {
    throw new OnadietError(
      'INVALID_SIZE',
      `floor must be between 0 and 1, got ${constraints.floor}`,
    )
  }
  const { targetBytes } = constraints
  if (targetBytes !== undefined && (!Number.isFinite(targetBytes) || targetBytes <= 0)) {
    throw new OnadietError(
      'INVALID_SIZE',
      `targetBytes must be a positive number, got ${targetBytes}`,
    )
  }

  const originalTotal = fixedBytes + images.reduce((sum, img) => sum + img.originalBytes, 0)

  // Already under the target? Touch nothing.
  if (targetBytes !== undefined && originalTotal <= targetBytes) {
    return {
      outcome: 'already-under',
      decisions: images.map((img) => ({
        id: img.id,
        originalBytes: img.originalBytes,
        chosen: null,
      })),
      fixedBytes,
      totalBytes: originalTotal,
      feasible: true,
    }
  }

  throwIfAborted(constraints.signal) // bail before the expensive grid evaluation if already cancelled
  // Fast path: restrict the grid to its gentlest (nominal-quality) operating point — one encode+SSIM per
  // image instead of the whole ladder. Honesty is unchanged because this point still runs through the same
  // floor filter below (`c.quality >= floor`) as every other point — it isn't trusted "by construction".
  // Being the least-degraded point it holds the highest SSIM, so it's the most likely to clear the floor;
  // if it fails the floor or can't beat the original, the filter/monotonic chain drops it and the original
  // is kept. Only meaningful in plan-only mode (no byte target) — a target still needs the full search.
  const fullGrid = orderedGrid(ladder)
  const grid =
    constraints.fast === true && targetBytes === undefined ? fullGrid.slice(0, 1) : fullGrid
  // Evaluate each image across the ladder once; derive both the floor-holding chain the search walks and
  // (lazily, only if we end up infeasible) the floorless minimum used to attribute the infeasibility.
  const evaluated = await Promise.all(
    images.map((img) => evaluateGrid(img, grid, constraints.signal)),
  )
  const chains = images.map((img, i) =>
    monotonicChain(
      (evaluated[i] ?? []).filter((c) => c.quality >= constraints.floor),
      img.originalBytes,
    ),
  )

  // Mutable per-image operating index: -1 = original, else index into that image's chain.
  const chosenIndex = images.map(() => -1)
  const snapshot = (): ImageDecision[] =>
    images.map((img, i) => {
      const idx = chosenIndex[i] ?? -1
      const chain = chains[i] ?? []
      return {
        id: img.id,
        originalBytes: img.originalBytes,
        chosen: idx >= 0 ? (chain[idx] ?? null) : null,
      }
    })

  // Plan-only mode: no numeric target — slim each image as far as the floor allows.
  if (targetBytes === undefined) {
    for (let i = 0; i < images.length; i += 1) {
      const chain = chains[i] ?? []
      chosenIndex[i] = chain.length - 1 // -1 when the chain is empty (nothing beat the original)
    }
    const decisions = snapshot()
    return {
      outcome: 'slimmed-plan-only',
      decisions,
      fixedBytes,
      totalBytes: totalOf(decisions, fixedBytes),
      feasible: decisions.some((d) => d.chosen !== null),
    }
  }

  // Target mode: greedily apply the biggest single-step saving until we're under target.
  let total = originalTotal
  while (total > targetBytes) {
    let bestImage = -1
    let bestSaving = 0
    for (let i = 0; i < images.length; i += 1) {
      const chain = chains[i] ?? []
      const idx = chosenIndex[i] ?? -1
      const next = chain[idx + 1]
      if (next === undefined) continue // this image is at its floor
      const currentBytes = idx >= 0 ? (chain[idx]?.bytes ?? 0) : (images[i]?.originalBytes ?? 0)
      const saving = currentBytes - next.bytes
      if (saving > bestSaving) {
        bestImage = i
        bestSaving = saving
      }
    }
    if (bestImage < 0) break // every image is at its floor; can't shrink further
    chosenIndex[bestImage] = (chosenIndex[bestImage] ?? -1) + 1
    total -= bestSaving
  }

  const decisions = snapshot()
  const finalTotal = totalOf(decisions, fixedBytes)
  if (finalTotal <= targetBytes) {
    return {
      outcome: 'under-target',
      decisions,
      fixedBytes,
      totalBytes: finalTotal,
      feasible: true,
    }
  }

  // Infeasible: attribute it honestly. Would removing the floor (same ladder) have reached the target?
  // If yes, the floor is the binding constraint; if not, it's structural/incompressible.
  const floorlessMinTotal = images.reduce(
    (sum, img, i) =>
      sum + minBytesOf(monotonicChain(evaluated[i] ?? [], img.originalBytes), img.originalBytes),
    fixedBytes,
  )
  return {
    outcome: floorlessMinTotal <= targetBytes ? 'infeasible-floor-hit' : 'infeasible',
    decisions,
    fixedBytes,
    totalBytes: finalTotal,
    feasible: false,
  }
}
