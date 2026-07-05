# Golden corpus

Real PDFs used by the golden-corpus integration tests
([`../golden-corpus.integration.test.ts`](../golden-corpus.integration.test.ts)). These exercise the
`slim` pipeline against genuine, non-synthetic content and assert **measured** before/after savings, the
honest floor-limited outcomes, and structural integrity — the "orchestrate & measure, never fake the win"
invariant, proven on a file the test author didn't generate.

They are **fixtures only** — inputs to a size-search regression suite. Nothing here is redistributed as a
product, and the tests never modify these files in place (output goes to memory).

| File                  | ~Size  | What it is / why it's here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spacex-roadshow.pdf` | 9.0 MB | SpaceX's IPO roadshow presentation — a **public document**: filed with the SEC as a Free Writing Prospectus (a filing type meant for broad public distribution to investors) and published on SpaceX's own CDN alongside the June 2026 roadshow. © SpaceX; included here solely as a representative real-world **image-heavy** fixture, not for its content. Structurally it's ideal: 60 pages, 224 image XObjects, ~91% of the file is embedded images and ~64% is plainly slimmable DCTDecode (Device RGB/Gray), while 88 `/SMask` images plus Flate/ICCBased/Indexed images **must be left untouched** — so one file exercises both the slim path and the leave-alone guard at real scale. |

**Provenance / source (public):**

- SEC EDGAR — Free Writing Prospectus (FWP), CIK 0001181412 (SpaceX), filed 2026-06.
- SpaceX CDN — `content.spacex.com/.../SpaceX IPO Roadshow.pdf`.

## Adding a file

Only add PDFs that are safe to publish in this public repo — you own them, they're public-domain
(e.g. US-government works), a public regulatory filing, or explicitly permissively licensed. **"Publicly
viewable" is not the same as "license-clean"** — verify before adding, and record the source here. Prefer
files that exercise a path the synthetic unit fixtures in [`../../helpers.ts`](../../helpers.ts) can't reach
at realistic scale. Keep the total corpus small — every file is cloned on every checkout and slimmed on
every integration run.
