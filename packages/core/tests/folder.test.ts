import { describe, expect, it } from 'vitest'
import {
  aggregateFolder,
  checkFolder,
  classifyByExtension,
  includeExclude,
  isSafeRelativePath,
  matchGlob,
  outputRelPath,
  weighFolder,
} from '../src/index'
import type { FolderFileEntry } from '../src/index'
// Internal (not part of the package's public index) — the glob memo's bound, for the boundedness test.
import { GLOB_CACHE_MAX, globCacheSize } from '../src/folder'

describe('matchGlob', () => {
  it('matches a slash-free glob against any path segment (basename included)', () => {
    expect(matchGlob('photo.jpg', '*.jpg')).toBe(true)
    expect(matchGlob('a/b/photo.jpg', '*.jpg')).toBe(true) // basename match, any depth
    expect(matchGlob('a/b/photo.png', '*.jpg')).toBe(false)
    expect(matchGlob('a/b/anything', '*')).toBe(true)
    expect(matchGlob('report.pdf', 'report.???')).toBe(true) // ? = one non-slash
    expect(matchGlob('report.pdfx', 'report.???')).toBe(false)
  })

  it('bounds the compiled-glob memo and stays correct past the cap (eviction, not corruption)', () => {
    // Compile far more distinct patterns than the cache holds so eviction kicks in.
    for (let i = 0; i < GLOB_CACHE_MAX * 2; i += 1) matchGlob(`f${i}.jpg`, `p${i}-*.dat`)
    // The bound actually holds — this is the whole point (would fail if GLOB_CACHE_MAX were Infinity).
    expect(globCacheSize()).toBeLessThanOrEqual(GLOB_CACHE_MAX)
    // And the memo is a pure speed cache, so evicting + recompiling never changes a match result.
    expect(matchGlob('photo.jpg', '*.jpg')).toBe(true) // recompiled after eviction — still correct
    expect(matchGlob('a/b/photo.png', '*.jpg')).toBe(false)
    expect(matchGlob('p0-x.dat', 'p0-*.dat')).toBe(true) // an evicted early pattern still matches
  })

  it('a bare directory name matches its whole subtree (gitignore-style)', () => {
    expect(matchGlob('node_modules/dep/x.js', 'node_modules')).toBe(true) // dir segment matches
    expect(matchGlob('src/.git/HEAD', '.git')).toBe(true)
    expect(matchGlob('src/app/x.js', 'node_modules')).toBe(false) // no matching segment
    expect(matchGlob('node_modules', 'node_modules')).toBe(true) // the dir/file itself
  })

  it('matches a glob with a slash against the whole relative path', () => {
    expect(matchGlob('a/vendor/x.js', '**/vendor/**')).toBe(true)
    expect(matchGlob('vendor/x.js', '**/vendor/**')).toBe(true) // **/ = zero-or-more segments
    expect(matchGlob('src/vendor/deep/x.js', '**/vendor/**')).toBe(true)
    expect(matchGlob('src/app/x.js', '**/vendor/**')).toBe(false)
    expect(matchGlob('a/b/photo.jpg', '**/*.jpg')).toBe(true)
    expect(matchGlob('photo.jpg', '**/*.jpg')).toBe(true) // **/ collapses to nothing
    expect(matchGlob('images/logo.svg', 'images/*.svg')).toBe(true)
    expect(matchGlob('images/deep/logo.svg', 'images/*.svg')).toBe(false) // * doesn't cross /
  })

  it('treats glob metacharacters in literals safely (no regex injection)', () => {
    expect(matchGlob('a.b.c', 'a.b.c')).toBe(true)
    expect(matchGlob('axbxc', 'a.b.c')).toBe(false) // '.' is literal, not regex any-char
    expect(matchGlob('', 'anything')).toBe(false)
    expect(matchGlob('x', '')).toBe(false) // empty glob matches nothing
  })
})

describe('includeExclude', () => {
  it('defaults to including everything when no lists are given', () => {
    expect(includeExclude('a/b.png')).toBe(true)
  })

  it('includes only matches when an include list is present', () => {
    expect(includeExclude('a/b.jpg', ['*.jpg', '*.png'])).toBe(true)
    expect(includeExclude('a/b.gif', ['*.jpg', '*.png'])).toBe(false)
  })

  it('excludes win over includes', () => {
    expect(includeExclude('vendor/lib.jpg', ['*.jpg'], ['**/vendor/**'])).toBe(false)
    expect(includeExclude('src/lib.jpg', ['*.jpg'], ['**/vendor/**'])).toBe(true)
  })

  it('an empty include list means "everything" (not "nothing")', () => {
    expect(includeExclude('a/b.png', [])).toBe(true)
  })
})

