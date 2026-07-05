import { describe, expect, it } from 'vitest'
import { runFormatAdapterConformance } from '@onadiet/testkit'
import { looksLikeSvg, svgAdapter } from '../src/adapter'
import { messySvg, minimalSvg, pathHeavySvg, svgWithBom, text } from './helpers'

// The shared FormatAdapter contract, same spec every adapter passes.
runFormatAdapterConformance(
  'svg',
  svgAdapter,
  () => Promise.resolve(messySvg()),
  new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
)

describe('detect / looksLikeSvg', () => {
  it('recognizes SVG markup (with or without an xml decl / BOM)', () => {
    expect(looksLikeSvg(messySvg())).toBe(true) // has <?xml … ?>
    expect(looksLikeSvg(minimalSvg())).toBe(true) // bare <svg …/>
    expect(looksLikeSvg(svgWithBom())).toBe(true) // leading UTF-8 BOM
    expect(svgAdapter.detect(messySvg())).toBe(true)
  })

  it('rejects non-SVG (garbage, HTML embedding svg, a PDF, plain text)', () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
    expect(looksLikeSvg(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(false)
    expect(looksLikeSvg(enc('<!doctype html><html><body><svg></svg></body></html>'))).toBe(false)
    expect(looksLikeSvg(enc('%PDF-1.7\n...'))).toBe(false)
    expect(looksLikeSvg(enc('just some text, no markup'))).toBe(false)
    expect(looksLikeSvg(new Uint8Array())).toBe(false)
  })

  it('requires <svg> as the FIRST element — behind a prolog, not merely embedded somewhere', () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
    // Behind a large leading comment / DOCTYPE — still detected (skips the prolog, not just a 4 KB window).
    expect(looksLikeSvg(enc(`<!--${'x'.repeat(5000)}--><svg viewBox="0 0 1 1"/>`))).toBe(true)
    expect(
      looksLikeSvg(
        enc('<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg/>'),
      ),
    ).toBe(true)
    // XHTML with an <?xml prolog that merely EMBEDS an <svg> — the first element is <html>, so rejected.
    expect(looksLikeSvg(enc('<?xml version="1.0"?><html><body><svg/></body></html>'))).toBe(false)
    // A DOCTYPE with an internal subset before the <svg> root — end is ']>' not the first '>'.
    expect(looksLikeSvg(enc('<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>'))).toBe(true)
  })
})

describe('weigh', () => {
  it('reports bytes + a descriptive cause (dimensions, element count)', async () => {
    const svg = messySvg()
    const w = await svgAdapter.weigh(svg)
    expect(w.bytes).toBe(svg.length)
    expect(w.causes).toHaveLength(1)
    expect(w.causes[0]!.bytes).toBe(svg.length)
    expect(w.causes[0]!.label).toMatch(/120×120 svg/)
    expect(w.causes[0]!.label).toMatch(/element/)
  })
})

describe('slim — cancellation', () => {
  it('returns an honest ABORTED (not a throw) when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const result = await svgAdapter.slim(messySvg(), { plan: 'balanced', signal: ac.signal })
    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('ABORTED')
    expect(result.output).toBeNull()
  })
})

