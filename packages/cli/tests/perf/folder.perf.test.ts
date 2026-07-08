/**
 * FOLDER PERF HARNESS (v0.4 P4) — LOCAL/manual `pnpm run test:perf`, NOT in CI.
 *
 * Measures the two folder-mode numbers the performance pillar ([docs/08-PERFORMANCE.md]) promises, driving
 * the real `diet ./dir` end-to-end (`run` + `nodePorts` + real adapters) over a temp-filesystem tree:
 *   1. throughput — sequential (`--concurrency 1`) vs the default parallel fan-out (a ~2.9× win here);
 *   2. bounded memory — peak process RSS stays ~flat as the tree size doubles (the P1 stream-to-disk claim:
 *      peak ≈ concurrency, not tree size), rather than growing with the file count.
 *
 * Absolute numbers are machine-dependent, so this asserts only ROBUST invariants — parallel beats sequential,
 * the output tree is byte-identical at any concurrency (determinism), the run succeeded — and PRINTS the
 * absolutes (+ a delta vs `baseline.json`) for the README. It never hard-fails on an absolute threshold.
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { measure, mib, reportPerf } from '@onadiet/testkit'
import type { PerfSample } from '@onadiet/testkit'
import { run, nodePorts } from '../../src/index'

const SMALL = 24 // files in the small tree
const LARGE = 48 // files in the large tree — exactly 2× SMALL, so RSS-vs-size is a clean doubling

// The concurrency `--concurrency auto` actually resolves to (mirror of run.ts). On a 1–2 core box this is 1,
// so `auto` === sequential and the "parallel is faster" assertion is meaningless — gate it on this.
const EFFECTIVE_AUTO = Math.max(1, Math.min(availableParallelism() - 1, 8))

/** A compressible gradient JPEG (real encoders slim it reliably); identical content, unique names per file. */
async function jpeg(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3
      raw[i] = Math.round((x * 255) / (w - 1))
      raw[i + 1] = Math.round((y * 255) / (h - 1))
      raw[i + 2] = 128
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer()
}

async function buildTree(root: string, count: number, photo: Buffer): Promise<void> {
  await mkdir(root, { recursive: true })
  for (let i = 0; i < count; i += 1) {
    await writeFile(join(root, `img-${String(i).padStart(3, '0')}.jpg`), photo)
  }
}

/** Recursively read an output tree into relpath → bytes, for a byte-identical determinism comparison. */
async function readTree(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) await walk(p)
      else out.set(relative(root, p), await readFile(p))
    }
  }
  await walk(root)
  return out
}

const baseline: Record<string, number> = (() => {
  try {
    return JSON.parse(
      readFileSync(fileURLToPath(new URL('./baseline.json', import.meta.url)), 'utf8'),
    )
  } catch {
    return {}
  }
})()

