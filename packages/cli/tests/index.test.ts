import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import sharp from 'sharp'
import { COMMANDS, run, type CliPorts } from '../src/index'
import { exitForCode } from '../src/run' // internal — deterministic exit-code mapping

/**
 * In-memory ports: reads from a fixed file map, records atomic writes. The map's `/`-separated keys also
 * model a directory tree — `isDirectory`/`readDir` derive folders from the keys — so folder mode is testable
 * without touching disk. A flat key (no `/`) reads as a file, so the single-file tests still route as before.
 * `opts.symlinks`/`opts.sameAs` let a test drive the output-safety guards (symlinked / aliased output root).
 */
function fakePorts(
  files: Record<string, Uint8Array> = {},
  opts: {
    symlinks?: readonly string[]
    sameAs?: ReadonlyArray<readonly [string, string]>
    /** Simulate a TOCTOU tree change: these files APPEAR once the walk count exceeds `count` (e.g. a file
     *  added between a dry-run sweep and the real write pass). Used to drive the --to-total overran guard. */
    appearAfterWalks?: { count: number; files: Record<string, Uint8Array> }
  } = {},
): CliPorts & {
  readonly written: Map<string, Uint8Array>
  readonly staged: Map<string, Uint8Array>
} {
  const written = new Map<string, Uint8Array>()
  const staged = new Map<string, Uint8Array>() // tempPath → bytes, mirrors on-disk staged slim outputs
  let tempSeq = 0
  const norm = (p: string): string => p.replace(/\/+$/, '')
  const appear = opts.appearAfterWalks
  let walks = 0
  let extraActive = false
  // The live file view: base files, plus the deferred TOCTOU files once activated by the walk counter.
  const view = (): Record<string, Uint8Array> =>
    extraActive && appear ? { ...files, ...appear.files } : files
  const keys = (): string[] => Object.keys(view())
  const symlinks = new Set((opts.symlinks ?? []).map(norm))
  const sameAs = (opts.sameAs ?? []).map(([a, b]) => [norm(a), norm(b)] as const)
  return {
    written,
    staged,
    readFile: async (path) => {
      const found = view()[norm(path)]
      if (found === undefined) throw new Error(`ENOENT: ${path}`)
      return found
    },
    writeFileAtomic: async (path, bytes) => {
      written.set(path, bytes)
    },
    stageTemp: async (dir, bytes) => {
      const p = `${norm(dir)}/.stage-${tempSeq++}.tmp`
      staged.set(p, bytes)
      return p
    },
    commitStaged: async (tempPath, dest) => {
      const b = staged.get(tempPath)
      if (b === undefined) throw new Error(`no staged temp: ${tempPath}`)
      staged.delete(tempPath)
      written.set(dest, b)
    },
    removeTemp: async (tempPath) => {
      staged.delete(tempPath)
    },
    sameFile: async (a, b) =>
      sameAs.some(([x, y]) => (norm(a) === x && norm(b) === y) || (norm(a) === y && norm(b) === x)),
    isDirectory: async (path) => {
      const prefix = `${norm(path)}/`
      return keys().some((k) => k.startsWith(prefix)) // a dir iff some file lives under it
    },
    size: async (path) => {
      const found = view()[norm(path)]
      if (found === undefined) throw new Error(`ENOENT: ${path}`)
      return found.length
    },
    isSymlink: async (path) => symlinks.has(norm(path)),
    readDir: async (path) => {
      // Count directory walks; once past the threshold, the deferred TOCTOU files become visible.
      walks += 1
      if (appear && walks > appear.count) extraActive = true
      const prefix = norm(path) === '' ? '' : `${norm(path)}/`
      const dirs = new Set<string>()
      const fileNames = new Set<string>()
      for (const k of keys()) {
        if (!k.startsWith(prefix)) continue
        const rest = k.slice(prefix.length)
        const slash = rest.indexOf('/')
        if (slash === -1) fileNames.add(rest)
        else dirs.add(rest.slice(0, slash))
      }
      return [
        ...[...dirs].map((name) => ({
          name,
          isDirectory: true,
          isSymbolicLink: false,
          isFile: false,
        })),
        ...[...fileNames]
          .filter((n) => !dirs.has(n))
          .map((name) => ({ name, isDirectory: false, isSymbolicLink: false, isFile: true })),
      ]
    },
    mkdirp: async () => {},
  }
}

/** A one-page PDF with a compressible gradient JPEG (crash reliably slims it). */
async function imagePdf(signed = false): Promise<Uint8Array> {
  const W = 900
  const H = 900
  const raw = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3
      raw[i] = Math.round((x * 255) / (W - 1))
      raw[i + 1] = Math.round((y * 255) / (H - 1))
      raw[i + 2] = 128
    }
  }
  const jpeg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer()
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(jpeg)
  doc.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 })
  if (signed) {
    doc.catalog.set(
      PDFName.of('AcroForm'),
      doc.context.register(doc.context.obj({ SigFlags: 3, Fields: [] })),
    )
  }
  return doc.save()
}