describe('isSafeRelativePath', () => {
  it('accepts ordinary relative paths', () => {
    expect(isSafeRelativePath('a/b/c.png')).toBe(true)
    expect(isSafeRelativePath('file.pdf')).toBe(true)
    expect(isSafeRelativePath('a/./b.png')).toBe(true) // '.' is harmless
  })

  it('rejects escapes: absolute, drive-letter, climbing above the root, NUL', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativePath('C:/Windows')).toBe(false)
    expect(isSafeRelativePath('../secret')).toBe(false)
    expect(isSafeRelativePath('a/../../secret')).toBe(false) // climbs above root
    expect(isSafeRelativePath('a/b/\0evil')).toBe(false)
    expect(isSafeRelativePath('')).toBe(false)
  })

  it('rejects Windows-separator escapes too (defense in depth)', () => {
    expect(isSafeRelativePath('..\\..\\secret')).toBe(false) // backslash climb
    expect(isSafeRelativePath('\\\\host\\share')).toBe(false) // UNC
    expect(isSafeRelativePath('\\evil')).toBe(false) // leading backslash (absolute)
  })

  it('allows a `..` that stays within the tree', () => {
    expect(isSafeRelativePath('a/b/../c.png')).toBe(true) // net depth stays >= 0
  })
})

describe('outputRelPath', () => {
  it('preserves the path when the format did not change', () => {
    expect(outputRelPath('a/b/photo.png')).toBe('a/b/photo.png')
  })

  it('swaps the extension on a format switch (honest naming)', () => {
    expect(outputRelPath('a/b/photo.png', 'webp')).toBe('a/b/photo.webp')
    expect(outputRelPath('a/b/photo.png', '.webp')).toBe('a/b/photo.webp') // leading dot tolerated
    expect(outputRelPath('photo.png', 'avif')).toBe('photo.avif')
  })

  it('keeps a leading-dot dotfile intact when swapping', () => {
    expect(outputRelPath('.hidden', 'webp')).toBe('.hidden.webp') // no real extension to replace
  })

  it('swaps only the last extension, and appends when there is none', () => {
    expect(outputRelPath('archive.tar.gz', 'webp')).toBe('archive.tar.webp') // last ext only
    expect(outputRelPath('a/b/README', 'webp')).toBe('a/b/README.webp') // no extension → append
  })
})

describe('aggregateFolder', () => {
  const entry = (over: Partial<FolderFileEntry>): FolderFileEntry => ({
    path: 'x',
    action: 'copied',
    inputBytes: 0,
    outputBytes: 0,
    ...over,
  })

  it('sums bytes over output files and computes honest savings', () => {
    const m = aggregateFolder([
      entry({ path: 'a.pdf', action: 'slimmed', inputBytes: 1000, outputBytes: 400 }),
      entry({ path: 'b.png', action: 'slimmed', inputBytes: 500, outputBytes: 100 }),
      entry({ path: 'c.txt', action: 'copied', inputBytes: 200, outputBytes: 200 }),
      entry({ path: 'd.jpg', action: 'kept', inputBytes: 300, outputBytes: 300 }),
      entry({ path: 'e.pdf', action: 'refused', inputBytes: 700, outputBytes: 700 }),
    ])
    expect(m.totals.files).toBe(5)
    expect(m.totals.slimmed).toBe(2)
    expect(m.totals.copied).toBe(1)
    expect(m.totals.kept).toBe(1)
    expect(m.totals.refused).toBe(1)
    expect(m.totals.inputBytes).toBe(2700)
    expect(m.totals.outputBytes).toBe(1700)
    expect(m.totals.savedBytes).toBe(1000)
    expect(m.totals.savedPercent).toBe(37) // (1000/2700)*100 = 37.037…, rounded to one decimal
    expect(m.files).toHaveLength(5)
  })

  it('excludes skipped files from byte totals and the file count', () => {
    const m = aggregateFolder([
      entry({ path: 'a.png', action: 'slimmed', inputBytes: 100, outputBytes: 40 }),
      entry({ path: 'b.tmp', action: 'skipped', inputBytes: 999, outputBytes: 0 }),
    ])
    expect(m.totals.files).toBe(1) // skipped not counted
    expect(m.totals.skipped).toBe(1)
    expect(m.totals.inputBytes).toBe(100) // skipped bytes excluded
    expect(m.totals.outputBytes).toBe(40)
  })

  it('is safe on an empty folder (no divide-by-zero)', () => {
    const m = aggregateFolder([])
    expect(m.totals.files).toBe(0)
    expect(m.totals.savedPercent).toBe(0)
    expect(m.totals.savedBytes).toBe(0)
  })

  it('is safe when every file is skipped (files=0, no divide-by-zero)', () => {
    const m = aggregateFolder([
      entry({ path: 'a.tmp', action: 'skipped', inputBytes: 10, outputBytes: 0 }),
      entry({ path: 'b.tmp', action: 'skipped', inputBytes: 20, outputBytes: 0 }),
    ])
    expect(m.totals.files).toBe(0)
    expect(m.totals.skipped).toBe(2)
    expect(m.totals.savedPercent).toBe(0)
  })

  it('reports a negative saving when the output grew (honest, not clamped)', () => {
    const m = aggregateFolder([
      entry({ path: 'a.png', action: 'slimmed', inputBytes: 100, outputBytes: 150 }),
    ])
    expect(m.totals.savedBytes).toBe(-50)
    expect(m.totals.savedPercent).toBeCloseTo(-50, 6)
  })
})