describe('folder perf — throughput (sequential vs parallel) + bounded memory', () => {
  let work: string
  let smallDir: string
  let largeDir: string
  // Measured runs, keyed for the tables + assertions.
  const seqSmall = { sample: undefined as unknown as PerfSample, out: '' }
  const parSmall = { sample: undefined as unknown as PerfSample, out: '' }
  const parLarge = { sample: undefined as unknown as PerfSample, out: '' }

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'onadiet-perf-'))
    smallDir = join(work, 'small')
    largeDir = join(work, 'large')
    const photo = await jpeg(480, 480)
    await buildTree(smallDir, SMALL, photo)
    await buildTree(largeDir, LARGE, photo)

    // Warm the adapters once (native init) before the first measured run.
    await run([smallDir, '--out', join(work, 'warm'), '--concurrency', '1', '--json'], nodePorts)

    seqSmall.out = join(work, 'seq-small')
    parSmall.out = join(work, 'par-small')
    parLarge.out = join(work, 'par-large')
    // Sequential vs the DEFAULT parallel (`auto` = min(cores−1, 8)) — the comparison a user actually sees.
    seqSmall.sample = await measure(() =>
      run([smallDir, '--out', seqSmall.out, '--concurrency', '1', '--json'], nodePorts),
    )
    parSmall.sample = await measure(() =>
      run([smallDir, '--out', parSmall.out, '--concurrency', 'auto', '--json'], nodePorts),
    )
    // Same concurrency, 2× the files — peak RSS should stay ~flat (bounded by concurrency, not tree size).
    parLarge.sample = await measure(() =>
      run([largeDir, '--out', parLarge.out, '--concurrency', 'auto', '--json'], nodePorts),
    )
  }, 900_000)

  afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true })
  })

  it('produces a byte-identical output tree at any concurrency (determinism holds under the fan-out)', async () => {
    const seq = await readTree(seqSmall.out)
    const par = await readTree(parSmall.out)
    expect(par.size).toBe(seq.size)
    expect(par.size).toBeGreaterThanOrEqual(SMALL)
    for (const [rel, bytes] of seq) {
      const other = par.get(rel)
      expect(other, rel).toBeDefined()
      expect(Buffer.compare(bytes, other as Buffer), rel).toBe(0)
    }
  })

  // Skipped on a 1–2 core box, where `auto` resolves to 1 (= sequential) and the ratio is ~1.0 by
  // construction — asserting a speedup there would fail deterministically, not flake. The throughput table
  // (printed by the last test) still runs so the numbers are always emitted.
  it.skipIf(EFFECTIVE_AUTO < 2)(
    'the default parallel fan-out is meaningfully faster than sequential',
    () => {
      // Measured ~2.9× on this dev box; assert only a robust floor (≥20% faster) so it can't flake on a
      // busy/thermally-throttled machine, and print the real ratio.
      expect(parSmall.sample.ms).toBeLessThan(seqSmall.sample.ms * 0.8)
    },
  )

  it('peak RSS stays bounded as the tree doubles (coarse gross-regression guard)', () => {
    // Honest about what this is: peak RSS is PROCESS-WIDE and sticky (the allocator rarely returns freed
    // pages), and parLarge runs after parSmall in the same process, so this is a COARSE guard against a gross
    // regression to unbounded buffering (peak scaling with file count) — not a precise per-run working-set
    // delta. The bounded-memory GUARANTEE is the P1 stream-to-disk design + the byte-identical determinism
    // test above; this number only corroborates it. Generous 1.5× ceiling absorbs native-heap/GC noise while
    // still tripping if peak grew tree-size-proportionally.
    expect(parLarge.sample.peakRssBytes).toBeLessThan(parSmall.sample.peakRssBytes * 1.5)
  })

  it('prints the throughput + bounded-memory tables (the README numbers)', () => {
    const rate = (n: number, s: PerfSample): string => `${(n / (s.ms / 1000)).toFixed(1)} files/s`
    const speedup = (seqSmall.sample.ms / parSmall.sample.ms).toFixed(1)
    reportPerf(
      `folder throughput — ${SMALL}× 480×480 JPEG, sequential vs default parallel`,
      [
        {
          label: `--concurrency 1 (${SMALL} files)`,
          ms: seqSmall.sample.ms,
          note: `→ ${rate(SMALL, seqSmall.sample)}`,
        },
        {
          label: `--concurrency auto (${SMALL} files)`,
          ms: parSmall.sample.ms,
          note: `→ ${rate(SMALL, parSmall.sample)}, ${speedup}× faster`,
        },
      ],
      baseline,
    )
    reportPerf(
      'bounded memory — peak RSS as the tree doubles (same concurrency)',
      [
        {
          label: `${SMALL} files (auto)`,
          ms: parSmall.sample.ms,
          note: `peak RSS ${mib(parSmall.sample.peakRssBytes)} MiB`,
        },
        {
          label: `${LARGE} files (auto)`,
          ms: parLarge.sample.ms,
          note: `peak RSS ${mib(parLarge.sample.peakRssBytes)} MiB`,
        },
      ],
      baseline,
    )
    console.log(
      `baseline.json seed:\n${JSON.stringify(
        {
          [`--concurrency 1 (${SMALL} files)`]: Math.round(seqSmall.sample.ms),
          [`--concurrency auto (${SMALL} files)`]: Math.round(parSmall.sample.ms),
          [`${LARGE} files (auto)`]: Math.round(parLarge.sample.ms),
        },
        null,
        2,
      )}`,
    )
    expect(parSmall.sample.ms).toBeGreaterThan(0)
  })
})