describe('diet CLI — usage', () => {
  it('prints help for no args / --help (code 0)', async () => {
    for (const argv of [[], ['--help'], ['-h']]) {
      const res = await run(argv, fakePorts())
      expect(res.code).toBe(0)
      expect(res.output).toContain('onadiet')
      expect(res.output).toContain('Usage:')
    }
  })

  it('rejects an unknown option (code 3)', async () => {
    const res = await run(['--nope'], fakePorts())
    expect(res.code).toBe(3)
    expect(res.output).toContain('unknown option')
  })

  it('errors when a verb is missing its file (code 3)', async () => {
    expect((await run(['weigh'], fakePorts())).code).toBe(3)
  })

  it('has a checkup that lists engines incl. svg (code 0)', async () => {
    const res = await run(['checkup'], fakePorts())
    expect(res.code).toBe(0)
    const lower = res.output.toLowerCase()
    expect(lower).toContain('pdf')
    expect(lower).toContain('image')
    expect(lower).toContain('svg')
    expect(COMMANDS).toContain('checkup')
  })
})

describe('diet CLI — file commands', () => {
  it('weighs a PDF (code 0, no writes)', async () => {
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    const res = await run(['weigh', 'a.pdf'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toContain('weighs')
    expect(ports.written.size).toBe(0)
  })

  it('slims a PDF to *.diet.pdf, smaller, without touching the original', async () => {
    const input = await imagePdf()
    const ports = fakePorts({ 'a.pdf': input })
    const res = await run(
      ['a.pdf', '--plan', 'crash', '--to', String(Math.floor(input.length / 2))],
      ports,
    )
    expect(res.code).toBe(0)
    const out = ports.written.get('a.diet.pdf')
    expect(out).toBeDefined()
    expect((out as Uint8Array).length).toBeLessThan(input.length)
    expect(ports.written.has('a.pdf')).toBe(false) // original untouched
  })

  it('plan is a dry-run — reports but writes nothing', async () => {
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    const res = await run(['plan', 'a.pdf', '--plan', 'crash'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toContain('would slim')
    expect(ports.written.size).toBe(0)
  })

  it('check passes/fails against a budget', async () => {
    const input = await imagePdf()
    const ports = fakePorts({ 'a.pdf': input })
    expect((await run(['check', 'a.pdf', '--max', String(input.length + 1000)], ports)).code).toBe(
      0,
    )
    const fail = await run(['check', 'a.pdf', '--max', '1kb'], ports)
    expect(fail.code).toBe(1)
    expect(fail.output).toContain('FAIL')
  })

  it('check without a budget is a usage error (code 3)', async () => {
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    expect((await run(['check', 'a.pdf'], ports)).code).toBe(3)
  })

  it('check is a pure size gate — works on any file, no recognized type needed', async () => {
    const ports = fakePorts({ 'notes.txt': new TextEncoder().encode('x'.repeat(5000)) })
    expect((await run(['check', 'notes.txt', '--max', '10kb'], ports)).code).toBe(0)
    expect((await run(['check', 'notes.txt', '--max', '1kb'], ports)).code).toBe(1)
  })

  it('single-file check: --max-total works, and both budgets bind (no false green)', async () => {
    const input = await imagePdf()
    const ports = fakePorts({ 'a.pdf': input })
    // --max-total alone works as the file's budget
    expect(
      (await run(['check', 'a.pdf', '--max-total', String(input.length + 1000)], ports)).code,
    ).toBe(0)
    expect((await run(['check', 'a.pdf', '--max-total', '1kb'], ports)).code).toBe(1)
    // both given → must satisfy EACH; a tiny --max-total fails even under a huge --max (the regression)
    expect(
      (await run(['check', 'a.pdf', '--max', '100mb', '--max-total', '1kb'], ports)).code,
    ).toBe(1)
    // JSON echoes back exactly the budget that was passed, under its own key
    const json = JSON.parse(
      (await run(['check', 'a.pdf', '--max-total', '1kb', '--json'], ports)).output,
    )
    expect(json).toMatchObject({ action: 'check', maxTotal: 1000 })
    expect(json.maxBytes).toBeUndefined()
  })

  it('--max-input rejects an oversized file by stat, before slimming (code 2, no read)', async () => {
    const input = await imagePdf()
    let reads = 0
    const base = fakePorts({ 'a.pdf': input })
    const ports = {
      ...base,
      readFile: async (p: string) => {
        reads += 1
        return base.readFile(p)
      },
    }
    const res = await run(['a.pdf', '--max-input', '1kb'], ports) // the pdf is well over 1 KB
    expect(res.code).toBe(2)
    expect(res.output).toMatch(/max-input/)
    expect(reads).toBe(0) // rejected by stat — never read into memory
    expect(base.written.size).toBe(0)
    // weigh also reads+decodes, so the cap applies there too
    expect((await run(['weigh', 'a.pdf', '--max-input', '1kb'], base)).code).toBe(2)
    // under the cap it proceeds normally
    expect((await run(['a.pdf', '--max-input', '100mb'], base)).code).toBe(0)
  })

  it('--max-input does not block check, which is stat-only (never reads the body)', async () => {
    const big = new TextEncoder().encode('x'.repeat(5000))
    let reads = 0
    const base = fakePorts({ 'notes.txt': big })
    const ports = {
      ...base,
      readFile: async (p: string) => {
        reads += 1
        return base.readFile(p)
      },
    }
    // check ignores --max-input, reports the verdict, and never reads the file (measured by stat)
    expect(
      (await run(['check', 'notes.txt', '--max', '10kb', '--max-input', '1kb'], ports)).code,
    ).toBe(0)
    expect(reads).toBe(0) // pure size gate — no body read even without --max-input
    expect((await run(['check', 'notes.txt', '--max', '1kb'], ports)).code).toBe(1)
    expect(reads).toBe(0)
  })

  it('maps the ABORTED code to exit 2 (deterministic, no timing)', () => {
    expect(exitForCode('ABORTED')).toBe(2)
    expect(exitForCode('SIGNED_PDF')).toBe(4) // spot-check the rest of the table is intact
    expect(exitForCode('TARGET_INFEASIBLE')).toBe(1)
    expect(exitForCode('INVALID_SIZE')).toBe(3)
  })

  it('--timeout aborts a slim that outlives the deadline (exit 2, no write)', async () => {
    // A real PDF slim runs a multi-ms SSIM search over the embedded image; a 1 ms deadline fires during it.
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    const res = await run(['a.pdf', '--plan', 'crash', '--timeout', '1'], ports)
    expect(res.code).toBe(2)
    expect(res.output).toMatch(/abort/i)
    expect(ports.written.size).toBe(0) // aborted mid-slim → nothing written
    // a generous deadline lets the same slim finish
    expect((await run(['a.pdf', '--plan', 'crash', '--timeout', '60000'], ports)).code).toBe(0)
  })

  it('--fast slims once at nominal quality (exit 0); --fast + --to is a usage error', async () => {
    const input = await imagePdf() // embeds a q92 JPEG → nominal q85 re-encode shrinks it
    const ports = fakePorts({ 'a.pdf': input })
    const res = await run(['a.pdf', '--fast'], ports)
    expect(res.code).toBe(0)
    const out = ports.written.get('a.diet.pdf')
    expect(out).toBeDefined()
    expect((out as Uint8Array).length).toBeLessThan(input.length)
    // --fast skips the size search, so a byte target is contradictory
    expect((await run(['a.pdf', '--fast', '--to', '1mb'], ports)).code).toBe(3)
  })

  it('refuses a signed PDF (code 4) unless --force', async () => {
    const ports = fakePorts({ 's.pdf': await imagePdf(true) })
    const refused = await run(['s.pdf', '--plan', 'crash'], ports)
    expect(refused.code).toBe(4)
    expect(ports.written.size).toBe(0)
    const forced = await run(['s.pdf', '--plan', 'crash', '--force'], ports)
    expect(forced.code).toBe(0)
  })

  it('refuses to overwrite the original when --out resolves to it (code 4)', async () => {
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    const res = await run(['a.pdf', '--out', '.', '--plan', 'crash'], ports)
    expect(res.code).toBe(4)
    expect(ports.written.size).toBe(0)
  })

  it('reports a non-PDF as unsupported (code 2)', async () => {
    const ports = fakePorts({ 'x.txt': new TextEncoder().encode('hello') })
    expect((await run(['weigh', 'x.txt'], ports)).code).toBe(2)
  })

  it('rejects --to-each on a single file (folder-only flag, code 3)', async () => {
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    const res = await run(['a.pdf', '--to-each', '500kb'], ports)
    expect(res.code).toBe(3)
    expect(res.output).toMatch(/--to-each/)
  })

  it('reports a missing file (code 2)', async () => {
    expect((await run(['weigh', 'missing.pdf'], fakePorts())).code).toBe(2)
  })

  it('reports an infeasible target as exit 1 (no write)', async () => {
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    const res = await run(['a.pdf', '--plan', 'lowcarb', '--to', '1kb'], ports)
    expect(res.code).toBe(1)
    expect(ports.written.size).toBe(0)
  })

  it('keeps the original (exit 0, no write) when already under target', async () => {
    const input = await imagePdf()
    const ports = fakePorts({ 'a.pdf': input })
    const res = await run(['a.pdf', '--to', String(input.length * 2)], ports)
    expect(res.code).toBe(0)
    expect(ports.written.size).toBe(0)
  })

  it('routes an SVG to the svg adapter and writes .diet.svg (code 0)', async () => {
    // Locks selectAdapter → svgAdapter and the outputPath `.svg` fallback (svg isn't a raster format).
    const svg = new TextEncoder().encode(
      '<?xml version="1.0"?><!-- editor --><svg xmlns="http://www.w3.org/2000/svg" width="100" ' +
        'height="100"><metadata>x</metadata><rect x="10.0000" y="10.0000" width="80" height="80"/></svg>',
    )
    const ports = fakePorts({ 'logo.svg': svg })
    const res = await run(['logo.svg', '--plan', 'balanced'], ports)
    expect(res.code).toBe(0)
    const out = ports.written.get('logo.diet.svg') // .svg preserved — not a raster extension switch
    expect(out).toBeDefined()
    expect(out!.length).toBeLessThan(svg.length)
    expect(new TextDecoder().decode(out!)).toMatch(/<svg[\s>]/)
    expect(ports.written.has('logo.svg')).toBe(false) // original untouched
  })
})

describe('diet CLI — folder mode', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
  const messySvg = enc(
    '<?xml version="1.0"?><!-- x --><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
      '<metadata>m</metadata><rect x="10.0000" y="10.0000" width="80" height="80"/></svg>',
  )
  /** A compressible standalone PNG (keto reliably slims it). */
  async function gradientPng(w = 240, h = 240): Promise<Uint8Array> {
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
      .png()
      .toBuffer()
  }

  /**
   * A photographic-noise JPEG: high-frequency content so lossy re-encodes produce a real size gradient across
   * plans (cleanse lossless > balanced > … ). Deterministic (a seeded LCG, no Math.random) so the corpus is
   * stable across runs — lets a test MEASURE each plan's total and pin an exact interior rung.
   */
  async function noisyJpeg(w = 320, h = 320): Promise<Uint8Array> {
    const raw = Buffer.alloc(w * h * 3)
    let s = 0x1234_5678 // fixed seed → deterministic noise
    for (let i = 0; i < raw.length; i += 1) {
      s = (s * 1_103_515_245 + 12_345) & 0x7fff_ffff // LCG
      raw[i] = (s >> 8) & 0xff
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer()
  }

  it('slims recognized files into <dir>.diet/, preserves structure, copies unknowns', async () => {
    const png = await gradientPng()
    const ports = fakePorts({
      'pics/photo.png': png,
      'pics/sub/logo.svg': messySvg,
      'pics/notes.txt': enc('just some notes, not a recognized type'),
    })
    const res = await run(['pics', '--plan', 'keto'], ports)
    expect(res.code).toBe(0)
    const written = [...ports.written.keys()]
    expect(written.length).toBeGreaterThan(0)
    // Default output is the resolved sibling `<dir>.diet/` (absolute, so `diet .` also works).
    expect(written.every((k) => k.includes('/pics.diet/'))).toBe(true) // all output under the new tree
    expect(written.some((k) => k.includes('/pics.diet/sub/'))).toBe(true) // subfolder structure kept
    expect(written.some((k) => k.endsWith('/pics.diet/notes.txt'))).toBe(true) // unknown copied through
    expect(written.every((k) => !k.includes('/pics/'))).toBe(true) // originals (under pics/) untouched
    expect(res.output).toMatch(/slimmed/)
  })

  it('honours --out and --exclude', async () => {
    const png = await gradientPng()
    const ports = fakePorts({
      'in/a.png': png,
      'in/vendor/b.png': png,
    })
    const res = await run(
      ['in', '--plan', 'keto', '--out', 'out', '--exclude', '**/vendor/**'],
      ports,
    )
    expect(res.code).toBe(0)
    expect([...ports.written.keys()].some((k) => k.startsWith('out/'))).toBe(true)
    expect([...ports.written.keys()].some((k) => k.includes('vendor'))).toBe(false) // excluded subtree
  })

  it('--no-copy-unknown leaves unknown files out of the output', async () => {
    const png = await gradientPng()
    const ports = fakePorts({ 'in/a.png': png, 'in/readme.txt': enc('x') })
    await run(['in', '--plan', 'keto', '--out', 'out', '--no-copy-unknown'], ports)
    expect(ports.written.get('out/readme.txt')).toBeUndefined() // not copied
    expect([...ports.written.keys()].some((k) => k.startsWith('out/'))).toBe(true) // png still slimmed
  })

  it('--max-input skips an oversized file in a folder (reason), slims the rest', async () => {
    const big = await gradientPng(400, 400) // larger raster → larger PNG
    const small = enc('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')
    const ports = fakePorts({ 'in/big.png': big, 'in/tiny.svg': small })
    const res = await run(
      ['in', '--out', 'out', '--max-input', String(small.length + 10), '--json'],
      ports,
    )
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)
    const bigEntry = m.files.find((f: { path: string }) => f.path === 'big.png')
    expect(bigEntry.action).toBe('skipped')
    expect(bigEntry.reason).toMatch(/too large/)
    expect(ports.written.has('out/big.png')).toBe(false) // the oversized file was never written
  })

  it('--max-input applies across the --to-total plan-sweep (oversized file excluded from the budget)', async () => {
    const big = await gradientPng(400, 400)
    const small = enc('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')
    const ports = fakePorts({ 'in/big.png': big, 'in/tiny.svg': small })
    const res = await run(
      [
        'in',
        '--out',
        'out',
        '--to-total',
        '10mb',
        '--max-input',
        String(small.length + 10),
        '--json',
      ],
      ports,
    )
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)
    expect(m.fit).toBe(true)
    // the oversized file is skipped in every sweep pass + the final apply, so it never enters the budget
    expect(m.files.find((f: { path: string }) => f.path === 'big.png')?.action).toBe('skipped')
    expect(ports.written.has('out/big.png')).toBe(false)
  })

  it('--timeout aborts a folder run: unprocessed files skipped, exit 2 (not a silent success)', async () => {
    // Each real PNG slim is multi-ms; a 1 ms deadline (sequential) aborts file 1 and short-circuits the rest.
    const ports = fakePorts({
      'in/a.png': await gradientPng(),
      'in/b.png': await gradientPng(),
      'in/c.png': await gradientPng(),
    })
    const res = await run(
      ['in', '--out', 'out', '--concurrency', '1', '--timeout', '1', '--json'],
      ports,
    )
    expect(res.code).toBe(2) // a truncated run is not exit 0
    const m = JSON.parse(res.output)
    expect(m.files.some((f: { action: string; reason?: string }) => f.reason === 'aborted')).toBe(
      true,
    )
  })

  it('--to-total + --timeout refuses honestly instead of fabricating a "fit"', async () => {
    // Aborted sweep files become skips → totals under-count → would spuriously "fit" any budget (exit 0).
    // A TIGHT budget forces the sweep past the fast lossless `cleanse` no-op into `balanced`, whose multi-ms
    // search is where the 1 ms deadline fires; the budget path must then detect the abort and refuse (exit 2).
    const ports = fakePorts({
      'in/a.png': await gradientPng(400, 400),
      'in/b.png': await gradientPng(400, 400),
    })
    const res = await run(
      ['in', '--out', 'out', '--to-total', '1kb', '--concurrency', '1', '--timeout', '1'],
      ports,
    )
    expect(res.code).toBe(2)
    expect(res.output).toMatch(/abort/i)
    expect(res.output).not.toMatch(/fit under/) // never the fit banner
    expect(ports.written.size).toBe(0)
  })

  it('plan on a folder is a dry-run — reports but writes nothing', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['plan', 'in', '--plan', 'keto'], ports)
    expect(res.code).toBe(0)
    expect(ports.written.size).toBe(0)
    expect(res.output).toMatch(/dry run/)
  })

  it('refuses --out inside the input folder (code 4, no writes)', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['in', '--out', 'in/slim'], ports)
    expect(res.code).toBe(4)
    expect(ports.written.size).toBe(0)
  })

  it('copies a signed PDF through untouched (refused, not rewritten)', async () => {
    const signed = await imagePdf(true)
    const ports = fakePorts({ 'in/contract.pdf': signed, 'in/photo.png': await gradientPng() })
    const res = await run(['in', '--plan', 'keto', '--out', 'out'], ports)
    expect(res.code).toBe(0)
    const copied = ports.written.get('out/contract.pdf')
    expect(copied).toBeDefined()
    expect(copied).toEqual(signed) // byte-for-byte original, signature intact
    expect(res.output).toMatch(/signed/)
  })

  it('folder --json emits the manifest schema', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng(), 'in/x.txt': enc('x') })
    const res = await run(['in', '--plan', 'keto', '--out', 'out', '--json'], ports)
    const parsed = JSON.parse(res.output)
    expect(parsed).toMatchObject({ ok: true, action: 'slim', input: 'in', output: 'out' })
    expect(Array.isArray(parsed.files)).toBe(true)
    expect(parsed.totals).toMatchObject({
      files: expect.any(Number),
      savedPercent: expect.any(Number),
    })
  })

  it('diet weigh <dir> — size overview by kind + total (read-only, exit 0)', async () => {
    const ports = fakePorts({
      'in/big.png': enc('x'.repeat(2000)),
      'in/small.jpg': enc('y'.repeat(300)),
      'in/doc.pdf': enc('z'.repeat(500)),
      'in/notes.txt': enc('t'.repeat(50)),
    })
    const res = await run(['weigh', 'in'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toMatch(/4 files/)
    expect(res.output).toMatch(/image/)
    expect(ports.written.size).toBe(0) // never writes
    const json = JSON.parse((await run(['weigh', 'in', '--json'], ports)).output)
    expect(json).toMatchObject({ ok: true, action: 'weigh', totalFiles: 4, totalBytes: 2850 })
    expect(json.byKind.image).toEqual({ files: 2, bytes: 2300 })
  })

  it('diet check <dir> --max — fails (exit 1) and names only the over-budget file', async () => {
    const ports = fakePorts({
      'in/big.png': enc('x'.repeat(2000)),
      'in/ok.png': enc('y'.repeat(100)),
    })
    const res = await run(['check', 'in', '--max', '1kb'], ports)
    expect(res.code).toBe(1)
    expect(res.output).toMatch(/FAIL/)
    expect(res.output).toMatch(/big\.png/)
    expect(res.output).not.toMatch(/ok\.png/)
    expect(ports.written.size).toBe(0)
  })

  it('diet check <dir> --max — passes (exit 0) when all files are within', async () => {
    const ports = fakePorts({ 'in/a.png': enc('x'.repeat(100)), 'in/b.png': enc('y'.repeat(200)) })
    const res = await run(['check', 'in', '--max', '1kb'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toMatch(/PASS/)
  })

  it('diet check <dir> --max-total — gates the whole tree (exit 1 over, 0 within)', async () => {
    const ports = fakePorts({
      'in/a.png': enc('x'.repeat(2000)),
      'in/b.png': enc('y'.repeat(2000)),
    })
    const fail = await run(['check', 'in', '--max-total', '3kb'], ports)
    expect(fail.code).toBe(1) // 4000 > 3000
    expect(fail.output).toMatch(/FAIL/)
    expect(fail.output).toMatch(/OVER budget/)
    expect((await run(['check', 'in', '--max-total', '5kb'], ports)).code).toBe(0)
  })

  it('folder check --json emits the gate schema (over[], overTotal, pass)', async () => {
    const ports = fakePorts({
      'in/big.png': enc('x'.repeat(2000)),
      'in/ok.png': enc('y'.repeat(100)),
    })
    const json = JSON.parse((await run(['check', 'in', '--max', '1kb', '--json'], ports)).output)
    expect(json).toMatchObject({
      ok: false,
      action: 'check',
      pass: false,
      overTotal: false,
      maxBytes: 1000,
      totalBytes: 2100,
    })
    expect(json.over.map((e: { path: string }) => e.path)).toEqual(['big.png'])
  })

  it('weigh and check honour --include/--exclude scoping', async () => {
    const ports = fakePorts({
      'in/keep.png': enc('x'.repeat(2000)),
      'in/skip.txt': enc('y'.repeat(9000)),
    })
    const w = JSON.parse((await run(['weigh', 'in', '--exclude', '*.txt', '--json'], ports)).output)
    expect(w.totalFiles).toBe(1) // excluded file not counted
    expect(w.totalBytes).toBe(2000)
    // the big excluded file would breach --max, but it's out of scope → PASS
    expect((await run(['check', 'in', '--exclude', '*.txt', '--max', '5kb'], ports)).code).toBe(0)
  })

  it('plan + --to-each is a dry-run — reports but writes nothing', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['plan', 'in', '--to-each', '20kb', '--plan', 'keto'], ports)
    expect(res.code).toBe(0)
    expect(ports.written.size).toBe(0)
    expect(res.output).toMatch(/dry run/)
  })

  it('--to-each applies only to included files', async () => {
    const png = await gradientPng()
    const ports = fakePorts({ 'in/a.png': png, 'in/vendor/b.png': png })
    await run(
      ['in', '--to-each', '20kb', '--plan', 'keto', '--out', 'out', '--exclude', 'vendor'],
      ports,
    )
    const keys = [...ports.written.keys()]
    expect(keys.some((k) => k.includes('/a.'))).toBe(true)
    expect(keys.some((k) => k.includes('vendor'))).toBe(false)
  })

  it('diet check <dir> with no budget is a usage error (exit 3)', async () => {
    const ports = fakePorts({ 'in/a.png': enc('x') })
    expect((await run(['check', 'in'], ports)).code).toBe(3)
  })

  it('--to-each caps each recognized file (feasible → slimmed under the target)', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['in', '--to-each', '20kb', '--plan', 'keto', '--out', 'out'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toMatch(/slimmed 1/)
    const written = [...ports.written.values()]
    expect(written).toHaveLength(1)
    expect(written[0]!.length).toBeLessThanOrEqual(20_000)
  })

  it('--to-each infeasible target → refused (target infeasible), original copied through', async () => {
    const png = await gradientPng()
    const ports = fakePorts({ 'in/a.png': png })
    const res = await run(['in', '--to-each', '100', '--plan', 'balanced', '--out', 'out'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toMatch(/target infeasible/)
    const written = [...ports.written.values()]
    expect(written).toHaveLength(1)
    expect(written[0]).toEqual(png) // original copied through untouched
  })

  it('--to-total: a generous budget fits at the gentlest plan (cleanse), output under budget', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng(), 'in/b.svg': messySvg })
    const res = await run(['in', '--to-total', '10mb', '--out', 'out', '--json'], ports)
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)
    expect(m).toMatchObject({ fit: true, plan: 'cleanse', budget: 10_000_000 }) // gentlest that fits wins
    expect(m.totals.outputBytes).toBeLessThanOrEqual(10_000_000)
    expect([...ports.written.keys()].length).toBeGreaterThan(0)
  })

  it('--to-total: a tight budget steps to a more aggressive plan but stays under budget', async () => {
    const png = await gradientPng()
    const ports = fakePorts({ 'in/a.png': png })
    const CAP = Math.floor(png.length / 4) // unreachable losslessly → needs a format-switch plan
    const res = await run(['in', '--to-total', String(CAP), '--out', 'out', '--json'], ports)
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)
    expect(m.fit).toBe(true)
    expect(m.plan).not.toBe('cleanse') // a gentle lossless plan can't reach it
    expect(m.totals.outputBytes).toBeLessThanOrEqual(CAP)
  })

  it('--to-total: an impossible budget refuses honestly (exit 1, no writes)', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['in', '--to-total', '1', '--out', 'out'], ports) // 1 byte — unreachable
    expect(res.code).toBe(1)
    expect(res.output).toMatch(/infeasible/)
    expect(ports.written.size).toBe(0) // nothing written on a refusal
  })

  it('--to-total: the infeasible JSON is honest (ok/fit false, no output, no plan claimed)', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['in', '--to-total', '1', '--out', 'out', '--json'], ports)
    const m = JSON.parse(res.output)
    expect(m).toMatchObject({ ok: false, fit: false, output: null, budget: 1 })
    expect(m.plan).toBeUndefined() // no plan fit, so none is claimed
    expect(m.totals.outputBytes).toBeGreaterThan(1) // the honest smallest achievable
  })

  it('--to-total: plan (dry-run) reports the winning plan but writes nothing', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['plan', 'in', '--to-total', '10mb', '--out', 'out'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toMatch(/fit under/)
    expect(ports.written.size).toBe(0)
  })

  it('--to-total is rejected on a single file (folder-only, code 3)', async () => {
    const ports = fakePorts({ 'a.png': await gradientPng() })
    expect((await run(['a.png', '--to-total', '1mb'], ports)).code).toBe(3)
  })

  it('--to-total: pins the exact gentlest plan that fits (an interior rung, not just "not cleanse")', async () => {
    // MEASURE each plan's whole-folder total (a per-plan dry-run == exactly what the sweep sees), then set
    // the budget to the 'balanced' total so the only gentler plan (cleanse) is excluded and 'balanced' is
    // the gentlest that fits. Proves the sweep selects an interior rung by an exact budget, not just steps
    // off cleanse.
    const jpeg = await noisyJpeg()
    const measure = fakePorts({ 'in/a.jpg': jpeg })
    const totalFor = async (plan: string): Promise<number> => {
      const r = await run(['plan', 'in', '--plan', plan, '--json'], measure)
      return JSON.parse(r.output).totals.outputBytes
    }
    const cleanseTotal = await totalFor('cleanse')
    const balancedTotal = await totalFor('balanced')
    // Premise: a lossy re-encode (balanced) beats lossless (cleanse). If this ever fails, the corpus — not
    // the sweep — needs adjusting; fail loudly here rather than pass on a degenerate gradient.
    expect(cleanseTotal).toBeGreaterThan(balancedTotal)
    const budget = balancedTotal // exactly balanced's footprint: cleanse won't fit, balanced will
    const ports = fakePorts({ 'in/a.jpg': jpeg })
    const res = await run(['in', '--to-total', String(budget), '--out', 'out', '--json'], ports)
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)
    expect(m.fit).toBe(true)
    expect(m.plan).toBe('balanced') // the exact interior rung — gentlest that fits
    expect(m.totals.outputBytes).toBeLessThanOrEqual(budget)
  })

  it('--to-total: a TOCTOU tree growth after the sweep is reported as overran (exit 1), not a false fit', async () => {
    // The sweep fits at cleanse on the base tree; a large file APPEARS on the write-pass walk (a file added
    // between planning and writing). The written total blows the budget — must report overran, not "fit".
    const ports = fakePorts(
      { 'in/a.png': await gradientPng() },
      { appearAfterWalks: { count: 1, files: { 'in/late.bin': Buffer.alloc(5_000_000) } } },
    )
    const res = await run(['in', '--to-total', '1mb', '--out', 'out', '--json'], ports)
    expect(res.code).toBe(1) // budget failed
    const m = JSON.parse(res.output)
    expect(m.fit).toBe(false)
    expect(m.overran).toBe(true)
    expect(m.plan).toBe('cleanse') // the plan that "fit" on the dry-run
    expect(m.totals.outputBytes).toBeGreaterThan(1_000_000) // what was actually written exceeds the budget
    expect(ports.written.size).toBeGreaterThan(0) // files WERE written (unlike an infeasible refusal)
  })

  it('reports an empty / all-filtered folder cleanly (code 0, 0 files, no crash)', async () => {
    // Regression: formatFolder used to call the throwing savedPercent on inputBytes=0 → exit 2.
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const res = await run(['in', '--plan', 'keto', '--out', 'out', '--include', '*.none'], ports)
    expect(res.code).toBe(0)
    expect(ports.written.size).toBe(0)
    expect(res.output).toMatch(/0 files/)
  })

  it('rejects a bare --to on a folder (ambiguous) but accepts --to-each', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    const bareTo = await run(['in', '--to', '500kb'], ports)
    expect(bareTo.code).toBe(3) // ambiguous on a folder → usage error pointing at --to-each
    expect(bareTo.output).toMatch(/--to-each/)
    expect(
      (await run(['in', '--to-each', '500kb', '--out', 'out', '--plan', 'keto'], ports)).code,
    ).toBe(0)
  })

  it('--include (comma list) slims only matching types', async () => {
    const ports = fakePorts({
      'in/a.png': await gradientPng(),
      'in/b.svg': messySvg,
      'in/c.txt': enc('x'),
    })
    // `balanced` preserves the input format, so the output names are predictable.
    await run(['in', '--plan', 'balanced', '--out', 'out', '--include', '*.png,*.svg'], ports)
    const keys = [...ports.written.keys()]
    expect(keys.some((k) => k.endsWith('/a.png'))).toBe(true)
    expect(keys.some((k) => k.endsWith('/b.svg'))).toBe(true)
    expect(keys.some((k) => k.includes('c.txt'))).toBe(false) // not included → not written
    expect(ports.written.size).toBe(2)
  })

  it('a bare directory-name exclude drops the whole subtree (gitignore-style)', async () => {
    const png = await gradientPng()
    const ports = fakePorts({ 'in/a.png': png, 'in/node_modules/dep/b.png': png })
    await run(['in', '--plan', 'balanced', '--out', 'out', '--exclude', 'node_modules'], ports)
    const keys = [...ports.written.keys()]
    expect(keys.some((k) => k.endsWith('/a.png'))).toBe(true)
    expect(keys.some((k) => k.includes('node_modules'))).toBe(false) // whole subtree excluded
  })

  it('renames on a real format switch in folder mode (png → webp)', async () => {
    const ports = fakePorts({ 'in/a.png': await gradientPng() })
    await run(['in', '--plan', 'keto', '--out', 'out', '--format', 'webp'], ports)
    const keys = [...ports.written.keys()]
    expect(keys.some((k) => k.endsWith('/a.webp'))).toBe(true) // honest extension
    expect(keys.some((k) => k.endsWith('/a.png'))).toBe(false)
  })

  it('refuses a symlinked output root (code 4, no writes)', async () => {
    // run.ts queries isSymlink with the RESOLVED output path, so the fake is keyed on resolve('out').
    const ports = fakePorts({ 'in/a.png': await gradientPng() }, { symlinks: [resolve('out')] })
    const res = await run(['in', '--plan', 'keto', '--out', 'out'], ports)
    expect(res.code).toBe(4)
    expect(res.output).toMatch(/symlink/)
    expect(ports.written.size).toBe(0)
  })

  it('refuses an output that aliases the input via sameFile (case-insensitive FS guard)', async () => {
    // `IN` resolves to the same dir as `in` on a case-insensitive filesystem — sameFile (dev+inode) catches
    // it where the lexical compare would miss it. The guard queries resolved paths.
    const ports = fakePorts(
      { 'in/a.png': await gradientPng() },
      { sameAs: [[resolve('in'), resolve('IN')]] },
    )
    const res = await run(['in', '--plan', 'keto', '--out', 'IN'], ports)
    expect(res.code).toBe(4)
    expect(ports.written.size).toBe(0)
  })
})

