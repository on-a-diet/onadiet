# SVG golden corpus

The real-shaped SVG used by the SVG golden-corpus integration test
([`../svg-corpus.integration.test.ts`](../svg-corpus.integration.test.ts)). It drives the
[`svgAdapter.slim`](../../../src/adapter.ts) pipeline and asserts **measured** before/after per plan, that
`cleanse` is genuinely lossless, the monotonic plan ladder, honest `TARGET_INFEASIBLE`, and never-bigger.

| File                | ~Size  | What it is / why it's here                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor-export.svg` | 2.4 KB | A checkmark-in-circle icon **hand-authored to mirror a real vector-editor (Inkscape-style) export**: an XML declaration, a comment, `<metadata>` (Dublin Core / RDF), `sodipodi`/`inkscape` namespaces + a `<sodipodi:namedview>`, editor attributes, and **fractional bezier path coordinates**. That's exactly the cruft `cleanse` strips losslessly and the high-precision geometry the `keto`/`crash` precision reduction shrinks. |

**Provenance / license:** authored for this repo (Apache-2.0, same as the package). It is **not** a
third-party file — for SVG the meaningful test is "does svgo strip real editor cruft and reduce precision,"
not the artwork, so a controlled, license-free hand-authored export is the honest, deterministic fixture
(no sourcing/trademark question, and we control exactly which cruft it carries). It uses the real Inkscape
namespace URIs so `svgo`'s `removeEditorsNSData` recognizes and removes them.

## Adding a file

Only add SVGs that are safe to publish here — authored for this repo, or explicitly permissively licensed /
public-domain (verify, don't assume "publicly viewable" = license-clean). Prefer one that exercises a path
the synthetic unit fixtures in [`../../helpers.ts`](../../helpers.ts) can't — e.g. a new class of cruft or a
genuinely different geometry profile. Keep the corpus tiny; every file is cloned on every checkout.
