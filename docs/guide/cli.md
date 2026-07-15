# CLI guide

The `diet` command puts your files on a diet — it slims PDFs, images, and whole folders under a size limit, entirely on your machine and safe by default. New to onadiet? Start with the [getting-started guide](./getting-started.md).

## Table of contents

- [The command](#the-command)
- [Simple mode](#simple-mode)
- [Commands](#commands)
- [Diet plans](#diet-plans)
- [Targets](#targets)
- [Options](#options)
- [Exit codes](#exit-codes)
- [Safety](#safety)
- [Examples](#examples)

## The command

The binary is `diet` (with an `onadiet` alias), installed from the `onadiet` package. Every command accepts `--json`, which prints a stable machine-readable object on stdout and keeps logs on stderr — so `diet` drops cleanly into pipelines, CI, and scripts.

## Simple mode

```bash
diet <file|dir> [--to <size>] [--plan <plan>] [--out <dir>]
```

Point `diet` at a file and it slims to a sensible default, writing a sibling `<name>.diet.<ext>` — for example `diet report.pdf` produces `report.diet.pdf`. The original is never touched.

## Commands

The bare `diet <path>` is the hero command; the sub-verbs cover everything around it.

| Command             | On the scale            | What it does                                                                 |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `diet <path>`       | put it on a diet        | Slim a file or a folder (default plan: `balanced`).                          |
| `diet weigh <path>` | step on the scale       | Analyze only — a file's breakdown, or a folder's size overview.              |
| `diet plan <path>`  | the meal plan           | Dry-run — what it _would_ do, with no writes.                                |
| `diet check <path>` | weigh-in                | CI gate: pass/fail a budget (`--max`, `--max-total`) with honest exit codes. |
| `diet checkup`      | is the kitchen stocked? | Environment check — which engines/codecs are available.                      |

## Diet plans

`--plan` picks how hard to squeeze, from lossless to smallest-possible. The default is `balanced`.

```bash
diet report.pdf --plan lowcarb
```

| Plan                   | Quality           | In one line                                                |
| ---------------------- | ----------------- | ---------------------------------------------------------- |
| `cleanse`              | lossless          | Flush the junk only — zero quality loss.                   |
| `balanced` _(default)_ | sensible          | Meaningful slimming, low surprise.                         |
| `lowcarb`              | visually-lossless | Trim what the eye won't miss (held to a perceptual floor). |
| `keto`                 | aggressive        | Cut hard (stronger downsample / format switches).          |
| `crash`                | tiny              | Smallest possible; you accept visible loss.                |

## Targets

Slim toward a goal size with the `--to*` family; the `check` gate uses the `--max*` family. They share one consistent vocabulary — the slim verbs aim for a target, `check` fails a budget.

| Flag                 | Applies to | Means                                                        |
| -------------------- | ---------- | ------------------------------------------------------------ |
| `--to <size>`        | one file   | Slim this file under `<size>` (aliases `--under`, `--goal`). |
| `--to-each <size>`   | a folder   | Cap **every** recognized file at `<size>` (per-file).        |
| `--to-total <size>`  | a folder   | Slim the **whole folder** under `<size>` (uniform quality).  |
| `--max <size>`       | `check`    | Fail if **any** file exceeds `<size>` (no writes).           |
| `--max-total <size>` | `check`    | Fail if the **folder total** exceeds `<size>` (no writes).   |

Sizes accept forms like `5mb`, `500kb`, and `2.5mb`. Using `--to` on a directory (or `--to-each` / `--to-total` on a single file) is a usage error that names the right flag. If a target can't be met above the quality floor, `diet` tells you honestly — for example, "5 MB infeasible without visible loss; floor is 6.2 MB" — rather than returning a garbage result.

For folder-specific behavior, see the [folders guide](./folders.md).

## Options

The slim/analyze verbs share a common set of options. The highlights below cover the everyday flags; for the complete table with arguments and defaults, see the [API reference](./api-reference.md).

**Output and writing**

- `--out <dir>` — write results into `<dir>` instead of a sibling path.
- `--in-place` (with `--backup`) — slim the file in place; `--backup` keeps a `.bak` of the original.
- `--overwrite never|smaller|always` — when an output already exists (default `never`).
- `--keep-tree` — preserve the input folder's structure in the output.

**Selecting files (folders)**

- `--include <globs>` / `--exclude <globs>` — only, or skip, files matching the globs.
- `--copy-unknown` / `--no-copy-unknown` — copy (default) or skip unrecognized files.

**Performance and limits**

- `--concurrency <n>` / `--jobs <n>` — folder parallelism; default `min(cores−1, 8)`, `1` runs sequentially, `auto` is the default.
- `--fast` — a fixed-quality fast path: encode once at the plan's nominal quality and skip the size search. This is the biggest per-call latency win, trading the deeper savings of the full search. It also forgoes the lossless→JPEG recode tier, so a losslessly-stored PDF photo may honestly show no savings. It can't be combined with a byte target.
- `--timeout <ms>` — abort a slim/plan that runs longer than `<ms>`. A single file writes nothing; a folder stops early and marks the unprocessed files `aborted` in the manifest. Either way it exits `2`.
- `--max-input <size>` — skip or refuse any input larger than `<size>`. This is a fail-fast memory guard, checked by `stat` before the file is read: folder mode skips the file with a reason, a single file exits with an error, and `check` ignores it.
- `--min-savings <pct>` — keep the slimmed result only if it saves at least this percentage; otherwise keep the original.

**Output and verbosity**

- `--json` — emit a stable JSON object on stdout (logs stay on stderr).
- `--quiet` / `--verbose` — turn logging down or up.

For tuning throughput on large folders, see the [performance guide](./performance.md).

## Exit codes

`diet` uses honest exit codes so scripts and CI can branch on the result. For the exhaustive breakdown with examples, see the [API reference](./api-reference.md).

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | Success.                                                                    |
| `1`  | Budget or target failed (a `check` gate, or an infeasible target).          |
| `2`  | Processing error (including an aborted `--timeout`).                        |
| `3`  | Invalid usage.                                                              |
| `4`  | Unsafe operation blocked (e.g. would break a signed PDF without `--force`). |

## Safety

`diet` is safe by default:

- **The original is never touched.** Output goes to a sibling `<name>.diet.<ext>` (or your `--out` directory).
- **In-place edits are opt-in.** Use `--in-place`, and add `--backup` to keep a `.bak` of the original.
- **Existing outputs are protected.** `--overwrite` defaults to `never`.
- **Targets are honest.** If a goal size can't be met above the quality floor, `diet` says so instead of returning a degraded file.
- **Signed PDFs are guarded.** An operation that would break a signed PDF is blocked (exit `4`) unless you pass `--force`. See the [PDF guide](./pdf.md).

## Examples

```bash
diet passport.pdf --to 2mb --plan lowcarb        # hit an upload limit, held to a quality floor
diet ./photos --to-each 500kb --out ./slim       # folder: cap every file, structure preserved
diet ./client-files --to-total 25mb --out ./slim # folder: whole tree under a budget (uniform quality)
diet weigh brochure.pdf                          # "184 MB — 92% embedded images, 14 over 300dpi"
diet plan invoice.pdf --to 5mb --json            # what it'd do, machine-readable, no writes
diet check ./public --max 2mb --max-total 25mb   # CI gate
diet report.pdf --in-place --backup              # slim in place, keep a .bak
```
