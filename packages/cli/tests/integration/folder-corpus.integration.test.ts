/**
 * FOLDER GOLDEN CORPUS (v0.3 sub-phase 3) — the fan-out proven end-to-end on a real filesystem.
 *
 * The unit suites drive `runFolder` with an in-memory fake; this one builds a mixed tree of REAL files
 * (jpeg / png / svg / pdf + a SIGNED pdf + unknown files + nested dirs + an empty dir) in a real temp dir,
 * then runs `diet ./dir` through the actual CLI (`run` + `nodePorts`) and the real adapters. It pins the
 * invariants the folder pitch rests on:
 *   1. structure preserved — every recognized file lands at its mirrored path, subfolders intact;
 *   2. recognized files slim smaller (measured), unknowns copy through BYTE-FOR-BYTE;
 *   3. a SIGNED pdf is refused, not rewritten — copied through byte-identical (signature intact);
 *   4. `--exclude` drops a whole subtree; originals are NEVER touched;
 *   5. the manifest totals are honest — savedBytes = in − out, real savings > 0;
 *   6. `weigh`/`check` are read-only budgets with honest exit codes on the real tree;
 *   7. parallel and sequential runs produce a BYTE-IDENTICAL output tree.
 *
 * The corpus is built once in `beforeAll` (real encodes); tests are assertions over real runs. Runs in the
 * dedicated `test:integration` task, out of the fast inner loop.
 */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, PDFName } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run, nodePorts } from '../../src/index'

/** A compressible gradient raster (real encoders slim it reliably). */
async function gradient(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3
      raw[i] = Math.round((x * 255) / (w - 1))
      raw[i + 1] = Math.round((y * 255) / (h - 1))
      raw[i + 2] = 128
    }
  }
  return raw
}

