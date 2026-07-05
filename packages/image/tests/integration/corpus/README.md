# Image golden corpus

Real images used by the image golden-corpus integration tests
([`../image-corpus.integration.test.ts`](../image-corpus.integration.test.ts)). They drive the standalone
[`imageAdapter.slim`](../../../src/adapter.ts) pipeline against genuine, non-synthetic content and assert
**measured** before/after savings, the SSIM the plan floors actually hold, honest floor-limited outcomes,
alpha preservation, and the never-bigger guard — the "orchestrate & measure, never fake the win" invariant,
proven on files the test author didn't synthesize.

They are **fixtures only** — inputs to a size-search regression suite. The tests never modify them in place
(output goes to memory). Each covers a distinct content class + code path the synthetic unit fixtures in
[`../../helpers.ts`](../../helpers.ts) can't reach at realistic scale:

| File                 | ~Size  | Class                       | Why it's here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `earth-apollo17.jpg` | 421 KB | **photograph** (JPEG)       | Real photographic detail — the primary lossy case. Drives the SSIM floor validation (a photo is where the floors actually bind, unlike palette-friendly graphics).                                                                                                                                                                                                                                                                                                                                                                               |
| `illustration.png`   | 1.0 MB | **flat graphic** (RGB PNG)  | A near-flat line-art illustration, no alpha. Exercises the `flat` content heuristic and the PNG→WebP/AVIF **format-switch** lever (huge savings a keep-PNG can't reach).                                                                                                                                                                                                                                                                                                                                                                         |
| `card.png`           | 141 KB | **flat graphic** (RGBA PNG) | Anti-aliased text on a card — an **RGBA export whose alpha channel is fully opaque** (min = max = 255), the extremely common "PNG exported with alpha but nothing transparent" case. Exercises the redundant-opaque-alpha path (the wasted channel is dropped, the image stays valid) plus the `flat` heuristic + format switch at a smaller size than `illustration.png`. _(Real, non-opaque transparency is covered by the synthetic `transparentPng` unit fixture — the golden corpus carries no license-clean genuinely-transparent image.)_ |

**Provenance / license:**

- `earth-apollo17.jpg` — the Apollo 17 "Blue Marble" (AS17-148-22727), photographed by the Apollo 17 crew,
  December 1972. A **NASA work → U.S. public domain** (not subject to copyright in the US). Sourced from
  Wikimedia Commons (a 1280 px re-scale of the NASA scan). Included as a representative real photograph.
- `illustration.png` and `card.png` — **original work by the repo author** (Sharvil Kadam), included with
  permission. `card.png` carries the author's own social handle; it is their own published content. Its alpha
  channel is fully opaque (an RGBA export, no actual transparency).

## Adding a file

Only add images that are safe to publish in this repo — **you own them**, they're public-domain (e.g. a
U.S.-government work like the NASA photo), or explicitly permissively licensed. **"Publicly viewable" is not
"license-clean"** — verify and record the source here before adding. Prefer a file that exercises a path the
synthetic unit fixtures can't reach at realistic scale (a new content class, a real format, real alpha).
Keep the corpus small — every file is cloned on every checkout and slimmed on every integration run.
