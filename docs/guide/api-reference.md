# onadiet — API reference

> The single evergreen catalog of onadiet's **public surface**: the CLI (commands · options · exit codes),
> the library API (`@onadiet/core` + the format adapters), the config schema, the error codes, and the
> runtime environment. Kept in sync **in the same change** as anything that adds, renames, or removes a
> public export, config field, CLI flag, or error code.

**Status:** on npm (`v0.1.1`) — early (`0.x`); the surface below is what is safe to depend on.
Stability markers below say what's safe to depend on:

- **public** — stable, intended for consumers.
- **advanced** — extension seams/ports; usable, but you're wiring engine internals.
- **planned** — declared but a no-op / deferred in this version; don't depend on it yet.

## Table of contents

- [Packages](#packages)
- [CLI](#cli)
  - [Commands](#commands)
  - [Options](#options)
  - [Exit codes](#exit-codes)
- [Library API](#library-api)
  - [`@onadiet/core`](#onadietcore)
  - [Adapters: `pdf` / `image` / `svg`](#adapters-pdf--image--svg)
  - [`onadiet` — the CLI as a library](#onadiet--the-cli-as-a-library)
- [Error codes](#error-codes)
- [Environment variables](#environment-variables)
- [Behavior caveats](#behavior-caveats)

## Packages

| Package              | Install                            | Role                                                                                                                                                        |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`onadiet`**        | `npm i -g onadiet` · `npx onadiet` | The `diet` CLI (bin: `diet`, alias `onadiet`). **Re-exports the full `@onadiet/core` API**; also exposes a testable `run(argv, ports)` core.                |
| **`@onadiet/core`**  | `npm i @onadiet/core`              | The **pure engine** — no I/O, clock, or randomness. Types, diet plans, typed errors, size math, the seam interfaces, the dual-constraint size search, SSIM. |
| **`@onadiet/pdf`**   | `npm i @onadiet/pdf`               | PDF `FormatAdapter` — re-encodes embedded JPEG images (pdf-lib + sharp/mozjpeg).                                                                            |
| **`@onadiet/image`** | `npm i @onadiet/image`             | Standalone-image `FormatAdapter` — JPEG/PNG/WebP/AVIF re-encode, downscale, optional format switch (sharp/libvips).                                         |
| **`@onadiet/svg`**   | `npm i @onadiet/svg`               | SVG `FormatAdapter` — svgo at plan-derived aggressiveness (vector-only).                                                                                    |
| `@onadiet/testkit`   | —                                  | **Private**, never published — shared seam-conformance suites + fixtures.                                                                                   |

All packages ship dual ESM + CJS with `types`.

## CLI

The binary is **`diet`** (alias `onadiet`). Everything accepts `--json` for a stable machine-readable object.

### Commands

| Command                                           | What it does                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `diet <file>`                                     | Slim a file (the default command) → `<name>.diet.<ext>`.                                             |
| `diet <dir>`                                      | Slim a folder → `<dir>.diet/` (structure preserved).                                                 |
| `diet weigh <file\|dir>`                          | Weigh-in: what it weighs and what's heavy. **No writes.**                                            |
| `diet plan <file\|dir>`                           | Dry-run: the same computation as slim, but **writes nothing**.                                       |
| `diet check <file\|dir> --max/--max-total <size>` | CI byte-budget gate — pass/fail with honest exit codes.                                              |
| `diet checkup`                                    | Which local engines are available. _(Currently a static report — see [caveats](#behavior-caveats).)_ |
| `diet --help`, `-h`                               | Usage.                                                                                               |

> Dry-run is the **`plan`** verb — there is no `--dry-run` flag. There is currently no `--version` flag.

### Options

| Flag(s)                                | Argument                                  | Meaning                                                                                              |
| -------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `--to` / `--under` / `--goal`          | size                                      | Whole-file byte target (single file). On a folder → usage error.                                     |
| `--to-each`                            | size                                      | Folder: per-file byte target.                                                                        |
| `--to-total`                           | size                                      | Folder: whole-tree budget (sweeps for the gentlest plan that fits).                                  |
| `--max`                                | size                                      | `check`: per-file budget.                                                                            |
| `--max-total`                          | size                                      | `check`: whole-tree budget (also a single file's budget).                                            |
| `--plan`                               | `cleanse\|balanced\|lowcarb\|keto\|crash` | Quality plan (default `balanced`).                                                                   |
| `--format`                             | `keep\|auto\|jpeg\|png\|webp\|avif`       | Image output format (default `keep`; ignored for PDFs).                                              |
| `--fast`                               | —                                         | Encode once at the plan's nominal quality; skip the size search. Mutually exclusive with any target. |
| `--max-input`                          | size (>0)                                 | Skip/reject any input larger than this (stat-based, before reading — a memory guard).                |
| `--timeout`                            | ms                                        | Abort a run longer than this (one deadline for the whole run).                                       |
| `--concurrency` / `--jobs`             | n (≥0) or `auto`                          | Folder: max files in parallel (`0`/`auto` → `min(cores−1, 8)`).                                      |
| `--out`                                | dir                                       | Output directory (default: sibling `<name>.diet.<ext>` / `<dir>.diet/`).                             |
| `--force` / `--allow-signed`           | —                                         | Proceed on a signed PDF **and** drop the quality floor (`floor = 0`).                                |
| `--include` / `--exclude`              | comma-glob list                           | Folder: only / skip files matching globs (exclude wins).                                             |
| `--copy-unknown` / `--no-copy-unknown` | —                                         | Folder: copy (default) or skip unrecognized files.                                                   |
| `--json`                               | —                                         | Emit a stable JSON object on stdout.                                                                 |

Size strings accept decimal + binary units (`5mb`, `500kb`, `2.5 MiB`, bare bytes); case-insensitive.

### Exit codes

| Code  | Meaning                  | Examples                                                                                                     |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **0** | Success                  | slim/weigh/plan OK, `check` PASS, folder budget fit.                                                         |
| **1** | Target / gate failed     | `TARGET_INFEASIBLE`; `check` FAIL; folder `--to-total` infeasible or overran.                                |
| **2** | Processing error         | encrypted/unsupported input, aborted/timeout, read/write failure, `--max-input` exceeded.                    |
| **3** | Invalid usage            | bad flags, unknown plan, invalid size, folder given a bare `--to`, `check` with no budget.                   |
| **4** | Unsafe operation blocked | signed PDF (without `--force`), would overwrite the original, `--out` is a symlink or inside the input tree. |

The bin sets `process.exitCode` (never calls `process.exit()`), so piped output is never truncated.

## Library API

### `@onadiet/core`

The pure engine. Import what you need:

```ts
import { resolvePlan, parseSize, OnadietError, type SlimRequest } from '@onadiet/core'
```

#### `SlimRequest` — the config schema · **public**

The request every adapter's `slim()` takes:

| Field            | Type                    | Meaning                                                                                           |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `plan`           | `DietPlan` _(required)_ | The quality/fidelity contract.                                                                    |
| `targetBytes?`   | `number`                | Whole-file byte target; omit to slim as far as the floor allows.                                  |
| `floor?`         | `number`                | Override the plan's SSIM floor (`0..1`); `0` = floorless.                                         |
| `allowSigned?`   | `boolean`               | Proceed on a signed PDF (re-saving invalidates the signature). Default `false` = refuse.          |
| `format?`        | `FormatRequest`         | Image output format (`keep` default \| `auto` \| a specific format). Ignored by the PDF adapter.  |
| `signal?`        | `AbortSignal`           | Cancellation / deadline; on abort returns an `ABORTED` outcome, writes nothing.                   |
| `fast?`          | `boolean`               | Fixed-quality fast path (encode once + verify floor). Ignored when `targetBytes` is set.          |
| `serialFormats?` | `boolean`               | Search candidate formats serially instead of concurrently (folder runner / memory-bound callers). |

#### Results & outcomes · **public**

- **`SlimResult`** — `{ outcome: Outcome; output: Uint8Array | null }`. `output` is non-null **only** when a genuinely smaller file was produced (`null` on failure or kept-original).
- **`Outcome`** = `DietSuccess | DietFailure` (discriminated on `ok`):
  - **`DietSuccess`** — `{ ok: true; inputBytes; outputBytes; plan; method: string; keptOriginal: boolean }`
  - **`DietFailure`** — `{ ok: false; reason: OnadietErrorCode; detail: string }`
- **`Weight`** — `{ bytes: number; causes: WeightCause[] }`; **`WeightCause`** — `{ label: string; bytes: number }`. Result of `weigh()`.

#### Diet plans · **public**

- **`DIET_PLANS`** — `readonly ['cleanse','balanced','lowcarb','keto','crash']`.
- **`DietPlan`** — the plan union type.
- **`DEFAULT_PLAN`** — `'balanced'`.
- **`PLAN_SPECS`** — `Record<DietPlan, PlanSpec>`; **`PlanSpec`** — `{ plan; lossless: boolean; summary: string }`.
- **`resolvePlan(name?: string): PlanSpec`** — case-insensitive resolve + validate; throws `UNKNOWN_PLAN`; defaults to `balanced`.

Plan tuning (the ladders + SSIM floors the search uses):

| Plan       | Quality ladder      | Scale ladder        | SSIM floor                                          |
| ---------- | ------------------- | ------------------- | --------------------------------------------------- |
| `cleanse`  | _(none — lossless)_ | `[1]`               | `1.0` _(planned: lossless re-opt is a no-op today)_ |
| `lowcarb`  | `92, 88, 85`        | `1, 0.85`           | `0.96`                                              |
| `balanced` | `85, 80, 75, 70`    | `1, 0.85, 0.7, 0.5` | `0.90`                                              |
| `keto`     | `80, 70, 60, 50`    | `1, 0.7, 0.5, 0.35` | `0.80`                                              |
| `crash`    | `70, 55, 40, 30`    | `1, 0.6, 0.4, 0.25` | `0` _(floorless)_                                   |

#### Size helpers · **public**

- **`parseSize(input: string): number`** — `"5mb"` / `"2.5 MiB"` / bytes → number of bytes. Throws `INVALID_SIZE`.
- **`formatBytes(bytes: number): string`** — compact human string (`B/KB/MB/GB/TB`, decimal).
- **`savedPercent(inputBytes, outputBytes): number`** — percent saved (one decimal; negative = grew).

#### Seams & ports · **advanced**

The extension interfaces (implement one to add a subject/codec/metric):

- **`FormatAdapter`** — `{ kind: string; detect(bytes): boolean; weigh(bytes): Promise<Weight>; slim(bytes, req: SlimRequest): Promise<SlimResult> }`.
- **`QualityMetric`** — `{ kind; measure(reference: RasterImage, candidate: RasterImage): number }` (`0..1`, deterministic, equal dims).
- **`ImageCodec`** — `{ kind; decode(bytes): Promise<RasterImage>; encode(image, params: EncodeParams): Promise<Uint8Array> }`.
- **`searchSize(images, fixedBytes, ladder, constraints): Promise<SearchResult>`** — the pure dual-constraint convergence loop (hit an optional byte target **and** hold the floor; greedy biggest-saving-first).
- **`ssimMetric: QualityMetric`** — mean SSIM over 8×8 luma blocks (Wang et al. 2004).
- **`throwIfAborted(signal?): void`** — throws a typed `ABORTED` if the signal aborted.

Supporting types (also exported): `RasterImage`, `EncodeParams`, `ImageFormat`, `Candidate`, `ImageLever`, `Ladder`, `SlimConstraints`, `SearchResult`, `ImageDecision`, `SlimOutcomeKind`, plus plan-tuning helpers (`tuningForPlan`, `ladderForPlan`, `provisionalFloor`) and the pure folder helpers (`matchGlob`, `includeExclude`, `isSafeRelativePath`, `outputRelPath`, `aggregateFolder`, `classifyByExtension`, `weighFolder`, `checkFolder`, and their `Folder*` result types).

### Adapters: `pdf` / `image` / `svg`

Each default-exports a `FormatAdapter`; wire it to bytes + a `SlimRequest`.

```ts
import { imageAdapter } from '@onadiet/image'
const result = await imageAdapter.slim(bytes, { plan: 'balanced' })
result.output ? save(result.output) : keepOriginal(result.outcome)
```

- **`@onadiet/pdf`** — `pdfAdapter` (`kind: 'pdf'`); `sharpImageCodec` (JPEG-out codec, **advanced**); `PDF_ADAPTER_KIND`; re-exports `ssimMetric`. Refuses encrypted PDFs; refuses signed unless `allowSigned`. _(Low-level pdf-lib helpers are intentionally not exported.)_
- **`@onadiet/image`** — `imageAdapter` (`kind: 'image'`); `sniffImageFormat(bytes): ImageFormat | null` (**public**); `extensionFor(format): string` (**public**); `sharpImageCodec: MultiCodec`, `resampleRaster`, `buildFormatLevers`, `MultiCodec`, `ImageFormatLever` (**advanced**); `IMAGE_ADAPTER_KIND`.
- **`@onadiet/svg`** — `svgAdapter` (`kind: 'svg'`); `looksLikeSvg(bytes): boolean` (**public**); `configForPlan(plan): Config`, `optimizeSvg(input, plan): string` (**advanced**). Vector-only: no raster, no SSIM, no downscale.

### `onadiet` — the CLI as a library · **advanced**

The flagship also **re-exports the entire [`@onadiet/core`](#onadietcore) API** — so
`import { resolvePlan, parseSize, DIET_PLANS, OnadietError, type SlimRequest } from 'onadiet'` works with no
separate `@onadiet/core` install (the engine is bundled into `onadiet`). For embedding the CLI (e.g. tests):

- **`run(argv: readonly string[], ports: CliPorts): Promise<RunResult>`** — parse + dispatch + write; **always resolves** (never rejects). `RunResult` = `{ code: number; output: string }`.
- **`nodePorts: CliPorts`** — the real Node fs implementation. Inject your own `CliPorts` to run hermetically.
- **`parseArgs(argv): Parsed`** — the pure argv parser; `Parsed`, `Options`, `RunCommand`, `COMMANDS`, `Command`, `HELP` are exported too.

## Error codes

All engine errors are an **`OnadietError`** carrying a typed **`code`** (`OnadietErrorCode`) — branch on `code`, never on message strings. Failures also surface as `DietFailure.reason`.

| Code                | When                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_SIZE`      | Unparseable size string / unknown unit; invalid byte count; bad `floor`/`targetBytes`.                                                                                |
| `UNKNOWN_PLAN`      | Plan name not one of `DIET_PLANS`.                                                                                                                                    |
| `UNSUPPORTED_INPUT` | Not a supported image/PDF/SVG; undecodable bytes; animated/multi-frame image; no candidate format could encode.                                                       |
| `SIGNED_PDF`        | PDF is signed and `allowSigned` isn't set (use `--force` / `allowSigned`).                                                                                            |
| `ENCRYPTED_PDF`     | PDF is encrypted / password-protected.                                                                                                                                |
| `TARGET_INFEASIBLE` | Can't reach `targetBytes` — floor-bound (loosen the floor / use `keto`/`crash`) or structurally impossible; also image `cleanse` + a target (no lossless re-opt yet). |
| `ABORTED`           | The `signal` aborted (cancellation / timeout) mid-slim — nothing written.                                                                                             |
| `NOT_IMPLEMENTED`   | **Reserved** — declared and handled but not thrown by any current path.                                                                                               |

## Environment variables

**None.** No runtime behavior is driven by environment variables. (`.env.example` at the repo root is not read by the code.)

## Behavior caveats

Honest notes about what the engine does and doesn't do today:

1. **`cleanse` is a no-op for PDF and images** — lossless re-optimization (oxipng/jpegtran) isn't wired yet, so image/PDF `cleanse` keeps the original (and returns `TARGET_INFEASIBLE` if given a byte target). **Only SVG `cleanse`** does real (lossless) work. _(planned)_
2. **`checkup` reports a static list**, not a live PATH probe — no engine detection is implemented yet.
3. **Optional copyleft engines (Ghostscript / pngquant) are not wired** — by policy they'd be optional PATH-detected adapters; today `keto`/`crash` use only the in-house sharp/mozjpeg path.
4. **Format switching is image-only** — PDFs always emit JPEG (the only lossy filter valid inside a PDF); the PDF codec ignores `format`.
5. **PDF `slim` only touches "simply slimmable" images** — plain single-filter DCTDecode in DeviceGray/DeviceRGB with no mask/decode remap; anything riskier is left untouched to avoid silent corruption.
6. **`--force` does two things** — proceeds on a signed PDF **and** drops the quality floor to `0`.
7. **Safety invariants (always):** never overwrites the original, never writes a larger file (keeps the original instead), writes atomically (temp + rename), and folder output must live outside the input tree.
