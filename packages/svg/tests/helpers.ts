/** Deterministic SVG fixtures for the unit + conformance suites. All pure strings → UTF-8 bytes. */

const enc = new TextEncoder()

export function svgBytes(markup: string): Uint8Array {
  return enc.encode(markup)
}

export function text(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * An editor-export-style SVG with real optimization headroom: an XML decl, a comment, editor metadata +
 * namespaces, redundant whitespace, and high-precision coordinates — exactly the cruft svgo removes.
 */
export function messySvg(): Uint8Array {
  return svgBytes(
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Generator: a vector editor -->
<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" version="1.1">
  <metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><dc:title></dc:title></rdf:RDF></metadata>
  <defs></defs>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer">
    <circle cx="60.00000000" cy="60.00000000" r="48.00000000" fill="#2563eb" fill-opacity="1.0000000"/>
    <rect x="40.000000" y="40.000000" width="40.0000000" height="40.0000000" fill="#ffffff"/>
  </g>
</svg>
`,
  )
}

/** An already-minified tiny SVG svgo can't shrink further — exercises the never-bigger guard. */
export function minimalSvg(): Uint8Array {
  return svgBytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')
}

/**
 * A path-heavy SVG whose coordinates carry many decimals, so reducing float precision meaningfully changes
 * the byte count — used to prove keto/crash (lower precision) beat balanced/lowcarb (higher).
 */
export function pathHeavySvg(): Uint8Array {
  const pts: string[] = []
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 6.3891234567).toFixed(7)
    const y = (Math.abs(Math.sin(i)) * 199.7654321).toFixed(7)
    pts.push(`${i === 0 ? 'M' : 'L'}${x},${y}`)
  }
  return svgBytes(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
      `<path d="${pts.join(' ')}" fill="none" stroke="#111827" stroke-width="2.0000000"/>` +
      `</svg>`,
  )
}

/** An SVG prefixed with a UTF-8 BOM (0xEF 0xBB 0xBF) — proves detect/decoding tolerates a leading BOM. */
export function svgWithBom(): Uint8Array {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf])
  const svg = svgBytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>')
  return new Uint8Array([...bom, ...svg])
}
