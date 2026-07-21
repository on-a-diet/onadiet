# Getting started

`onadiet` puts your files on a diet — it shrinks PDFs, images, and whole folders to fit under a size limit, on your machine, with no uploads, safe by default, and with an honest before/after receipt. This guide takes you from install to the everyday commands.

> **Status:** on npm (`v0.1.0`) — early (`0.x`), the API may still move.

## Table of contents

- [Mental model](#mental-model)
- [Install](#install)
- [The 60-second first run](#the-60-second-first-run)
- [Everyday commands](#everyday-commands)
- [`weigh` — why is this file fat?](#weigh--why-is-this-file-fat)
- [Diet plans (quality)](#diet-plans-quality)
- [Target sizes (goal weight)](#target-sizes-goal-weight)
- [Safety you can see](#safety-you-can-see)
- [Folders](#folders)
- [In code (the library)](#in-code-the-library)
- [In CI](#in-ci)
- [For an AI agent](#for-an-ai-agent)
- [Exit codes](#exit-codes)

## Mental model

Three names, one tool:

- **`diet`** — what you _type_. The command. (Same in every install method.)
- **`onadiet`** — what you _install_ (the unscoped npm package / Homebrew formula).
- **`@onadiet/*`** — the engine + adapters _under the hood_ (`@onadiet/core`, `@onadiet/pdf`, …) — you
  only touch these if you're calling it from code.

## Install

Once published, pick one:

```bash
brew install onadiet        # macOS — installs the `diet` command
npx onadiet report.pdf      # zero-install, one-off run
npm i -g onadiet            # global install; then just `diet …`
```

In code instead of the terminal: `npm i @onadiet/core`.

Install from npm: `npm i -g onadiet` (or `npx onadiet`). To hack on onadiet itself, build from source — see the [root README](../../README.md).

## The 60-second first run

```bash
diet report.pdf --to 5mb
```

```txt
report.pdf   41.2 MB → 4.7 MB   (−88.6%)
  plan:     balanced · downsampled 18 images 300→150dpi, re-encoded JPEG q≈74
  quality:  SSIM 0.981 (floor 0.95)   safety: ✓ no signature/forms
  → wrote report.diet.pdf   (original untouched)
```

It wrote a **new** file (`report.diet.pdf`) and left your original alone. That's the default, always.

## Everyday commands

```bash
diet report.pdf                 # slim to a sensible default (the `balanced` plan)
diet report.pdf --to 5mb        # hit a "goal weight"  (--to / --under / --goal)
diet ./folder --to-total 25mb --out ./slim   # a whole folder under a budget

diet weigh report.pdf           # step on the scale — what's heavy? (no writes)
diet plan  report.pdf --to 5mb  # the diet plan — what it WOULD do (dry-run, no writes)
diet check ./public --max 2mb   # CI weigh-in — pass/fail, honest exit codes
diet checkup                    # is the kitchen stocked? (which engines/codecs are available)
```

For every command and flag, see the [CLI reference](./cli.md).

## `weigh` — why is this file fat?

```bash
diet weigh brochure.pdf
```

```txt
brochure.pdf   184 MB
  92%  embedded images (14 above 300 dpi)
   5%  duplicate font subsets
   3%  metadata + thumbnails
  → try:  diet brochure.pdf --to 20mb
```

`weigh` never writes anything — it just explains the weight and suggests a command.

## Diet plans (quality)

Pick intent, not raw quality flags. `--plan cleanse | balanced | lowcarb | keto | crash`:

```bash
diet passport.pdf --to 2mb --plan lowcarb   # visually-lossless (held to a quality floor)
diet photo.jpg --plan keto                  # aggressive
diet archive.pdf --plan cleanse             # lossless — flush junk only, zero visible change
```

| Plan                   | Means                                |
| ---------------------- | ------------------------------------ |
| `cleanse`              | lossless — junk only                 |
| `balanced` _(default)_ | meaningful slimming, low surprise    |
| `lowcarb`              | visually-lossless (perceptual floor) |
| `keto`                 | aggressive                           |
| `crash`                | tiny — you accept visible loss       |

## Target sizes (goal weight)

```bash
diet report.pdf --to 5mb          # a single file under 5 MB
diet report.pdf --under 5mb       # same thing (alias)
diet ./folder --to-total 25mb     # the whole folder under 25 MB
```

If it can't hit the target above the quality floor, it tells you the truth instead of wrecking the file:

```txt
scan.pdf   ✋ target not met
  5 MB infeasible without visible loss — the floor is 6.2 MB at plan=lowcarb
  → re-run with --plan keto to go smaller (accepts visible loss)
```

## Safety you can see

```bash
diet contract-signed.pdf --to 1mb
```

```txt
contract-signed.pdf   ✋ skipped
  reason: digital signature detected — slimming would invalidate it
  → re-run with --force to override (breaks the signature)
```

Other honest outcomes: _"kept original — already smaller than any candidate we tried"_ (skip-if-larger),
and everything writes to a temp file then atomic-renames, so a crash never leaves a half-written file.
Your originals are never overwritten unless you pass `--in-place` (and even then `--backup` keeps a copy).

## Folders

```bash
diet ./client-files --out ./client-files-slim          # folder in, slimmed folder out (structure kept)
diet ./photos --to-each 500kb --include "*.jpg,*.png"  # cap every matching image
diet ./public --exclude "**/vendor/**"                 # skip a subtree
diet ./client-files --to-total 25mb                    # the whole folder under a budget (uniform quality)
```

Unknown/non-target files are copied through untouched by default (so the output folder is complete), the
subfolder structure is preserved, and your originals are never overwritten (output is a new tree). Full
behaviour: [the folders guide](./folders.md). `--to-each` (per-file cap) is the everyday folder target;
`--to-total` (whole-folder budget) sweeps the diet plans and applies the gentlest one whose whole-folder
total fits — the budget picks the plan, so don't also pass `--plan`.

## In code (the library)

```ts
import { diet, weigh } from '@onadiet/core'

const r = await diet('report.pdf', { to: '5mb', plan: 'lowcarb', out: 'report.small.pdf' })
r.outputBytes // 4_700_000
r.savedPercent // 88.6
r.quality.ssim // 0.981
r.keptOriginal // false

// Buffer in / Buffer out (e.g. slimming an upload before you store it)
const out = await diet(inputBuffer, { inputType: 'application/pdf', to: '5mb' })

// analysis only
const w = await weigh('./folder')
```

The result is a discriminated union — `{ ok: true, … }` or `{ ok: false, reason: 'signed-pdf' | 'target-infeasible' | … }` — so you handle outcomes without try/catch guesswork.

For the full library surface, see the [API reference](./api-reference.md).

## In CI

```bash
diet check ./public --max 2mb --max-total 25mb --json
```

Exit `0` = under budget, `1` = over — so it gates a pipeline. `--json` prints a machine-readable report on
stdout (logs go to stderr), so a build step can read exactly what's over.

## For an AI agent

The same binary is the agent surface (via a Claude Code Skill — no separate server needed):

```txt
1. agent runs:  diet weigh big-deck.pdf --json     → sees the problem (size + causes)
2. agent runs:  diet big-deck.pdf --to 10mb --json → fixes it
3. agent reads the JSON receipt                     → reports the saving, or the honest "infeasible"
```

Deterministic, local, no upload, no account — everything an agent needs.

## Exit codes

`0` success · `1` budget/target failed (`check`) · `2` processing error · `3` invalid usage ·
`4` unsafe operation blocked (e.g. would break a signed PDF without `--force`).