describe('diet CLI — JSON receipts', () => {
  it('slim --json emits the receipt schema', async () => {
    const input = await imagePdf()
    const ports = fakePorts({ 'a.pdf': input })
    const res = await run(
      ['a.pdf', '--plan', 'crash', '--to', String(Math.floor(input.length / 2)), '--json'],
      ports,
    )
    expect(res.code).toBe(0)
    expect(JSON.parse(res.output)).toMatchObject({
      ok: true,
      action: 'slim',
      savedPercent: expect.any(Number),
      output: 'a.diet.pdf',
    })
  })

  it('weigh / check / checkup emit JSON', async () => {
    const ports = fakePorts({ 'a.pdf': await imagePdf() })
    expect(JSON.parse((await run(['weigh', 'a.pdf', '--json'], ports)).output)).toMatchObject({
      ok: true,
      action: 'weigh',
    })
    expect(
      JSON.parse((await run(['check', 'a.pdf', '--max', '1kb', '--json'], ports)).output),
    ).toMatchObject({ ok: false, action: 'check' })
    expect(JSON.parse((await run(['checkup', '--json'], ports)).output)).toMatchObject({
      ok: true,
      action: 'checkup',
    })
  })
})

/** A compressible gradient PNG — image inputs route to @onadiet/image. */
async function gradientPng(w = 400, h = 400): Promise<Uint8Array> {
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3
      raw[i] = Math.round((x * 255) / (w - 1))
      raw[i + 1] = Math.round((y * 255) / (h - 1))
      raw[i + 2] = Math.round(((x + y) * 255) / (w + h - 2))
    }
  }
  const b = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer()
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

