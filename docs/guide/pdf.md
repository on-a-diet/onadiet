# Slimming PDFs

How onadiet shrinks a PDF to a byte target or a quality plan — locally, safe by default, holding a
measured perceptual-quality floor, with an honest before/after receipt.

## Table of contents

- [What gets slimmed](#what-gets-slimmed)
- [The pipeline](#the-pipeline)
- [Safety rules](#safety-rules)
- [What can live in a PDF](#what-can-live-in-a-pdf)
- [Where the savings come from](#where-the-savings-come-from)
- [The size search](#the-size-search)
- [The quality floor](#the-quality-floor)
- [Plans for PDF](#plans-for-pdf)
- [Architecture and seams](#architecture-and-seams)
- [Outcomes and error codes](#outcomes-and-error-codes)
- [Using the CLI](#using-the-cli)

## What gets slimmed

Give onadiet a single PDF and a byte target (or a named plan) and it takes the file down to size **on your
machine**, safe by default, holding a perceptual-quality floor, and printing an honest receipt.

The win comes from two places:

- **Embedded images** — downsample over-resolution images toward their on-page display size, then
  re-encode them (JPEG via mozjpeg). This is where most of the fat lives in real-world PDFs.
- **Structural cleanup** — dedup repeated resources, pack objects into object/xref streams, strip junk
  metadata, lossless re-deflate. Zero pixel change.

What is deliberately **not** attempted on a PDF today (each is an honest caveat, not a silent gap):

- **Font subsetting** of already-embedded fonts, **content-stream recompression**, and **per-page render
  verification** — these need heavier or copyleft tooling. See [the honest gap](#where-the-savings-come-from).
- **Non-simple images** — only "simply slimmable" images are re-encoded (defined in
  [What can live in a PDF](#what-can-live-in-a-pdf)); anything riskier is left untouched, never corrupted.

Standalone images, SVG, and whole folders are separate subjects with their own guides — see
[`./images.md`](./images.md) and [`./folders.md`](./folders.md). The image codec work is shared across them.

## The pipeline

Every run walks the same six verbs — `detect → weigh → plan → slim → verify → report` — made concrete for
PDF:

```
diet report.pdf --to 5mb
  │
  ▼
DETECT   pdf-lib parses the bytes (magic bytes, not the extension).
         ├─ encrypted?           → fail ENCRYPTED_PDF (can't operate)
         ├─ digitally signed?    → fail SIGNED_PDF unless --allow-signed (never silently break)
         └─ has AcroForm?        → proceed, preserve fields, note in report
  │
  ▼
WEIGH    enumerate every embedded image XObject:
         bytes · pixel dims · stored DPI vs on-page display size · colorspace · current codec.
         Attribute total bytes to causes (images / fonts / structure / metadata).
         → this is also exactly what `diet weigh` prints.
  │
  ▼
PLAN     resolve the diet plan (default balanced) + target into a set of per-image "levers"
         (candidate re-encodings) and structural passes. No bytes written yet — `diet plan` stops here.
  │
  ▼
SLIM     the size search converges to the target along the degrade ladder, holding the quality floor,
         re-embedding each chosen image; then the structural save.
  │
  ▼
VERIFY   measure real output bytes + per-image perceptual delta. If we didn't beat the input,
         or can't hold the floor under the target → honest outcome, keep the original.
  │
  ▼
REPORT   human receipt + --json: input→output, %, per-lever actions, plan, floor held, outcome.
```

## Safety rules

These are hard invariants — the acceptance bar every run is held to:

1. **Never overwrite the original.** Output is written to a temp file in the destination directory, then
   atomically renamed into place. The default output is `report.diet.pdf`; overwriting in place requires an
   explicit opt-in.
2. **Never write a bigger file.** If the best result is larger than or equal to the input, keep the
   original and say so (`keptOriginal: true`).
3. **Never silently break a signed PDF.** A digital signature can't survive a re-save, so a signed PDF
   **fails `SIGNED_PDF` by default**. `--allow-signed` overrides, with a loud warning that the signature
   will be invalidated.
4. **Preserve correctness.** Page count, text selectability, and form fields are preserved — images are
   re-embedded and structure rewritten; pages are **not** rasterized and forms are **not** flattened.
5. **Never report an unverified saving.** Every number in the receipt is measured on the actual output.
6. **Encrypted / password-protected PDFs** fail `ENCRYPTED_PDF` — passwords are never guessed and
   encryption is never stripped.

Atomic writes and all file I/O live in the runtime/CLI layer, never in the pure core (see
[Architecture and seams](#architecture-and-seams)).

## What can live in a PDF

The set of usable image levers is constrained by the PDF format itself, not by preference. A PDF image
XObject may only use these filters: `DCTDecode` (JPEG), `JPXDecode` (JPEG 2000), `JBIG2Decode`,
`CCITTFaxDecode`, and the lossless ones (`FlateDecode` / `LZWDecode`).

**WebP and AVIF are _not_ valid inside a PDF** — a file using them wouldn't open in most readers. So the
photo lever for a PDF is **mozjpeg (quality + chroma subsampling) plus downsampling**. (WebP and AVIF are
real levers for _standalone_ images — see [`./images.md`](./images.md).)

Other in-spec filters are deliberately deferred:

- **JPEG 2000** (`JPXDecode`) — better ratios, but imperfect reader support.
- **CCITT / JBIG2** bilevel-scan paths — JBIG2 gives the biggest scanned-text win, but its best encoder is
  copyleft; CCITT is weaker.

**"Simply slimmable" images only.** To avoid ever corrupting a file, `slim` re-encodes only plain,
single-filter `DCTDecode` (JPEG) images in a `DeviceGray` or `DeviceRGB` colorspace with no soft-mask,
color-key mask, or `/Decode` remap. Riskier images — ICCBased, Indexed, CMYK, masked, or losslessly-stored
photos — are **left untouched**. Faithful handling of those, and the lossless-photo → JPEG recode, are
planned rather than active today.

The engine ships with a permissive, in-house encoding path (pdf-lib for parse/rebuild, sharp/mozjpeg for
image work). Copyleft engines such as Ghostscript, pngquant, and `jbig2enc` are **never bundled**; if
added later they are optional, opt-in adapters detected on your `PATH`. Structural cleanup is done with
pure-JS pdf-lib to keep the default install light; a native optimizer (for example qpdf) is a candidate
optional adapter if measured wins justify it.

## Where the savings come from

Being honest about the ceiling of this approach — the outcome depends heavily on what the PDF is made of:

| PDF content type               | Main lever                                              | Expected win | Note                                    |
| ------------------------------ | ------------------------------------------------------- | ------------ | --------------------------------------- |
| **Image-heavy** (scans, decks) | downsample over-DPI images + re-encode JPEG (mozjpeg)   | **large**    | the best case; images dominate the file |
| **Mixed** raster / vector      | image re-encode + structural                            | moderate     |                                         |
| **Text / vector-heavy**        | structural only (object streams, dedup, strip metadata) | modest       | content streams aren't recompressed     |
| **Already-optimized**          | keep original                                           | ~0           | honest "already lean"                   |

> **The honest gap.** onadiet does **not** (today) subset already-embedded fonts, recompress content
> streams, or re-render pages. On image-heavy PDFs that gap is small — images dominate. On text-heavy PDFs
> it's real, and it's exactly what an optional external engine could close later. The engine reports what it
> actually achieved rather than pretending.

## The size search

The kernel of `slim` satisfies **two constraints at once**: hit the byte target **and** hold the quality
floor. It walks a **degrade ladder** in a fixed, cheapest-to-quality-first order — _re-encode quality →
downscale → switch codec_:

```
for the whole doc, converge on total bytes ≤ target:
  rank images by biggest single-step byte saving   ── attack the fattest first
  for each image, walk the ladder until its budget share is met OR the floor is hit:

     ┌─ step 1  lower JPEG quality           (q: 90 → 80 → …) + chroma subsampling, measure SSIM
     │            floor held?  keep smaller. floor broken?  step back one, go to step 2.
     ├─ step 2  downscale DPI toward display  (300 → 200 → 150 → …), re-measure
     │            floor held?  keep. broken?  step back, go to step 3.
     └─ step 3  recode container             losslessly-stored photo (FlateDecode) → DCTDecode JPEG
                  — the only codec switch valid inside a PDF; re-measure, keep if the floor holds.

  total ≤ target?  → success.
  total > target with every image already at its floor?  → infeasible (reported honestly).
```

> **Ladder note.** Step 3 is _not_ "JPEG → WebP" — WebP/AVIF can't live in a PDF (see
> [What can live in a PDF](#what-can-live-in-a-pdf)). Inside a PDF the only useful recode is turning a
> **losslessly-stored photo** (a big FlateDecode image that is really a photograph) into JPEG.
> JPEG-to-JPEG images stay on steps 1–2 (quality + DPI). The step-3 recode and JPEG 2000 / bilevel recodes
> are planned rather than active today.

**Ranking heuristic.** The search advances the image with the biggest **single-step byte saving** first
("attack the fattest first"), always restricted to floor-holding candidates. This is a simple greedy pass,
not a global optimum; a quality-weighted ranking (bytes saved ÷ quality lost) is a documented later
refinement. It converges and never breaks the floor.

**Infeasibility is a first-class, honest outcome** — not a silent quality cliff — and the engine says
_why_:

- **Respect the floor by default.** If the target can't be reached without dropping below the floor, don't.
  A blurry file is never secretly shipped to hit a number.
- **Floor-bound** — the floor is the binding constraint: a floorless run (same ladder) _would_ have reached
  the target. The engine returns the closest floor-holding size and points you at `crash` / `--force`.
- **Structurally infeasible** — infeasible even floorless: the content is incompressible enough, or the
  fixed (non-image) bytes alone exceed the target, that this ladder can't reach it. Loosening the floor
  won't help, and the message says so rather than blaming the floor.
- **Opt out** — the `crash` plan (or an explicit `--force`) removes the floor to chase the target, still
  reporting the measured quality drop honestly.

Because the size search is **pure** — it drives an injected codec and metric, with no I/O — the entire
decision engine is unit-testable against a fake adapter with a known cost curve: convergence, floor
behaviour, and infeasibility are all provable without a real PDF.

## The quality floor

- **Metric:** SSIM (structural similarity, 0–1, higher = closer) — permissive, fast, well understood, and
  deterministic. It's swappable via a metric seam, so alternatives (butteraugli, DSSIM) can slot in later.
- **What's compared:** the **re-encoded image against its own original raster** (per-image SSIM), _not_ a
  rendered page. This deliberately avoids needing a full PDF rasterizer (the mature ones are heavy or
  copyleft), and per-image SSIM is fast and deterministic. Per-page render verification is a later,
  optional enhancement.
- **Floors per plan:** `cleanse` 1.0 (lossless), `lowcarb` 0.96 (visually-lossless), `balanced` 0.90
  (default), `keto` 0.80 (aggressive), `crash` 0 (floorless). `cleanse` never re-encodes lossily, so the
  metric doesn't gate it.

These floors are validated against a real corpus rather than guessed. On a public 9 MB, 224-image
presentation deck, they bound the achievable reduction monotonically:

| Plan       | SSIM floor | Reduction on the 9 MB / 224-image deck |
| ---------- | ---------- | -------------------------------------- |
| `cleanse`  | 1.0        | ~0% (lossless no-op today — see below) |
| `lowcarb`  | 0.96       | ~10%                                   |
| `balanced` | 0.90       | ~47%                                   |
| `keto`     | 0.80       | ~59%                                   |
| `crash`    | 0          | ~64%                                   |

The monotonic ordering confirms the ladder is calibrated, not guessed.

## Plans for PDF

Each plan maps the canonical quality contract onto concrete PDF behaviour:

| Plan       | Lossless | PDF behaviour                                                                                                                                                                                                                |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cleanse`  | ✓        | **Structural only** — dedup resources, object/xref streams, strip junk metadata, lossless re-deflate. Zero pixel change. _Currently a lossless no-op (see the caveat below): it keeps the original and reports it honestly._ |
| `balanced` | —        | Default. Structural + sensible lossy image re-encode + downsample images above a screen-DPI threshold, holding a solid floor.                                                                                                |
| `lowcarb`  | —        | Visually-lossless — hold a **strict** perceptual floor; smaller than cleanse, provably near-identical.                                                                                                                       |
| `keto`     | —        | Aggressive — lower floor, more downsampling.                                                                                                                                                                                 |
| `crash`    | —        | Tiny — floorless, maximum downsample, accepts visible loss. Still **standard PDF/JPEG** out.                                                                                                                                 |

> **`cleanse` is a no-op for PDF today.** Lossless structural re-optimization isn't wired yet, so `cleanse`
> keeps the original (and returns `TARGET_INFEASIBLE` if you also give it a byte target).

> **Signed PDFs, any plan.** Even `cleanse` **rewrites** the file, so it still trips the signed-PDF guard —
> there is no "safe for a signed PDF" plan, because any re-save invalidates a signature. That's a
> refuse-or-warn, not a plan knob.

## Architecture and seams

The decision engine is a **pure core** with no codec SDK and no raw I/O; the codec, the metric, and all
file/clock/exit-code concerns are injected from the outside. That boundary is why the whole search is
testable and why adapters can be swapped.

```
        ┌──────────────── @onadiet/core (pure engine) ────────────────┐
        │  detect · weigh · plan · size search · verify · report        │
        │  interfaces only: FormatAdapter · ImageCodec · QualityMetric  │
        │  no codec SDK, no raw I/O                                      │
        └──────────▲───────────────────────────────────▲───────────────┘
                   │ implements                          │ injected
        ┌──────────┴──────────┐            ┌────────────┴──────────────┐
        │  @onadiet/pdf        │            │  runtime / CLI (onadiet)   │
        │  pdf-lib + sharp     │            │  file read/write, atomic   │
        │  PDF adapter + codec │            │  temp+rename, exit codes   │
        └──────────────────────┘            └────────────────────────────┘
```

The extension seams (each with a conformance suite every implementation must pass):

- **`FormatAdapter`** — `detect` + `weigh` + `slim(bytes, request)`; the adapter owns format-specific
  extract / re-embed / serialize.
- **`ImageCodec`** — `encode(raster, params) → bytes` / `decode(bytes) → raster`; the lever the size search
  pulls. Implemented over sharp in `@onadiet/pdf`.
- **`QualityMetric`** — `measure(reference, candidate) → number` (0–1). SSIM by default.
- **The size search** — the pure convergence loop above; it depends only on those three interfaces, never
  on sharp or pdf-lib.

For exact interface signatures and the full library surface, see [`./api-reference.md`](./api-reference.md).

## Outcomes and error codes

- **`Outcome`** is `DietSuccess | DietFailure`. `DietSuccess.method` names the winning levers (for example
  `"downsample+jpeg-q78"`), and `keptOriginal` flags the "couldn't beat it" case.
- **`Weight`** (from `weigh`) attributes total bytes to causes — images / fonts / structure / metadata.
- PDF-relevant error codes: **`SIGNED_PDF`** (refused unless `--allow-signed`), **`ENCRYPTED_PDF`**
  (refused), and **`TARGET_INFEASIBLE`** (can't reach the target — floor-bound, or structurally
  impossible, or a `cleanse` run given a target).

The full error catalog, the `SlimRequest` fields (`plan`, `targetBytes`, `floor`, `allowSigned`), and the
result types live in [`./api-reference.md`](./api-reference.md).

## Using the CLI

The binary is `diet` (alias `onadiet`). Everything accepts `--json` for a stable machine-readable object.
New to the tool? Start with [`./getting-started.md`](./getting-started.md).

- `diet report.pdf --to 5mb` (aliases `--under` / `--goal`) — full pipeline, writes `report.diet.pdf`.
- `diet report.pdf --plan lowcarb` — a plan without an explicit byte target.
- `diet weigh report.pdf` — weigh-in and report only, no write.
- `diet plan report.pdf --to 5mb` — dry-run: what it _would_ do, no write.
- `diet check report.pdf --max 5mb` — CI byte-budget gate: exit 0 if already under budget, non-zero if not
  (no write).

Common flags: `--plan`, `--to` / `--under` / `--goal`, `--out`, `--allow-signed`, `--json`, `--force`.
Note that `--force` (and `--allow-signed`) proceeds on a signed PDF **and** drops the quality floor to `0`.

For the complete command and flag reference, see [`./cli.md`](./cli.md). For the project overview, see the
[root README](../../README.md).
