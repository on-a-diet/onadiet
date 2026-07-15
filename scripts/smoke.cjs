'use strict'
/*
 * Package smoke test — the built packages must import cleanly under BOTH module systems, on real Node,
 * resolved BY NAME (so the package.json `exports` maps + import/require conditions are exercised, not just
 * the dist files). Guards a broken exports map or a CJS/ESM interop regression before it can ship.
 * Run via `pnpm smoke` (after build) or in CI after the build step.
 */
const { pathToFileURL } = require('node:url')

async function check(label, mod) {
  for (const name of [
    'parseSize',
    'formatBytes',
    'savedPercent',
    'resolvePlan',
    'DIET_PLANS',
    'OnadietError',
  ]) {
    if (mod[name] == null) throw new Error(`${label} @onadiet/core: missing export ${name}`)
  }
  if (mod.parseSize('5mb') !== 5_000_000) throw new Error(`${label}: parseSize round-trip failed`)
  if (mod.resolvePlan('keto').plan !== 'keto') throw new Error(`${label}: resolvePlan failed`)
}

async function checkCli(label, mod) {
  if (typeof mod.run !== 'function') throw new Error(`${label} onadiet: missing export run`)
  if (mod.nodePorts == null) throw new Error(`${label} onadiet: missing export nodePorts`)
  // run() is async and takes injected ports; --help touches no I/O, so real ports are safe here.
  const res = await mod.run(['--help'], mod.nodePorts)
  if (res.code !== 0 || !res.output.includes('diet'))
    throw new Error(`${label}: cli run(--help) failed`)
}

async function checkPdf(label, mod) {
  for (const name of ['pdfAdapter', 'sharpImageCodec', 'ssimMetric', 'PDF_ADAPTER_KIND']) {
    if (mod[name] == null) throw new Error(`${label} @onadiet/pdf: missing export ${name}`)
  }
  if (mod.pdfAdapter.kind !== 'pdf') throw new Error(`${label} @onadiet/pdf: wrong adapter kind`)
  // Loading @onadiet/pdf pulls in sharp (native) — a broken native install fails here, not in prod.
  // Bytes for "%PDF-" (avoid Buffer/TextEncoder — keep this CJS script dependency-free).
  if (!mod.pdfAdapter.detect(Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d)))
    throw new Error(`${label} @onadiet/pdf: detect failed`)
}

async function checkImage(label, mod) {
  for (const name of [
    'imageAdapter',
    'sniffImageFormat',
    'sharpImageCodec',
    'IMAGE_ADAPTER_KIND',
  ]) {
    if (mod[name] == null) throw new Error(`${label} @onadiet/image: missing export ${name}`)
  }
  if (mod.imageAdapter.kind !== 'image')
    throw new Error(`${label} @onadiet/image: wrong adapter kind`)
  // PNG magic bytes (\x89PNG\r\n\x1a\n) — detect must recognize it, and reject non-images.
  if (!mod.imageAdapter.detect(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
    throw new Error(`${label} @onadiet/image: detect failed`)
  if (mod.sniffImageFormat(Uint8Array.of(0xff, 0xd8, 0xff)) !== 'jpeg')
    throw new Error(`${label} @onadiet/image: sniff failed`)
}

async function checkSvg(label, mod) {
  for (const name of ['svgAdapter', 'looksLikeSvg', 'optimizeSvg', 'configForPlan']) {
    if (mod[name] == null) throw new Error(`${label} @onadiet/svg: missing export ${name}`)
  }
  if (mod.svgAdapter.kind !== 'svg') throw new Error(`${label} @onadiet/svg: wrong adapter kind`)
  // "<svg " bytes — detect must recognize an SVG root, and reject non-SVG.
  if (!mod.svgAdapter.detect(Uint8Array.of(0x3c, 0x73, 0x76, 0x67, 0x20)))
    throw new Error(`${label} @onadiet/svg: detect failed`)
  if (mod.svgAdapter.detect(Uint8Array.of(0x25, 0x50, 0x44, 0x46)))
    throw new Error(`${label} @onadiet/svg: detect false-positive on %PDF`)
}

async function main() {
  // CJS require() — resolves the `require` condition of each exports map.
  await check('require', require('@onadiet/core'))
  await checkCli('require', require('onadiet'))
  await checkPdf('require', require('@onadiet/pdf'))
  await checkImage('require', require('@onadiet/image'))
  await checkSvg('require', require('@onadiet/svg'))

  // ESM import() by name — resolves the `import` condition.
  const coreEsm = await import('@onadiet/core')
  await check('import', coreEsm)
  const cliEsm = await import('onadiet')
  await checkCli('import', cliEsm)
  const pdfEsm = await import('@onadiet/pdf')
  await checkPdf('import', pdfEsm)
  const imageEsm = await import('@onadiet/image')
  await checkImage('import', imageEsm)
  const svgEsm = await import('@onadiet/svg')
  await checkSvg('import', svgEsm)

  // touch pathToFileURL so the import above is unmistakably real Node ESM, not bundler magic
  void pathToFileURL(__filename)

  console.log(
    'smoke: OK — @onadiet/core, onadiet, @onadiet/pdf, @onadiet/image, @onadiet/svg load under import + require',
  )
}

main().catch((err) => {
  console.error('smoke: FAILED —', err.message)
  process.exit(1)
})
