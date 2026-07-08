import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/index'

describe('parseArgs', () => {
  it('treats --to / --under / --goal as the same target', () => {
    for (const flag of ['--to', '--under', '--goal']) {
      const parsed = parseArgs(['a.pdf', flag, '2mb'])
      expect(parsed.kind).toBe('run')
      if (parsed.kind === 'run') expect(parsed.options.targetBytes).toBe(2_000_000)
    }
  })

  it('defaults to slim + the balanced plan', () => {
    const parsed = parseArgs(['a.pdf'])
    expect(parsed).toMatchObject({ kind: 'run', command: 'slim', file: 'a.pdf' })
    if (parsed.kind === 'run') expect(parsed.options.plan).toBe('balanced')
  })

  it('rejects a bad size, a missing size, an unknown plan, and an unknown option', () => {
    expect(parseArgs(['a.pdf', '--to', 'huge']).kind).toBe('usage-error')
    expect(parseArgs(['a.pdf', '--to']).kind).toBe('usage-error')
    expect(parseArgs(['a.pdf', '--plan', 'bogus']).kind).toBe('usage-error')
    expect(parseArgs(['a.pdf', '--nope']).kind).toBe('usage-error')
  })

  it('does not let --out swallow the following flag', () => {
    expect(parseArgs(['a.pdf', '--out', '--json']).kind).toBe('usage-error')
  })

  it('parses the folder budgets --to-each and --max-total (sub-phase 2)', () => {
    const each = parseArgs(['pics', '--to-each', '500kb'])
    expect(each.kind).toBe('run')
    if (each.kind === 'run') expect(each.options.toEach).toBe(500_000)
    const total = parseArgs(['check', 'pics', '--max-total', '25mb'])
    expect(total.kind).toBe('run')
    if (total.kind === 'run') expect(total.options.maxTotal).toBe(25_000_000)
    expect(parseArgs(['pics', '--to-each']).kind).toBe('usage-error') // needs a size
  })

  it('parses --max-input (the fail-fast size guard), rejecting a non-positive cap', () => {
    const p = parseArgs(['pics', '--max-input', '50mb'])
    expect(p.kind).toBe('run')
    if (p.kind === 'run') expect(p.options.maxInputBytes).toBe(50_000_000)
    expect(parseArgs(['a.pdf', '--max-input']).kind).toBe('usage-error') // needs a size
    expect(parseArgs(['a.pdf', '--max-input', 'huge']).kind).toBe('usage-error') // bad size
    expect(parseArgs(['a.pdf', '--max-input', '0']).kind).toBe('usage-error') // 0 is not a meaningful cap
  })

  it('parses --timeout (ms), rejecting non-positive / non-integer values', () => {
    const p = parseArgs(['a.pdf', '--timeout', '5000'])
    expect(p.kind).toBe('run')
    if (p.kind === 'run') expect(p.options.timeoutMs).toBe(5000)
    for (const bad of ['0', '-1', '1.5', 'soon', undefined]) {
      expect(parseArgs(['a.pdf', '--timeout', ...(bad === undefined ? [] : [bad])]).kind).toBe(
        'usage-error',
      )
    }
  })

  it('parses --fast, and rejects combining it with any byte target', () => {
    const p = parseArgs(['a.jpg', '--fast'])
    expect(p.kind).toBe('run')
    if (p.kind === 'run') expect(p.options.fast).toBe(true)
    // --fast means "don't search for a size", so a target is contradictory
    expect(parseArgs(['a.jpg', '--fast', '--to', '1mb']).kind).toBe('usage-error')
    expect(parseArgs(['pics', '--fast', '--to-each', '500kb']).kind).toBe('usage-error')
    expect(parseArgs(['pics', '--fast', '--to-total', '25mb']).kind).toBe('usage-error')
  })

  it('parses --to-total, and rejects combining it with --to-each', () => {
    const t = parseArgs(['pics', '--to-total', '25mb'])
    expect(t.kind).toBe('run')
    if (t.kind === 'run') expect(t.options.toTotal).toBe(25_000_000)
    expect(parseArgs(['pics', '--to-total']).kind).toBe('usage-error') // needs a size
    expect(parseArgs(['pics', '--to-total', '1mb', '--to-each', '100kb']).kind).toBe('usage-error')
  })

  it('rejects an explicit --plan alongside --to-total (the budget owns the dial), but allows it with --to-each', () => {
    // --to-total sweeps the plans itself, so an explicit --plan would be silently ignored → usage error.
    expect(parseArgs(['pics', '--to-total', '25mb', '--plan', 'keto']).kind).toBe('usage-error')
    expect(parseArgs(['pics', '--plan', 'keto', '--to-total', '25mb']).kind).toBe('usage-error')
    // The default plan (no --plan) is fine; --plan with --to-each (per-file) is fine.
    expect(parseArgs(['pics', '--to-total', '25mb']).kind).toBe('run')
    expect(parseArgs(['pics', '--to-each', '500kb', '--plan', 'keto']).kind).toBe('run')
  })

  it('requires a budget for check — --max or --max-total', () => {
    expect(parseArgs(['check', 'a.pdf']).kind).toBe('usage-error')
    expect(parseArgs(['check', 'a.pdf', '--max', '2mb']).kind).toBe('run')
    expect(parseArgs(['check', 'pics', '--max-total', '10mb']).kind).toBe('run')
  })

  it('flags a surplus positional (usually a mistyped verb)', () => {
    expect(parseArgs(['weugh', 'a.pdf']).kind).toBe('usage-error') // typo → slim("weugh") + surplus
    expect(parseArgs(['a.pdf', 'b.pdf']).kind).toBe('usage-error')
    expect(parseArgs(['checkup', 'extra']).kind).toBe('usage-error')
  })

  it('parses a verb + file + --json', () => {
    const parsed = parseArgs(['weigh', 'a.pdf', '--json'])
    expect(parsed).toMatchObject({ kind: 'run', command: 'weigh', file: 'a.pdf' })
    if (parsed.kind === 'run') expect(parsed.options.json).toBe(true)
  })

  it('maps --force / --allow-signed to force', () => {
    for (const flag of ['--force', '--allow-signed']) {
      const parsed = parseArgs(['a.pdf', flag])
      if (parsed.kind === 'run') expect(parsed.options.force).toBe(true)
    }
  })

  it('parses --format for the supported values', () => {
    for (const fmt of ['keep', 'auto', 'jpeg', 'png', 'webp', 'avif']) {
      const parsed = parseArgs(['a.png', '--format', fmt])
      expect(parsed.kind).toBe('run')
      if (parsed.kind === 'run') expect(parsed.options.format).toBe(fmt)
    }
  })

  it('rejects an unknown or missing --format value', () => {
    expect(parseArgs(['a.png', '--format', 'gif']).kind).toBe('usage-error')
    expect(parseArgs(['a.png', '--format']).kind).toBe('usage-error')
  })

  it('leaves format undefined when --format is not given', () => {
    const parsed = parseArgs(['a.png'])
    if (parsed.kind === 'run') expect(parsed.options.format).toBeUndefined()
  })

  it('parses --concurrency / --jobs; auto and 0 fall back to the default (undefined)', () => {
    const c = parseArgs(['pics', '--concurrency', '4'])
    if (c.kind === 'run') expect(c.options.concurrency).toBe(4)
    const j = parseArgs(['pics', '--jobs', '2'])
    if (j.kind === 'run') expect(j.options.concurrency).toBe(2)
    for (const v of ['auto', '0']) {
      const p = parseArgs(['pics', '--concurrency', v])
      expect(p.kind).toBe('run')
      if (p.kind === 'run') expect(p.options.concurrency).toBeUndefined()
    }
    expect(parseArgs(['pics', '--concurrency', 'x']).kind).toBe('usage-error')
    expect(parseArgs(['pics', '--concurrency', '-1']).kind).toBe('usage-error')
    expect(parseArgs(['pics', '--concurrency', '1.5']).kind).toBe('usage-error')
    expect(parseArgs(['pics', '--concurrency']).kind).toBe('usage-error')
  })
})
