# Images

Slim standalone image files — JPEG, PNG, WebP, and AVIF — down to a size target or a quality plan, entirely on your machine, holding a measured perceptual-quality floor and never touching the original.

## Table of contents

- [Supported formats](#supported-formats)
- [How slimming works](#how-slimming-works)
- [Where the savings come from](#where-the-savings-come-from)
- [Switching format](#switching-format)
- [Photo vs flat detection](#photo-vs-flat-detection)
- [Plans and the quality floor](#plans-and-the-quality-floor)
- [Safety guarantees](#safety-guarantees)
- [CLI examples](#cli-examples)
- [Measured results](#measured-results)
- [Honest caveats](#honest-caveats)
- [SVG (vector)](#svg-vector)
- [Using the library](#using-the-library)

Images ride the same engine as everything else: the CLI (`diet`), the importable library (`@onadiet/image`), and the CI byte-budget gate (`diet check`) all work on images.

## Supported formats

**Inputs:** JPEG, PNG, WebP, and AVIF, plus decode of several other common formats. **Outputs:** JPEG, PNG, WebP, and AVIF.

- **HEIC is decode-only.** A HEIC input can be re-encoded to JPEG, WebP, or AVIF; onadiet never writes HEIC.
- **Animated and multi-frame images are refused.** Animated WebP/GIF/APNG and other multi-frame files return `UNSUPPORTED_INPUT` rather than silently keeping only the first frame.

All encoders ship in the box and are permissively licensed:

| Task                     | Encoder                   |
| ------------------------ | ------------------------- |
| Decode / resize / encode | sharp (libvips)           |
| JPEG encode              | mozjpeg (via sharp)       |
| WebP encode              | libwebp (via sharp)       |
| AVIF encode              | libheif + aom (via sharp) |
| PNG encode               | sharp / libvips           |
| Perceptual metric        | in-house SSIM             |

A dedicated lossless PNG optimizer (oxipng) is on the roadmap; it is **not** used today — PNG is currently encoded through sharp/libvips. Lossy PNG palette quantization (pngquant) is GPL-licensed and is never bundled; it is not wired today either. See [Honest caveats](#honest-caveats).

## How slimming works

The canonical verbs — detect, weigh, plan, slim, verify, report — made concrete for a single image:

- **Detect** — reads the header (magic bytes, not the file extension): format, dimensions, channels, alpha, colorspace, and EXIF orientation. Unsupported or animated input gets an honest refusal.
- **Weigh** — the whole file is the subject: bytes, pixel dimensions, format, alpha, and a cheap photo-vs-flat estimate. `diet weigh photo.jpg` prints this.
- **Plan** — resolves the plan (default `balanced`) plus any target into a candidate ladder: quality steps, downscale steps, and — if allowed — the set of output formats. Nothing is written yet. `diet plan photo.jpg --to 500kb` shows it.
- **Slim** — a dual-constraint size search (byte target and quality floor) converges along the ladder, holding the floor, and picks the smallest floor-holding candidate — across formats when format switching is enabled.
- **Verify** — measures the real output bytes and SSIM against the original. If the result didn't beat the input, or can't hold the floor under the target, onadiet keeps the original and says so.
- **Report** — a human receipt plus `--json`: input → output, percent saved, chosen format/quality/scale, SSIM, and the outcome. The method reads like `webp q62 @ 70% (from jpeg)`.

A single image is the simple case: there is exactly one raster, so the search just walks that one image's candidate ladder — no object graph and no leave-alone guard.

## Where the savings come from

Four levers, in rough order of leverage:

1. **Re-encode at a lower quality** (JPEG/WebP/AVIF) — the biggest win on photos.
2. **Downscale** — an image displayed at 800px but stored at 4000px carries 25× the pixels it needs.
3. **Switch format** — recode to WebP or AVIF, which are dramatically smaller at equal quality (measured: on a 64×64 gradient, AVIF was ~1.4× smaller than WebP and ~1.7× smaller than mozjpeg; the gap widens on real photos). This is the lever a PDF image can't use — WebP/AVIF are invalid inside a PDF (see [PDF](./pdf.md)).
4. **Lossless optimize** — strip bulky metadata and losslessly re-encode. This is `cleanse`'s eventual job, but it isn't built yet, so `cleanse` is a lossless no-op today (see [Honest caveats](#honest-caveats)). The lossy plans deliver today's wins.

## Switching format

A standalone image can legally change container, so the candidate space gains a **format** axis alongside quality and scale.

- **Default: keep the input format.** `photo.jpg → photo.diet.jpg`. Least surprise, predictable extension.
- **`--format <keep|auto|jpeg|png|webp|avif>`** opts into a switch. `keep` (the default) stays on the input format. `auto` lets the search pick the **smallest floor-holding candidate across the allowed formats** and names the output accordingly (`photo.diet.avif`). A named format (`jpeg`/`png`/`webp`/`avif`) forces that one. The chosen format must be able to represent the source faithfully (alpha, etc.).
- **Plan-gated switching.** `keto` and `crash` may switch format implicitly to find the smallest floor-holding result; `cleanse`, `lowcarb`, and `balanced` keep the format unless you pass `--format`.
- **Alpha and animation guardrails.** onadiet never picks a format that would drop alpha the source actually uses, and never a format that can't hold every frame of a multi-frame source (multi-frame inputs are refused outright).

`--format` is ignored for PDFs, which always emit JPEG.

## Photo vs flat detection

A cheap, deterministic classifier (no ML) picks a sane default codec family per image, derived from a downsampled histogram plus edge/flat-run statistics:

- **Photo-like** (continuous tone, many unique colors, few flat runs) → **lossy** JPEG/WebP/AVIF.
- **Flat or graphic** (screenshots, logos, line art; few colors, large flat regions, hard edges) → **lossless** PNG or lossless WebP. Lossy encoding on flat art smears edges for little gain.

This is only a default — `--plan` and `--format` always win, and the quality floor still gates the result.

## Plans and the quality floor

The quality floor is **SSIM**: the re-encoded image is compared against the original raster (whole image). A downscaled candidate is resampled back to the original geometry before comparison, so the floor counts the perceptual cost of the downscale. Lossless PNG and lossless-WebP outputs are trivially SSIM 1.0, so the floor doesn't gate them.

| Plan       | SSIM floor       | Behavior for images                                                                                                                  |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `cleanse`  | 1.0              | Lossless only. **A no-op today** (keeps the original); with a byte target it returns `TARGET_INFEASIBLE` and points at a lossy plan. |
| `lowcarb`  | 0.96             | Visually-lossless — strict floor, gentle re-encode; provably near-identical. Keeps the format unless `--format`.                     |
| `balanced` | 0.90 _(default)_ | Sensible lossy re-encode plus downscale above a screen-resolution threshold. Keeps the format unless `--format`.                     |
| `keto`     | 0.80             | Aggressive — lower floor, more downscale; may auto-switch to WebP/AVIF for the smallest floor-holding result.                        |
| `crash`    | 0 _(floorless)_  | Tiny — floorless, max downscale, best format wins; may drop the ICC profile. Still standard formats out.                             |

## Safety guarantees

1. **Never overwrites the original.** Writes a temp file in the destination directory, then atomic-renames. Default output is `photo.diet.jpg` (or `photo.diet.webp` when the format changes).
2. **Never writes a bigger file.** If the best candidate is greater than or equal to the input, onadiet keeps the original and says so — common for already-optimized JPEGs and for lossless PNGs.
3. **Never silently changes the format.** `photo.jpg` stays a JPEG unless you opt into a switch (`--format`) or use a plan allowed to switch (`keto`/`crash`). The output extension always reflects reality.
4. **Preserves what you can see.** Honors EXIF orientation (never rotates or mirrors); strips only the metadata the plan says to — the default drops bulky EXIF/thumbnails but **keeps** the ICC color profile (dropped only on `crash`).
5. **Never reports an unverified saving.** Every number is measured on the actual output (bytes and SSIM).
6. **Keeps alpha.** An image with transparency won't silently lose it. A lossy path that can't keep alpha (baseline JPEG) is chosen only when the source has no meaningful alpha, or when you opted in.

## CLI examples

```bash
diet photo.jpg                            # slim to a sensible default → photo.diet.jpg
diet photo.jpg --to 500kb                 # hit a size target
diet screenshot.png --plan lowcarb        # visually-lossless PNG
diet photo.jpg --to 300kb --format auto   # smallest floor-holding format → photo.diet.avif
diet weigh photo.png                      # weigh-in: format, dimensions, alpha, photo-vs-flat, bytes
diet plan  photo.jpg --to 500kb           # dry-run: what it would do, writing nothing
diet check banner.png --max 200kb         # CI byte-budget gate: pass/fail
```

Everything speaks `--json`. For slimming whole folders and per-file or whole-tree budgets, see [Folders](./folders.md). For the full flag list and exit codes, see the [CLI guide](./cli.md) and the [API reference](./api-reference.md).

## Measured results

Floor-limited minimum per plan; indicative — exact bytes shift with encoder versions. SSIM is the up-direction figure (downscaled candidates are resampled back to the original geometry before comparison).

| Image (original)              | mode | `lowcarb` (floor 0.96) | `balanced` (0.90)    | `keto` (0.80) †        |
| ----------------------------- | ---- | ---------------------- | -------------------- | ---------------------- |
| `earth-apollo17.jpg` (421 KB) | keep | 319 KB, SSIM 0.982     | 189 KB, 0.944        | 49 KB, 0.814 (→webp) † |
| `illustration.png` (1.0 MB)   | keep | 534 KB, 0.988          | 210 KB, 0.983        | 4 KB, 0.975 (→avif) †  |
| `illustration.png`            | auto | 25 KB, 0.986 (→webp)   | 8 KB, 0.982 (→avif)  | 4 KB, 0.975 (→avif)    |
| `card.png` (141 KB)           | auto | 26 KB, 0.983 (→webp)   | 10 KB, 0.979 (→webp) | 5 KB, 0.969 (→avif)    |

† `keto` and `crash` enable the format switch implicitly, so they may change format even in `keep` mode — the `mode` column governs only the `lowcarb`/`balanced` cells.

The photo is where the floors bind: `lowcarb` holds 0.982 (≥ 0.96) at ~24% smaller, `balanced` holds 0.944 (≥ 0.90) at ~55%, and `keto` holds 0.814 (just above its 0.80 floor) at ~88% — both bytes and quality stay monotonic across plans. On palette-friendly graphics, near-lossless quantization plus the WebP/AVIF switch dominate, so savings run to 95–99% while SSIM stays around 0.98.

## Honest caveats

- **`cleanse` is a no-op for images today.** Lossless re-optimization (e.g. oxipng, jpegtran) isn't wired yet, so image `cleanse` keeps the original; with a byte target it returns `TARGET_INFEASIBLE` and points you at a lossy plan. (SVG `cleanse` does do real lossless work — see below.)
- **oxipng is not used.** PNG is encoded through sharp/libvips. A dedicated lossless PNG optimizer (oxipng) is on the roadmap.
- **pngquant is not bundled or wired.** Lossy PNG palette quantization (pngquant) is GPL-licensed; by policy it would only ever be an optional, PATH-detected adapter. Today `keto`/`crash` use only the in-house sharp/mozjpeg path.
- **HEIC is decode-only.** HEIC in → JPEG/WebP/AVIF out; onadiet never writes HEIC.
- **Animated and multi-frame images are refused** with `UNSUPPORTED_INPUT`.

## SVG (vector)

SVG is a **vector** format, so it runs a genuinely different pipeline from the raster path above: no rasterization, no SSIM floor, no downscale. onadiet drives **svgo** (permissively licensed) and applies the same honest guards — never a bigger file, keep the original when it can't be beaten, a typed refusal on non-SVG input, and an honest `TARGET_INFEASIBLE`. There's no size search: one optimize pass per plan, then the guards.

**Float precision is the quality knob** (there's no continuous quality axis and no perceptual metric):

| Plan       | svgo config                           | Nature                                                            |
| ---------- | ------------------------------------- | ----------------------------------------------------------------- |
| `cleanse`  | cruft-only plugins (no geometry)      | Rendering-identical — strips comments/metadata/editor namespaces. |
| `lowcarb`  | `preset-default`, `floatPrecision: 5` | Visually-lossless — barely rounds coordinates.                    |
| `balanced` | `preset-default`, `floatPrecision: 3` | Default — svgo's curated, rendering-safe precision.               |
| `keto`     | `preset-default` @ 2 + `reusePaths`   | Aggressive — lower precision, dedupe paths.                       |
| `crash`    | `preset-default` @ 1 + `reusePaths`   | Tiny — lowest precision.                                          |

onadiet deliberately does **not** enable `removeScripts`, `removeViewBox`, `removeDimensions`, or `removeTitle`/`removeDesc` — those change behavior, scaling, or accessibility. One consequence worth stating plainly: **onadiet is a size tool, not a sanitizer.** An SVG's `<script>` and event handlers survive slimming, so don't treat a slimmed SVG as XSS-safe. (svgo only parses and re-serializes; it never executes the SVG, resolves external entities, or fetches anything.) With a byte target there's no floor to lean on, so if a plan's optimize doesn't reach the target it refuses honestly and points at a more aggressive plan.

Unlike the raster `cleanse` (a no-op today), **SVG `cleanse` does real lossless work.** Measured on a representative editor export (2.4 KB, with metadata, editor namespaces, and fractional bezier paths): `cleanse` 58% (lossless cruft removal), `lowcarb` 71%, `balanced` 72%, `keto` 75%, `crash` 78% — a monotonic ladder, and the output is always valid SVG.

## Using the library

Images are handled by the `@onadiet/image` adapter, usable directly:

```ts
import { imageAdapter } from '@onadiet/image'

const result = await imageAdapter.slim(bytes, { plan: 'balanced' })
result.output ? save(result.output) : keepOriginal(result.outcome)
```

SVG is handled by `@onadiet/svg`. For the full library surface — request fields, results, error codes, and exit codes — see the [API reference](./api-reference.md).

See also: [Getting started](./getting-started.md) · [CLI](./cli.md) · [PDF](./pdf.md) · [Folders](./folders.md) · [Performance](./performance.md).
