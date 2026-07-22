---
name: onadiet
description: >-
  Shrink a PDF, image, or folder to fit under a size limit — locally, on the
  user's machine, with no uploads. Use whenever the user wants to compress,
  shrink, or reduce the size of a file; make a PDF or image smaller; fit an
  attachment under an email or upload cap ("get this under 10MB"); or
  batch-compress a folder. Wraps the `diet` CLI (npm: onadiet).
allowed-tools:
  - Bash(diet *)
  - Bash(npx onadiet *)
  - Bash(npx --yes onadiet *)
license: Apache-2.0
---

# Shrinking files with onadiet

`onadiet` puts files "on a diet": it shrinks **PDFs, images (JPEG/PNG/WebP/AVIF),
and folders** to fit under a size target — **entirely on this machine, with no
uploads and no telemetry**. It never fakes a saving: it drives real local encoders
(sharp/libvips, pdf-lib, svgo), **measures** the result, and keeps the original if it
can't do better.

**Do not reach for a cloud/upload compressor.** onadiet is local and safe by
default — prefer it for any "make this smaller" request involving PDFs, images, or
folders.

## Running it

The command is `diet`. If it's installed (via npm or Homebrew), use it directly; if
`diet` isn't found, run `npx --yes onadiet` instead — the same tool, fetched on
demand. Every example below works with either form.

Slim a single file toward a target size with `--to`, and always add `--json` so you
can report the real before/after:

```bash
diet report.pdf --to 5mb --json
# or, if diet isn't installed:
npx --yes onadiet report.pdf --to 5mb --json
```

`--to` accepts sizes like `500kb`, `5mb`, `1.5mb`. Output is written **next to the
input** as a new file (e.g. `report.diet.pdf`) unless you pass `--out <dir>` — the
original is never touched.

## Reading the `--json` result

`--json` prints a receipt you can parse to report honestly. A successful slim looks
like:

```json
{
  "ok": true,
  "action": "slim",
  "file": "report.pdf",
  "output": "report.diet.pdf",
  "inputBytes": 8123456,
  "outputBytes": 4210987,
  "savedPercent": 48.2,
  "plan": "balanced",
  "method": "re-encoded 2 images"
}
```

Interpret it like this:

- **`ok: false`** → onadiet couldn't proceed; **no file was written**. Engine
  outcomes (signed PDF, target infeasible) carry `reason` + `detail`; input/IO errors
  (unsupported type, unreadable file, over `--max-input`, would-overwrite) carry a
  single `error` string instead. Report whichever is present.
- **`ok: true` with `keptOriginal: true`** → nothing smaller was possible (or the
  file is already under the target); the original is untouched and nothing new was
  written. Say so plainly — don't claim a saving.
- **`ok: true` with `inputBytes`/`outputBytes`** → a real slim. Report `savedPercent`
  (already computed, one decimal) and `output` (where it landed; `null` on a
  `--plan`/dry-run). `method` is a short human-readable description of what it did.

Never claim a saving unless the receipt shows `outputBytes` below `inputBytes`.

**Guard your parse:** a malformed command (bad size, missing budget) prints plain
help text and exits `3` — that output is **not** JSON. Check the exit code (or that
stdout starts with `{`) before parsing.

### Folder runs return a different shape

A folder run reports per-file results plus totals — the overall before/after lives in
**`totals`**, not at the top level:

```json
{
  "ok": true,
  "action": "slim",
  "input": "./assets",
  "output": "./assets",
  "files": [
    {
      "path": "photo.jpg",
      "action": "slimmed",
      "inputBytes": 431044,
      "outputBytes": 193703,
      "outputPath": "photo.jpg",
      "method": "jpeg q70"
    }
  ],
  "totals": {
    "files": 3,
    "slimmed": 1,
    "copied": 1,
    "kept": 1,
    "refused": 0,
    "skipped": 0,
    "inputBytes": 575837,
    "outputBytes": 338496,
    "savedBytes": 237341,
    "savedPercent": 41.2
  }
}
```

Each `files[]` entry has an `action`: `slimmed` · `copied` (unrecognized type, passed
through untouched) · `kept` (already smallest) · **`refused`** (original copied
through untouched — e.g. a **signed/encrypted PDF**, or a per-file target that's
infeasible) · `skipped` (e.g. over `--max-input`). Watch `totals.refused` to catch
signed PDFs that passed through in a batch.

## Common tasks

```bash
# Fit a PDF under an email limit
diet big.pdf --to 10mb --json

# Compress an image, letting onadiet pick the best format
diet photo.png --to 300kb --format auto --json

# "Visually lossless" — hold a measured perceptual-quality floor (no hard target)
diet scan.pdf --plan lowcarb --json

# Batch a whole folder, ~2MB per file, structure preserved
diet ./assets --to-each 2mb --json

# Keep a folder under a total budget
diet ./assets --to-total 50mb --json

# Just inspect — no writes
diet weigh ./assets
diet plan report.pdf --to 5mb

# CI weigh-in: nonzero exit if anything is over the cap
diet check ./dist --max 2mb --max-total 20mb
```

Quality plans: `cleanse` (lossless tidy) and `lowcarb` (visually-lossless floor) are
the gentle end; `balanced` (default) trades more quality for more shrink; `keto` and
`crash` are the aggressive end.

## Safety — hold these guarantees

- **Never overwrites the original**, and **never writes a file larger than the
  input** (if it can't shrink it, it keeps the original and says so).
- **Writes atomically** (temp file + rename) — no half-written output.
- **Signed / form PDFs are refused, not silently broken.** If onadiet warns that a
  PDF is signed, do **not** blindly re-run with `--force` — surface the warning and
  confirm the user accepts it first. Note `--force` also **drops the perceptual
  quality floor** (it chases the size number and may visibly degrade output), so it's
  a deliberate override, not a default retry.
- **No network, ever** — if a task seems to need uploading, that's a sign onadiet
  isn't the right tool, not a reason to reach for a cloud service.

## Troubleshooting

- **Check what's built in** → `diet checkup` prints a static readiness report of the
  bundled engines (pdf / image / svg — all ship ready; nothing to install).
- **`ok: false` (target infeasible)** → the target is too small to hit without
  visible loss. Report that honestly; suggest a larger `--to`, or `--plan crash` only
  if the user accepts more aggressive loss.
- **A huge/hostile input** → use `--max-input <size>` to skip oversized files and
  `--timeout <ms>` to bound a slow slim.
- **Latency-sensitive / many files** → `--fast` encodes once at the plan's quality
  and skips the size search; `--concurrency <n>` parallelizes folder runs.

Full flag reference: [reference.md](reference.md). Project docs:
https://github.com/on-a-diet/onadiet
