# Folders & budgets

> Point `diet` at a directory and it slims every file it recognizes — PDFs, images, and SVGs — into a
> mirrored output tree, copying everything else through untouched, with a per-file receipt. Local, safe by
> default, originals never touched. This guide covers folder slimming, the per-file (`--to-each`) and
> whole-folder (`--to-total`) budgets, filtering, parallelism, safety, and the output layout.

## Table of contents

- [At a glance](#at-a-glance)
- [What folder mode does](#what-folder-mode-does)
- [The pipeline](#the-pipeline)
- [Targets & budgets — the flag model](#targets--budgets--the-flag-model)
- [The `--to-total` folder budget (uniform quality)](#the---to-total-folder-budget-uniform-quality)
- [Safety rules](#safety-rules)
- [CLI examples](#cli-examples)
- [Flags & glob semantics](#flags--glob-semantics)
- [The manifest / report](#the-manifest--report)
- [See also](#see-also)

## At a glance

Folder mode walks a directory, dispatches each file to the matching format adapter, and gathers the results
into one receipt. The subfolder structure is preserved and unrecognized files are copied through:

```
                    diet ./client-files --to-each 500kb --out ./slim
                                        │
                ┌───────────────────────┴────────────────────────┐
                │            FOLDER ORCHESTRATOR (CLI)            │
                │   walk → classify → dispatch → write → report   │
                └───────────────────────┬────────────────────────┘
                                        │  (one file at a time)
         ┌───────────────┬──────────────┼───────────────┬──────────────┐
         ▼               ▼              ▼               ▼              ▼
    report.pdf       hero.png       logo.svg       notes.txt     contract.pdf
         │               │              │          (no adapter)   (signed PDF)
   ┌─────▼─────┐   ┌─────▼─────┐  ┌─────▼─────┐        │              │
   │@onadiet/  │   │@onadiet/  │  │@onadiet/  │   copy-through    refuse →
   │   pdf     │   │  image    │  │   svg     │   byte-for-byte   copy as-is
   └─────┬─────┘   └─────┬─────┘  └─────┬─────┘        │              │
         └───────────────┴──────────────┴──────────────┴──────────────┘
                                        │
                                        ▼
                     ./client-files.diet/   (mirrored tree)
                          +  MANIFEST  (human + --json)
```

The single-file case is unchanged — folder mode adds the walk, the folder flags, and the manifest around the
same per-file slimming.

## What folder mode does

Take a directory and produce a slimmed copy: every file the engine recognizes (PDF, JPEG, PNG, WebP, AVIF,
SVG) is slimmed by its adapter, everything else is copied through, the subfolder structure is preserved, and
you get a per-file manifest with honest totals. It runs locally, is safe by default, and never touches your
originals.

- **Per-file plan/target** — apply a plan (`--plan`) or a per-file cap (`--to-each`) to every recognized
  file in the tree.
- **Filtering** — `--include` / `--exclude` globs scope which files are touched.
- **Copy-through** — unrecognized files are copied into the output tree by default, so the output folder is a
  complete, usable mirror.
- **Folder budget** (`--to-total`) — put the whole folder under one byte budget at uniform quality
  (see [below](#the---to-total-folder-budget-uniform-quality)).
- **CI budgets** — `diet check ./dir --max <per-file> --max-total <folder>` gates a pipeline with honest exit
  codes and no writes.

**Not supported (today):**

- **Zip / archive in-out** (`diet archive.zip`) — a separate container concern.
- **In-place folder rewrites** — folder output is always a **new tree**; onadiet never rewrites files in
  place (a folder in-place rewrite is too easy to lose data at scale).
- **Following symlinks** — symlinks are skipped (neither followed nor emitted), never dereferenced. Special
  files (FIFO / device / socket) are skipped too — only regular files are read.
- **Cross-file dedup** (identical images shared across files) and **archive-aware** repacking.

Parallelism is built in: a bounded, user-controllable (`--concurrency` / `--jobs`) worker pool over the
per-file work, producing byte-identical output at any concurrency.

## The pipeline

```
diet ./client-files --to-each 500kb --out ./slim
  │
  ▼
WALK     recurse the input dir (no symlink follow); collect entries. Guard against
         path traversal / loops. Apply --include / --exclude globs.
  │
  ▼
CLASSIFY per entry: which adapter (by content sniff, not extension) — pdf / image / svg —
         or "copy-through" (no adapter) or "skip" (filtered out).
  │
  ▼
SLIM     each recognized file → its adapter's slim (the same per-file pipeline as single-file
         slimming), with the run's plan / --to-each target / floor. Copy-through files: byte-copy.
  │
  ▼
WRITE    mirror the input tree under --out (default `<dir>.diet/`): each slimmed file at its
         relative path (honest extension — a format switch renames), each copy-through byte-copied.
         Atomic per file; never overwrite an input; skip-if-larger keeps the original bytes.
  │
  ▼
REPORT   a per-file manifest + folder totals (human + --json): N slimmed, M copied, K kept,
         input→output bytes, overall %, and any honest per-file outcomes.
```

Folder mode is a fan-out over the per-file adapters, then a gather into a manifest — no cross-file coupling.
Even `--to-total` stays a fan-out: it re-runs this pipeline once per plan and keeps the gentlest that fits
(see below).

Every entry ends up somewhere in the output tree, so the copy is always complete:

```
                      for each entry in the walk
                                 │
                   ┌─────────────▼─────────────┐
                   │ passes --include/--exclude?│──no──► SKIP  (not in output)
                   └─────────────┬─────────────┘
                                 │ yes
                   ┌─────────────▼─────────────┐
                   │  content sniff → adapter?  │──none──► COPY-THROUGH (byte copy)
                   └─────────────┬─────────────┘          (unless --no-copy-unknown)
                                 │ pdf / image / svg
                   ┌─────────────▼─────────────┐
                   │  signed / form PDF, etc.?  │──yes──► REFUSE → copy original
                   └─────────────┬─────────────┘         (noted in manifest; --force overrides)
                                 │ safe
                   ┌─────────────▼─────────────┐
                   │  adapter.slim(plan,target) │
                   └─────────────┬─────────────┘
                                 │
                   ┌─────────────▼─────────────┐
                   │ output smaller than input? │──no──► KEEP original bytes (never bigger)
                   └─────────────┬─────────────┘
                                 │ yes
                                 ▼
                            SLIMMED ✓  → write to mirrored path (honest extension)
```

## Targets & budgets — the flag model

One consistent family of flags:

| Flag                 | Applies to | Means                                                                          |
| -------------------- | ---------- | ------------------------------------------------------------------------------ |
| `--to <size>`        | one file   | slim this file under `<size>` (aliases `--under`, `--goal`). **File-only.**    |
| `--to-each <size>`   | a folder   | slim **every** recognized file under `<size>` (a per-file cap).                |
| `--to-total <size>`  | a folder   | slim so the **whole folder** is under `<size>` (uniform quality — plan-sweep). |
| `--max <size>`       | `check`    | CI gate: fail if **any** file exceeds `<size>` (no writes).                    |
| `--max-total <size>` | `check`    | CI gate: fail if the **folder total** exceeds `<size>` (no writes).            |

`--to` on a directory is a usage error that points at `--to-each` / `--to-total`. `--to-each` / `--to-total`
on a single file is a usage error that points at `--to`. `check` uses `--max*` (a pass/fail budget), never
`--to*` (a slim target) — different verbs, different intent.

## The `--to-total` folder budget (uniform quality)

`diet ./folder --to-total 25mb` treats the folder as **one subject with one quality dial**: find the
**highest quality level that makes the whole folder fit** under the budget, then apply it uniformly. The
quality dial is the **plan** (`cleanse → balanced → lowcarb → keto → crash`), which every adapter already
maps to its own aggressiveness while holding each file's floor. The engine slims the whole tree at each plan
gentlest→aggressive (measuring the total without writing) and applies the **gentlest plan whose whole-folder
total fits** — the highest quality that fits. Already-small/optimized files come back `kept` at gentle plans,
so the compressible files do the work. If even `crash` overflows, it refuses honestly and reports the
smallest achievable (exit 1, like the single-file `TARGET_INFEASIBLE`).

```
  sweep plans gentlest→aggressive; apply the gentlest whose whole-folder total fits
  ─────────────────────────────────────────────────────────────────────────────────
  budget 25MB                        (each pass slims the whole tree, measured, no writes)
    cleanse    Σ = 41MB  ✗
    balanced   Σ = 33MB  ✗
    lowcarb    Σ = 26MB  ✗
    keto       Σ = 22MB  ✓ ── apply keto to every file (small/optimized files stay "kept")
    crash                    (not needed — stop at the first that fits)
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                     ▼
   a plan fits → apply it              even crash > 25MB → HONEST refuse (exit 1):
   (uniform quality; tree ≤ budget)      "25MB infeasible; smallest is 31MB"
```

- **Consistent quality** — every file ends at the same plan (a comparable level), not an arbitrary per-file
  target; already-small/optimized files come back `kept` and the compressible ones do the heavy lifting.
- **Honest infeasibility** — if even `crash` overflows, refuse (exit 1) and report the smallest achievable
  ("25 MB infeasible; smallest is 31 MB"), exactly like the single-file `TARGET_INFEASIBLE`.
- **The written total is re-checked, not assumed.** The fit is decided on the dry-run sweep; the real write
  pass re-walks and re-slims the tree. If the folder changed between planning and writing (a file added/grown)
  or an adapter isn't byte-deterministic, the written total can exceed the budget. That surfaces as an honest
  **`overran`** result (exit 1), never a false "fit".
- **The budget owns the plan** — `--to-total` sweeps the plans itself, so passing `--plan` alongside it is a
  usage error (the flag would otherwise be silently ignored).
- **Cost: measure-then-apply.** The sweep dry-runs up to 5 plans (stopping at the first that fits); a real
  slim then runs the winning plan **once more** to write it (the dry-run discards output bytes rather than
  buffering the whole tree in memory). So the winner is slimmed twice — a bounded-memory trade against a
  second pass; the fan-out parallelizes each pass. `plan` (dry-run) skips the second pass.
- **Never bigger, keep-original per file** — the same guards, per file, still hold.

## Safety rules

Folder mode holds every single-file safety invariant, plus the folder-specific ones:

1. **Never overwrite an original.** Folder output is a **new tree** (`<dir>.diet/` by default, or `--out`);
   onadiet never rewrites files in place (too easy to lose data at scale).
2. **Never write a bigger file** — per file: if no candidate beats the input, the original bytes are copied
   through (`keptOriginal`), never a larger re-encode.
3. **Atomic per file** — temp + rename for each output; a crash mid-run never leaves a half-written file.
4. **No path traversal** — every output path must resolve **inside** the output root; an entry that would
   escape (`..`, absolute, drive letter, NUL, backslash climb) is skipped, never written. Two inputs that
   collide on one output name (e.g. `a.png` + `a.jpeg` → `a.webp`) skip the second rather than clobber the
   first.
5. **The output root itself is guarded.** It must be **outside** the input tree (else the walk re-ingests its
   own output). The check is symlink-proof: a pre-planted symlink at the output root is refused (it would
   redirect writes elsewhere), and a device+inode identity check catches a case-insensitive /
   Unicode-normalized alias of the input that a string compare would miss (`pics` vs `PICS` on macOS).
6. **No symlink following** — symlinks aren't traversed or emitted (loop + escape risk); they're skipped,
   never dereferenced. Special files (FIFO / device / socket) are skipped too — a read would block.
7. **Untrusted input is hostile** — the per-file adapters cap decode resources (pixel caps, etc.); the walk
   bounds depth and total-entry-count (so an all-directory fan-out can't hang) and never follows out of the
   tree. Degradation is per file: an unreadable file/dir, a write failure, or a throwing adapter is recorded
   (skipped/refused) and the run continues — one bad file never aborts the whole tree.
8. **Refuse-or-warn survives per file** — a signed/form PDF inside a folder is still refused (not silently
   rewritten); it's reported in the manifest and copied through untouched unless `--force`.

## CLI examples

```bash
# slim a folder — new tree out, structure preserved, unknowns copied through
diet ./client-files                          # → ./client-files.diet/ (balanced, per file)
diet ./client-files --out ./slim             # choose the output dir
diet ./photos --plan keto                    # a plan, applied per file
diet ./photos --to-each 500kb                # cap every recognized file at 500 KB
diet ./photos --to-each 500kb --include "*.jpg,*.png"   # only these
diet ./public --exclude "**/vendor/**"       # skip a subtree
diet ./client-files --to-total 25mb          # whole folder under 25 MB   (uniform quality)

# analyze / gate — no writes
diet weigh ./folder                          # size overview: by-kind breakdown + heaviest + total
diet check ./public --max 2mb                # CI: fail if ANY file > 2 MB
diet check ./public --max-total 25mb --json  # CI: fail if the folder total > 25 MB
```

`weigh <dir>` is a fast, **stat-only** overview (it never reads file bodies), so its by-kind grouping is by
**extension** — unlike `slim`, which sniffs by content. A misnamed file (a PDF called `notes.txt`, or a PNG
named `asset.dat`) is bucketed by its name here; that's the right, cheap trade-off for a read-only summary,
and `slim` / `plan` still classify it correctly by content. `check` gates every file by real byte size.

## Flags & glob semantics

Folder-relevant flags: `--out <dir>` · `--include <globs>` · `--exclude <globs>` · `--copy-unknown` /
`--no-copy-unknown` (default **on**) · `--plan <plan>` · `--format <fmt>` · `--to-each <size>` (per-file cap)
· `--to-total <size>` (whole-folder budget) · `--concurrency <n>` / `--jobs <n>` (parallelism) ·
`--max-input <size>` · `check --max` / `--max-total`. A bare `--to` on a folder is a **usage error** that
points at `--to-each` / `--to-total` (never silently dropped).

`--max-input` skips a file larger than the given size — a fail-fast memory guard, checked by **stat before the
file is read**, so a hostile huge file never loads. It applies to `slim` / `plan` (which read + decode); the
stat-only `weigh` / `check` never read a body and ignore it.

**Bounded memory.** Folder mode is safe on arbitrarily large trees: at most `--concurrency` files decode at
once, slimmed outputs are **streamed to temp files on disk** as they're produced (the winner is renamed into
place at commit) rather than held in memory, and copy-through originals are re-read serially — so peak memory
stays ~`concurrency`, not proportional to tree size. `--max-input` caps any single file. Everything speaks
`--json`, with the same semantic [exit codes](./api-reference.md#exit-codes) as single-file runs. For more on
tuning parallelism, see the [performance guide](./performance.md).

**Glob semantics** (both `--include` and `--exclude`): a pattern **with** a `/` matches the whole relative
path; a pattern **without** a `/` matches any path **segment**, gitignore-style — so `--exclude node_modules`
drops the entire `node_modules/` subtree, and `--include "*.jpg"` matches a jpg at any depth. `*` = a run
within one segment, `**` = across segments, `?` = one non-`/`; comma-separated lists are supported. Exclude
wins over include.

## The manifest / report

Human (default) — a per-file receipt plus folder totals:

```txt
./client-files → ./client-files.diet/   47 files
  slimmed 31 · copied 12 · kept 3 · refused 1
  report.pdf        8.1 MB → 3.9 MB  (−52%)  balanced
  hero.png          2.4 MB → 41 KB   (−98%)  → hero.diet.webp (auto)
  logo.svg          22 KB  → 7 KB    (−68%)  svgo balanced
  contract.pdf      1.2 MB → 1.2 MB  ✋ signed — copied through untouched
  notes.txt         — copied (not a recognized type)
  ────────────────────────────────────────────────
  total            214 MB → 88 MB   (−59%)   → ./client-files.diet/
```

`--json` emits `{ input, output, files: [{ path, action: 'slimmed'|'copied'|'kept'|'refused'|'skipped',
inputBytes, outputBytes, outputPath?, plan?, method?, reason? }], totals: { files, slimmed, copied, kept,
refused, skipped, inputBytes, outputBytes, savedBytes, savedPercent } }` — a stable schema a build step or
agent can read. `skipped` covers a file that never entered the output (filtered out, unreadable, unsafe output
path, an output-name collision, or `--no-copy-unknown`); its bytes are excluded from the totals. `outputPath`
is the file's path inside the output tree (relative), present whenever something was written. `savedPercent`
is rounded to one decimal, like the single-file receipt.

**`--to-total` adds three keys** to the same object: `budget` (the requested byte budget), `fit` (`true` only
when the written tree is within budget), and `plan` (the chosen plan — present on any outcome that ran a plan,
i.e. `fit` and `overran`; absent on `infeasible`). The three outcomes read as:

- **fit** — `{ ok: true, fit: true, plan, budget, output, files, totals }` (`totals.outputBytes ≤ budget`).
- **infeasible** — `{ ok: false, fit: false, budget, output: null, files, totals }` (even `crash` overflows;
  `totals.outputBytes` is the smallest the sweep reached). Exit 1, nothing written.
- **overran** — `{ ok: false, fit: false, overran: true, plan, budget, output, files, totals }` — the winner
  fit on the dry-run but the _written_ total exceeded the budget (the tree changed between planning and
  writing). Exit 1; the output was written, so `output` names the tree and `totals` reflect what's on disk.

`plan` (dry-run) reports the same shape with `action: 'plan'` and `output: null` (no write, so no `overran`).

## See also

- [Getting started](./getting-started.md) — install and first slim.
- [CLI reference](./cli.md) · [Images](./images.md) · [PDFs](./pdf.md) · [Performance](./performance.md).
- [API reference](./api-reference.md) — the full flag catalog, exit codes, and the importable folder helpers.
- [Project README](../../README.md).