async function jpeg(w: number, h: number): Promise<Buffer> {
  return sharp(await gradient(w, h), { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer()
}
async function png(w: number, h: number): Promise<Buffer> {
  return sharp(await gradient(w, h), { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer()
}

/** A one-page PDF wrapping a compressible JPEG; `signed` adds a signature field (must be refused). */
async function imagePdf(signed = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(await jpeg(900, 900))
  doc.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 })
  if (signed) {
    doc.catalog.set(
      PDFName.of('AcroForm'),
      doc.context.register(doc.context.obj({ SigFlags: 3, Fields: [] })),
    )
  }
  return doc.save()
}

const MESSY_SVG =
  '<?xml version="1.0"?><!-- a comment --><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
  '   <metadata>x</metadata><rect x="0.0000" y="0.0000" width="64" height="64" fill="#3366ff"/>   </svg>'

/** Recursively snapshot a directory → { relPath: bytes } (POSIX-relative keys), for tree comparison. */
async function snapshot(root: string, rel = ''): Promise<Record<string, Buffer>> {
  const out: Record<string, Buffer> = {}
  const entries = await readdir(join(root, rel), { withFileTypes: true })
  for (const e of entries) {
    const childRel = rel === '' ? e.name : `${rel}/${e.name}`
    if (e.isDirectory()) Object.assign(out, await snapshot(root, childRel))
    else out[childRel] = await readFile(join(root, childRel))
  }
  return out
}

const bytesOf = (s: string): Buffer => Buffer.from(s, 'utf8')

interface Corpus {
  readonly dir: string
  readonly files: Readonly<Record<string, Buffer>> // relPath → original bytes
}

describe('folder golden corpus — end-to-end on a real filesystem', () => {
  let tmp: string
  let corpus: Corpus

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'onadiet-folder-'))
    const dir = join(tmp, 'assets')
    const files: Record<string, Buffer> = {
      'photos/hero.jpg': await jpeg(1000, 800),
      'photos/2024/banner.png': await png(500, 500),
      'icons/logo.svg': bytesOf(MESSY_SVG),
      'docs/report.pdf': Buffer.from(await imagePdf()),
      'docs/contract.pdf': Buffer.from(await imagePdf(true)), // signed → refuse + copy through
      'README.md': bytesOf('# Assets\n\nnot an image.\n'),
      'data/notes.txt': bytesOf('just some notes'.repeat(50)),
      'node_modules/pkg/index.js': bytesOf('module.exports = 1\n'),
    }
    for (const [rel, bytes] of Object.entries(files)) {
      await mkdir(join(dir, rel, '..'), { recursive: true })
      await writeFile(join(dir, rel), bytes)
    }
    await mkdir(join(dir, 'empty'), { recursive: true }) // an empty dir contributes nothing
    corpus = { dir, files }
  })

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('slims a mixed tree: structure preserved, unknowns copied, signed pdf refused, real savings', async () => {
    const out = join(tmp, 'out-main')
    const res = await run(
      [corpus.dir, '--out', out, '--exclude', 'node_modules', '--json'],
      nodePorts,
    )
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)

    // structure preserved — every recognized file lands at its mirrored path (nested included)
    const outTree = await snapshot(out)
    const outPaths = Object.keys(outTree)
    for (const rel of [
      'photos/hero.jpg',
      'photos/2024/banner.png',
      'icons/logo.svg',
      'docs/report.pdf',
    ]) {
      expect(outPaths, rel).toContain(rel)
    }
    // an empty input dir isn't mirrored (only parents of written files are created)
    expect(outPaths.some((p) => p.startsWith('empty/'))).toBe(false)

    // recognized files are handled by their adapter (never copied/refused) and never grow; a smooth PNG can
    // honestly come back "kept" (lossless can't beat it), so accept slimmed-or-kept, output ≤ input.
    for (const rel of [
      'photos/hero.jpg',
      'photos/2024/banner.png',
      'icons/logo.svg',
      'docs/report.pdf',
    ]) {
      const entry = m.files.find((f: { path: string }) => f.path === rel)
      expect(['slimmed', 'kept'], rel).toContain(entry.action)
      expect(entry.outputBytes, rel).toBeLessThanOrEqual(entry.inputBytes)
    }

    // unknowns copied through byte-for-byte
    expect(outTree['README.md']).toEqual(corpus.files['README.md'])
    expect(outTree['data/notes.txt']).toEqual(corpus.files['data/notes.txt'])

    // signed pdf refused (not rewritten) and copied through with its signature intact
    const contract = m.files.find((f: { path: string }) => f.path === 'docs/contract.pdf')
    expect(contract.action).toBe('refused')
    expect(contract.reason).toMatch(/signed/)
    expect(outTree['docs/contract.pdf']).toEqual(corpus.files['docs/contract.pdf'])

    // --exclude dropped the whole node_modules subtree
    expect(outPaths.some((p) => p.includes('node_modules'))).toBe(false)

    // honest totals: savings are real and self-consistent
    expect(m.totals.savedBytes).toBe(m.totals.inputBytes - m.totals.outputBytes)
    expect(m.totals.savedBytes).toBeGreaterThan(0)
    expect(m.totals.slimmed).toBeGreaterThanOrEqual(3) // jpeg + svg + pdf reliably slim; png may be "kept"
    expect(m.totals.slimmed + m.totals.kept).toBe(4) // all four recognized files handled, none copied
    expect(m.totals.refused).toBe(1) // the signed pdf

    // originals never touched
    expect(await snapshot(corpus.dir)).toEqual({
      ...corpus.files,
      // (empty/ has no files, so it's absent from the snapshot — nothing to assert)
    })
  })

  it('weigh is a read-only size overview; check gates the real tree with honest exit codes', async () => {
    const before = await snapshot(corpus.dir)

    const weigh = JSON.parse((await run(['weigh', corpus.dir, '--json'], nodePorts)).output)
    expect(weigh.action).toBe('weigh')
    expect(weigh.totalBytes).toBeGreaterThan(0)
    expect(weigh.byKind.image.files).toBeGreaterThanOrEqual(2) // hero.jpg + banner.png

    // a 1 KB per-file budget fails (the pdfs/images are bigger); a 100 MB budget passes
    expect((await run(['check', corpus.dir, '--max', '1kb'], nodePorts)).code).toBe(1)
    expect(
      (await run(['check', corpus.dir, '--max', '100mb', '--max-total', '500mb'], nodePorts)).code,
    ).toBe(0)

    // neither weigh nor check wrote anything into the input tree
    expect(await snapshot(corpus.dir)).toEqual(before)
  })

  it('caps every recognized file with --to-each; infeasible files copy through, honestly flagged', async () => {
    const out = join(tmp, 'out-each')
    const CAP = 4_000 // deliberately tiny: the big jpeg/pdf can't reach it within their floors
    const res = await run(
      [corpus.dir, '--out', out, '--exclude', 'node_modules', '--to-each', String(CAP), '--json'],
      nodePorts,
    )
    expect(res.code).toBe(0) // slim is best-effort — an infeasible file doesn't fail the run
    const m = JSON.parse(res.output)
    // every file that DID slim is under the cap; nothing over it was written as "slimmed"
    for (const f of m.files.filter((e: { action: string }) => e.action === 'slimmed')) {
      expect(f.outputBytes, f.path).toBeLessThanOrEqual(CAP)
    }
    // at least one recognized file couldn't hit the cap → refused "target infeasible", original copied through
    const infeasible = m.files.filter((f: { reason?: string }) => f.reason === 'target infeasible')
    expect(infeasible.length).toBeGreaterThan(0)
    const outTree = await snapshot(out)
    for (const f of infeasible) expect(outTree[f.path]).toEqual(corpus.files[f.path]) // original, untouched
  })

  it('produces a byte-identical output tree at --concurrency 1 and 4', async () => {
    const seq = join(tmp, 'out-seq')
    const par = join(tmp, 'out-par')
    const c1 = await run(
      [corpus.dir, '--out', seq, '--exclude', 'node_modules', '--concurrency', '1'],
      nodePorts,
    )
    const c4 = await run(
      [corpus.dir, '--out', par, '--exclude', 'node_modules', '--concurrency', '4'],
      nodePorts,
    )
    expect(c1.code).toBe(0)
    expect(c4.code).toBe(0)
    const seqTree = await snapshot(seq)
    expect(Object.keys(seqTree).length).toBeGreaterThan(0) // guard against a trivial empty-vs-empty pass
    expect(Object.keys(seqTree)).toContain('photos/hero.jpg')
    expect(await snapshot(par)).toEqual(seqTree) // identical regardless of concurrency
  })

  it('resolves a format-switch collision to the sorted-first input, identically at any concurrency', async () => {
    // a.jpeg + a.png both forced to a.webp → a real collision; the sorted-first (a.jpeg) must always win.
    const src = join(tmp, 'collide')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'a.jpeg'), await jpeg(300, 300))
    await writeFile(join(src, 'a.png'), await png(300, 300))
    const trees: Record<string, Buffer>[] = []
    for (const c of ['1', '4']) {
      const out = join(tmp, `collide-out-${c}`)
      const res = await run(
        [src, '--out', out, '--format', 'webp', '--concurrency', c, '--json'],
        nodePorts,
      )
      expect(res.code).toBe(0)
      const m = JSON.parse(res.output)
      expect(m.files.find((f: { action: string }) => f.action === 'slimmed').path).toBe('a.jpeg')
      expect(m.files.find((f: { action: string }) => f.action === 'skipped').reason).toMatch(
        /collision/,
      )
      trees.push(await snapshot(out))
    }
    expect(Object.keys(trees[0]!)).toEqual(['a.webp']) // exactly one output written
    expect(trees[1]).toEqual(trees[0]) // and it's byte-identical whether sequential or parallel
  })

  it('plan is a dry-run over the real tree — reports savings but writes nothing', async () => {
    const out = join(tmp, 'out-plan')
    const res = await run(
      ['plan', corpus.dir, '--out', out, '--exclude', 'node_modules', '--json'],
      nodePorts,
    )
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)
    expect(m.action).toBe('plan')
    expect(m.totals.slimmed + m.totals.kept).toBe(4) // same computation as a real slim
    await expect(stat(out)).rejects.toThrow() // no output dir created
  })

  it('--to-total fits the whole tree under a budget (plan-sweep), and refuses honestly when impossible', async () => {
    // Generous budget: the whole real mixed tree fits (winner found in the sweep + one real apply pass);
    // the reported total matches the bytes actually written to disk.
    const out = join(tmp, 'out-total')
    const res = await run(
      [corpus.dir, '--out', out, '--exclude', 'node_modules', '--to-total', '20mb', '--json'],
      nodePorts,
    )
    expect(res.code).toBe(0)
    const m = JSON.parse(res.output)
    expect(m.fit).toBe(true)
    expect(m.totals.outputBytes).toBeLessThanOrEqual(20_000_000)
    const written = await snapshot(out)
    const onDisk = Object.values(written).reduce((sum, b) => sum + b.length, 0)
    expect(onDisk).toBe(m.totals.outputBytes)

    // Impossible budget: refuse honestly (exit 1), write nothing. Scoped to the SVG (svgo, no SSIM search)
    // so the intrinsic all-5-plans infeasibility sweep stays cheap — the full-tree fit path above already
    // exercises the expensive raster/PDF adapters, and the unit suite covers infeasibility exhaustively.
    const bad = join(tmp, 'out-total-bad')
    const refuse = await run(
      [corpus.dir, '--out', bad, '--include', '*.svg', '--to-total', '1'], // 1 byte — unreachable
      nodePorts,
    )
    expect(refuse.code).toBe(1)
    expect(refuse.output).toMatch(/infeasible/)
    await expect(stat(bad)).rejects.toThrow() // nothing written on a refusal
  }, 240_000) // multi-pass over a real corpus + a cold CI runner; well above the ~15s local run
})