describe('diet CLI — image routing', () => {
  it('weighs an image (routes to the image adapter)', async () => {
    const ports = fakePorts({ 'a.png': await gradientPng() })
    const res = await run(['weigh', 'a.png'], ports)
    expect(res.code).toBe(0)
    expect(res.output).toContain('png')
    expect(ports.written.size).toBe(0)
  })

  it('slims an image keeping its format → a.diet.png, smaller, original untouched', async () => {
    const input = await gradientPng()
    const ports = fakePorts({ 'a.png': input })
    const res = await run(['a.png'], ports)
    expect(res.code).toBe(0)
    const out = ports.written.get('a.diet.png')
    expect(out).toBeDefined()
    expect((out as Uint8Array).length).toBeLessThan(input.length)
    expect(ports.written.has('a.png')).toBe(false) // original untouched
  })

  it('--format auto names the output by the produced format (png → webp/avif)', async () => {
    const ports = fakePorts({ 'a.png': await gradientPng() })
    const res = await run(['a.png', '--format', 'auto'], ports)
    expect(res.code).toBe(0)
    const written = [...ports.written.keys()]
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/^a\.diet\.(webp|avif)$/)
  })

  it('--format webp writes a.diet.webp', async () => {
    const ports = fakePorts({ 'a.png': await gradientPng() })
    const res = await run(['a.png', '--format', 'webp'], ports)
    expect(res.code).toBe(0)
    expect(ports.written.has('a.diet.webp')).toBe(true)
  })

  it('rejects a non-PDF, non-image file (code 2)', async () => {
    const ports = fakePorts({ 'x.bin': new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]) })
    const res = await run(['x.bin'], ports)
    expect(res.code).toBe(2)
    expect(res.output).toContain('supported')
  })
})