describe('classifyByExtension', () => {
  it('labels by the final extension, case-insensitively', () => {
    expect(classifyByExtension('a/b/report.pdf')).toBe('pdf')
    expect(classifyByExtension('icons/logo.SVG')).toBe('svg')
    expect(classifyByExtension('p/hero.JPG')).toBe('image')
    expect(classifyByExtension('p/x.jpeg')).toBe('image')
    expect(classifyByExtension('p/x.png')).toBe('image')
    expect(classifyByExtension('p/x.webp')).toBe('image')
    expect(classifyByExtension('p/x.avif')).toBe('image')
    expect(classifyByExtension('notes.txt')).toBe('other')
    expect(classifyByExtension('archive.tar.gz')).toBe('other') // last ext only
    expect(classifyByExtension('README')).toBe('other') // no extension
    expect(classifyByExtension('.gitignore')).toBe('other') // leading-dot dotfile, not an extension
    expect(classifyByExtension('.hero.png')).toBe('image') // leading dot but a real extension
  })
})

describe('weighFolder', () => {
  it('sums by kind, totals, and orders heaviest-first', () => {
    const r = weighFolder([
      { path: 'a.pdf', bytes: 300 },
      { path: 'photos/b.png', bytes: 1000 },
      { path: 'photos/c.jpg', bytes: 500 },
      { path: 'notes.txt', bytes: 50 },
    ])
    expect(r.totalFiles).toBe(4)
    expect(r.totalBytes).toBe(1850)
    expect(r.byKind.image).toEqual({ files: 2, bytes: 1500 })
    expect(r.byKind.pdf).toEqual({ files: 1, bytes: 300 })
    expect(r.byKind.other).toEqual({ files: 1, bytes: 50 })
    expect(r.files.map((f) => f.path)).toEqual([
      'photos/b.png',
      'photos/c.jpg',
      'a.pdf',
      'notes.txt',
    ])
  })

  it('is safe on an empty folder', () => {
    const r = weighFolder([])
    expect(r.totalFiles).toBe(0)
    expect(r.totalBytes).toBe(0)
    expect(r.byKind.image).toEqual({ files: 0, bytes: 0 })
  })

  it('rolls up the svg kind and breaks size ties by path (deterministic)', () => {
    const r = weighFolder([
      { path: 'b.png', bytes: 100 },
      { path: 'a.png', bytes: 100 },
      { path: 'logo.svg', bytes: 120 },
    ])
    expect(r.byKind.svg).toEqual({ files: 1, bytes: 120 })
    expect(r.files.map((f) => f.path)).toEqual(['logo.svg', 'a.png', 'b.png']) // 120 first, then a<b on tie
  })
})

describe('checkFolder', () => {
  const files = [
    { path: 'a.png', bytes: 100 },
    { path: 'big.png', bytes: 900 },
    { path: 'c.png', bytes: 200 },
  ]

  it('flags files over --max (heaviest first) and passes/fails accordingly', () => {
    const r = checkFolder(files, 300)
    expect(r.pass).toBe(false)
    expect(r.over.map((e) => e.path)).toEqual(['big.png'])
    expect(r.totalBytes).toBe(1200)
    expect(r.maxBytes).toBe(300)
  })

  it('passes when every file is within --max', () => {
    expect(checkFolder(files, 1000).pass).toBe(true)
  })

  it('gates the whole tree with --max-total independently of --max', () => {
    expect(checkFolder(files, undefined, 1000).pass).toBe(false) // 1200 > 1000
    expect(checkFolder(files, undefined, 2000).pass).toBe(true)
    const both = checkFolder(files, 1000, 1000) // per-file all ok, total over
    expect(both.over).toHaveLength(0)
    expect(both.overTotal).toBe(true)
    expect(both.pass).toBe(false)
  })

  it('passes vacuously with no budget, and is safe when empty', () => {
    expect(checkFolder(files).pass).toBe(true)
    const e = checkFolder([], 10)
    expect(e.pass).toBe(true)
    expect(e.totalBytes).toBe(0)
  })

  it('treats a size exactly equal to the budget as within (strict >, not >=)', () => {
    expect(checkFolder([{ path: 'a', bytes: 300 }], 300).pass).toBe(true) // == per-file → within
    expect(checkFolder([{ path: 'a', bytes: 300 }], undefined, 300).pass).toBe(true) // == total → within
    expect(checkFolder([{ path: 'a', bytes: 301 }], 300).pass).toBe(false) // one over → fail
  })

  it('lists every over-budget file heaviest-first and echoes both budgets', () => {
    const r = checkFolder(files, 50, 5000) // all three over 50, total 1200 within 5000
    expect(r.over.map((e) => e.path)).toEqual(['big.png', 'c.png', 'a.png'])
    expect(r.maxBytes).toBe(50)
    expect(r.maxTotal).toBe(5000)
    expect(checkFolder([{ path: 'x', bytes: 1 }], 0).pass).toBe(false) // --max 0 flags a non-empty file
  })
})