describe('slim — happy path & plans', () => {
  it('slims an editor-export SVG under balanced to smaller, valid SVG', async () => {
    const svg = messySvg()
    const result = await svgAdapter.slim(svg, { plan: 'balanced' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).not.toBeNull()
    const out = result.output as Uint8Array
    expect(out.length).toBeLessThan(svg.length)
    expect(looksLikeSvg(out)).toBe(true)
    if (result.outcome.ok) {
      expect(result.outcome.keptOriginal).toBe(false)
      expect(result.outcome.outputBytes).toBe(out.length)
      expect(result.outcome.method).toMatch(/svgo balanced/)
    }
  })

  it('cleanse makes real lossless savings on cruft (unlike the raster no-op)', async () => {
    const result = await svgAdapter.slim(messySvg(), { plan: 'cleanse' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).not.toBeNull()
    if (result.outcome.ok) {
      expect(result.outcome.keptOriginal).toBe(false)
      expect(result.outcome.method).toMatch(/rendering-identical/)
    }
  })

  it('cleanse keeps the original on a no-cruft, path-only SVG (it never touches geometry)', async () => {
    // pathHeavy has no comments/metadata/editor cruft — only geometry, which cleanse won't round. So there
    // is nothing lossless to remove ⇒ keep the original (never a bigger or needlessly-rewritten file).
    const result = await svgAdapter.slim(pathHeavySvg(), { plan: 'cleanse' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })

  it('crash beats lowcarb on a path-heavy SVG (lower precision wins)', async () => {
    const svg = pathHeavySvg()
    const lowcarb = await svgAdapter.slim(svg, { plan: 'lowcarb' })
    const crash = await svgAdapter.slim(svg, { plan: 'crash' })
    const len = (r: typeof lowcarb): number => r.output?.length ?? svg.length
    expect(len(crash)).toBeLessThan(len(lowcarb))
  })
})

describe('slim — honest outcomes & safety', () => {
  it('keeps the original for an already-minified SVG (never a bigger file)', async () => {
    const result = await svgAdapter.slim(minimalSvg(), { plan: 'balanced' })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })

  it('hits a feasible byte target and stays under it', async () => {
    const svg = messySvg()
    const floorless = await svgAdapter.slim(svg, { plan: 'balanced' })
    const target = (floorless.output as Uint8Array).length + 40 // just above what balanced reaches
    const result = await svgAdapter.slim(svg, { plan: 'balanced', targetBytes: target })
    expect(result.outcome.ok).toBe(true)
    expect((result.output as Uint8Array).length).toBeLessThanOrEqual(target)
  })

  it('refuses honestly when a plan cannot reach the target — points at a more aggressive plan', async () => {
    const result = await svgAdapter.slim(messySvg(), { plan: 'balanced', targetBytes: 50 })
    expect(result.outcome.ok).toBe(false)
    expect(result.output).toBeNull()
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('TARGET_INFEASIBLE')
      expect(result.outcome.detail).toMatch(/more aggressive plan/)
      expect(result.outcome.detail).toMatch(/keto/)
    }
  })

  it('keeps the original when it is already under the target', async () => {
    const svg = messySvg()
    const result = await svgAdapter.slim(svg, { plan: 'balanced', targetBytes: svg.length + 100 })
    expect(result.outcome.ok).toBe(true)
    expect(result.output).toBeNull()
    if (result.outcome.ok) expect(result.outcome.keptOriginal).toBe(true)
  })

  it('rejects unsupported input with an honest failure (no throw)', async () => {
    const result = await svgAdapter.slim(new Uint8Array([1, 2, 3, 4]), { plan: 'balanced' })
    expect(result.outcome.ok).toBe(false)
    expect(result.output).toBeNull()
    if (!result.outcome.ok) expect(result.outcome.reason).toBe('UNSUPPORTED_INPUT')
  })

  it('refuses a non-UTF-8 SVG honestly instead of silently corrupting it', async () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
    // A valid-looking SVG whose body carries a lone 0xE9 ('é' in ISO-8859-1) — invalid as UTF-8. A lenient
    // decode would replace it with U+FFFD and ship a smaller-but-mangled file as a "win"; we must refuse.
    const input = new Uint8Array([
      ...enc('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>caf'),
      0xe9,
      ...enc('</text></svg>'),
    ])
    expect(svgAdapter.detect(input)).toBe(true) // it IS an SVG — so this is a slim-time refusal, not "not svg"
    const result = await svgAdapter.slim(input, { plan: 'balanced' })
    expect(result.outcome.ok).toBe(false)
    expect(result.output).toBeNull()
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('UNSUPPORTED_INPUT')
      expect(result.outcome.detail).toMatch(/UTF-8/)
    }
  })

  it('preserves <script> and event handlers — a size tool, not a sanitizer (locks the decision)', async () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
    // Comment + trailing-zero coords guarantee shrinkage; the active content must survive even under crash.
    const svg = enc(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" onload="run()">' +
        '<!-- editor note --><script>run()</script>' +
        '<rect x="10.0000" y="10.0000" width="180.0000" height="180.0000"/></svg>',
    )
    const result = await svgAdapter.slim(svg, { plan: 'crash' })
    expect(result.outcome.ok).toBe(true)
    const out = new TextDecoder().decode(result.output as Uint8Array)
    expect(out).toMatch(/<script/) // scripts NOT stripped
    expect(out).toMatch(/onload/) // event handlers NOT stripped
  })

  it('the balanced output really is what weigh/slim promises — decodes as SVG', async () => {
    const out = (await svgAdapter.slim(pathHeavySvg(), { plan: 'keto' })).output as Uint8Array
    expect(text(out)).toMatch(/<path/) // the drawing survived the precision reduction
  })
})
