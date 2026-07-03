/**
 * Perf-harness helpers for the LOCAL/manual `test:perf` suites — deliberately NOT wired into CI (the
 * numbers are machine-dependent, so a per-PR gate would be flaky and burn Actions minutes). Their product is
 * the measured wall-time + peak-RSS numbers published in the README's "Measured, not promised" section.
 *
 * Because the numbers are absolute and machine-dependent, `test:perf` asserts only ROBUST relative
 * invariants (fast < full search; parallel < sequential; output still byte-identical) and PRINTS the
 * absolutes plus a delta vs a committed `baseline.json`. It never hard-fails on an absolute threshold.
 */
import { performance } from 'node:perf_hooks'

export interface PerfSample {
  /** Wall-clock milliseconds for the measured call. */
  readonly ms: number
  /** Peak process RSS (bytes) sampled DURING the call — an OOM/ceiling signal, not a per-op delta. */
  readonly peakRssBytes: number
}

/**
 * Run `fn` once, returning its wall time and the peak process RSS observed while it ran. RSS is sampled on a
 * short interval; the heavy encoders (sharp/libvips) run on the libuv threadpool, so the JS event loop stays
 * free to sample even during a large encode. Warm the codepath once before measuring if first-call JIT /
 * native-addon init would skew the number.
 */
export async function measure(fn: () => Promise<unknown>): Promise<PerfSample> {
  let peak = process.memoryUsage().rss
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss
    if (rss > peak) peak = rss
  }, 15)
  // Never let the sampler alone keep the process alive.
  sampler.unref?.()
  const start = performance.now()
  try {
    await fn()
  } finally {
    clearInterval(sampler)
  }
  return { ms: performance.now() - start, peakRssBytes: peak }
}

/** Bytes → whole MiB (one decimal), for human-readable RSS/size reporting. */
export const mib = (bytes: number): number => Math.round((bytes / (1024 * 1024)) * 10) / 10

const fmtMs = (n: number): string => `${Math.round(n)} ms`
const signedPct = (measured: number, base: number): string => {
  if (base === 0) return 'n/a'
  const pct = Math.round(((measured - base) / base) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

export interface PerfRow {
  /** Row label; also the key looked up in `baseline` for the delta. */
  readonly label: string
  /** Measured wall time (ms) for the row. */
  readonly ms: number
  /** Optional trailing note (throughput, size, RSS, chosen method…). */
  readonly note?: string
}

/**
 * Print a labeled perf table to the console — the harness's actual output. When a `baseline` map (label → ms)
 * is supplied, each row shows a signed % delta so a local regression is obvious. Pure I/O, no assertions.
 */
export function reportPerf(
  title: string,
  rows: readonly PerfRow[],
  baseline?: Readonly<Record<string, number>>,
): void {
  const width = rows.length > 0 ? Math.max(...rows.map((r) => r.label.length)) : 0
  const lines = rows.map((r) => {
    const base = baseline?.[r.label]
    const delta = base !== undefined ? `  (baseline ${fmtMs(base)}, ${signedPct(r.ms, base)})` : ''
    const note = r.note !== undefined ? `  ${r.note}` : ''
    return `  ${r.label.padEnd(width)}  ${fmtMs(r.ms).padStart(9)}${note}${delta}`
  })
  console.log(`\n${title}\n${lines.join('\n')}\n`)
}
