# onadiet — command reference

Full surface for the `diet` CLI (npm package `onadiet`). The [SKILL.md](SKILL.md)
covers the common path; this is the exhaustive reference.

## Commands

| Command                                                               | What it does                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `diet <file> [--to <size>] [--plan <p>] [--format <f>] [--out <dir>]` | Slim a PDF, image, or SVG.                                |
| `diet <dir> [--to-each <size>] [--to-total <size>] [--plan <p>]`      | Slim a folder; structure preserved, unknown files copied. |
| `diet weigh <file\|dir>`                                              | Report sizes. **No writes.**                              |
| `diet plan <file\|dir> [--to/--to-each <size>]`                       | Dry-run — show what it _would_ do. **No writes.**         |
| `diet check <file\|dir> --max <size> [--max-total <size>]`            | CI weigh-in. Exit `0` if within budget, nonzero if over.  |
| `diet checkup`                                                        | Print a static readiness report of the built-in engines.  |

## Options

| Flag                             | Applies to | Meaning                                                                                                                                                                                |
| -------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--to <size>`                    | file       | Target output size (`500kb`, `5mb`, `1.5mb`).                                                                                                                                          |
| `--to-each <size>`               | folder     | Per-file target.                                                                                                                                                                       |
| `--to-total <size>`              | folder     | Whole-folder budget.                                                                                                                                                                   |
| `--plan <p>`                     | all        | Quality plan: `cleanse` · `balanced` (default) · `lowcarb` (visually-lossless floor) · `keto` · `crash`.                                                                               |
| `--format <f>`                   | images     | `keep` · `auto` (pick best) · `jpeg` · `png` · `webp` · `avif`.                                                                                                                        |
| `--out <dir>`                    | all        | Write output to a directory instead of next to the input.                                                                                                                              |
| `--force`                        | all        | Proceed on a signed/form PDF (**breaks the signature**) **and drop the perceptual-quality floor** (chases the size, may visibly degrade). Deliberate override — confirm with the user. |
| `--json`                         | all        | Machine-readable receipt. Use it to report the real before/after.                                                                                                                      |
| `--include` / `--exclude <glob>` | folder     | Filter which files are considered.                                                                                                                                                     |
| `--no-copy-unknown`              | folder     | Don't copy files onadiet doesn't recognize.                                                                                                                                            |
| `--concurrency <n>`              | folder     | Parallel workers.                                                                                                                                                                      |
| `--max-input <size>`             | all        | Skip inputs larger than this (fail-fast, no read).                                                                                                                                     |
| `--timeout <ms>`                 | all        | Abort a slim that runs longer than this.                                                                                                                                               |
| `--fast`                         | all        | Encode once at the plan's quality; skip the size search (lower latency, no `--to`).                                                                                                    |

## `--json` receipt fields

Single file:

- `ok` — `false` if onadiet couldn't proceed; nothing written. Engine outcomes (signed PDF, target infeasible) include `reason` + `detail`; input/IO errors (unsupported type, unreadable, over `--max-input`, would-overwrite) instead carry a flat `error` string.
- `keptOriginal: true` — couldn't beat the input, or it's already under target; original untouched, nothing written.
- `inputBytes`, `outputBytes`, `savedPercent` — measured before/after (percent already computed, one decimal).
- `output` — where the result was written (`null` on a dry-run / `plan`).
- `plan`, `method` — the quality plan, and a short human-readable description of what it did.
- `action` — `slim` or `plan` (dry-run).

**Folder runs use a different top-level shape:** `{ ok, action, input, output, files[], totals }`. Overall before/after lives in `totals` (`inputBytes` / `outputBytes` / `savedBytes` / `savedPercent`, plus a `files` count and `slimmed` / `copied` / `kept` / `refused` / `skipped` tallies). Each `files[]` entry carries `path`, its `action` — `slimmed` · `copied` · `kept` · **`refused`** (original passed through untouched — e.g. a signed/encrypted PDF or an infeasible per-file target) · `skipped` — plus `inputBytes` / `outputBytes` / `outputPath` (and `method` when slimmed).

Malformed-usage errors are **not** JSON — they print help text and exit `3`. Check the exit code before parsing.

## Safety invariants (always hold)

- Never overwrites the original; never writes a file larger than the input.
- Atomic writes (temp + rename) — no partial output.
- Signed / form PDFs are refused (or warned), not silently re-saved.
- No network calls, no telemetry — everything runs locally.

## Engines

onadiet drives best-in-class **permissive** local encoders — sharp/libvips (images),
pdf-lib + sharp (PDFs), and svgo (SVG). Copyleft engines (Ghostscript/pngquant) are
**never bundled**, and today they're **not wired in** — the shipped path is fully
permissive. `diet checkup` prints a static readiness report of the built-in engines.

## Install (if the skill's `npx` fallback isn't wanted)

```bash
npm install -g onadiet     # or: brew install on-a-diet/tap/onadiet
```

Docs: https://onadiet.pages.dev · Source: https://github.com/on-a-diet/onadiet
