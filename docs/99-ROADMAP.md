# 99 · Roadmap

> The build plan + living status log. **Keep this current after every meaningful change** (handbook rule).

## Table of contents

- [Status](#status)
- [Decisions locked](#decisions-locked)
- [Names, handles & reservations](#names-handles--reservations)
- [Phase 0 — scaffold](#phase-0--scaffold)
- [v0.1 — the PDF wedge](#v01--the-pdf-wedge)
- [v0.2 — images & SVG (table-stakes)](#v02--images--svg-table-stakes)
- [v0.3 — folders & budgets](#v03--folders--budgets)
- [v0.4 — distribution & agent Skill](#v04--distribution--agent-skill)
- [Performance (cross-cutting)](#performance-cross-cutting)
- [Later](#later)
- [Franchise candidates (future scope)](#franchise-candidates-future-scope)
- [Deferred findings log](#deferred-findings-log)

## Status

**Phase 0 complete** — monorepo scaffolded, full gate green (`install → lint → format:check → typecheck →
test → build → smoke`). Planning + branding done; product / vision / CLI / usage / messaging specced
([03-CLI](./guide/cli.md), [98-USAGE](./guide/getting-started.md)); franchise catalogued; original research
preserved. Repo `on-a-diet/onadiet`.

**v0.1 — the PDF wedge, DONE** (see the [PDF guide](./guide/pdf.md)). Steps 1 (pure `@onadiet/core`
seams + dual-constraint SizeSearch) and 2 (`@onadiet/pdf`: capability probe + `detect`/`weigh` + sharp
`ImageCodec` + SSIM `QualityMetric`) **merged**. Step 3 (`slim` end-to-end: SizeSearch → re-encode → replace
image XObjects in place, with signed/encrypted refuse + never-bigger guards) built. Step 4 (the `diet` CLI:
`diet <file> --to`, `weigh`, `plan`, `check`, `checkup`; atomic writes; `--json`; semantic exit codes) built
— `diet report.pdf --to 5mb` works end-to-end. Step 5 (golden corpus + integration tests + plan-floor
validation against measured results) built — a real 9 MB / 224-image deck drives the full pipeline in the
dedicated `test:integration` job; the plan floors were confirmed to bind monotonically and stand as-is. The
step-6 adversarial-review gate ran (4 lenses; findings fixed in-phase) and the measured benchmark table is
published in the README. **v0.1 is done** — the PDF-to-a-target wedge works end-to-end,
safely, with honest receipts. Per decision #9 the npm publish (with provenance) waits for v0.4; package
versions stay `0.0.0`.

**v0.2 — standalone images & SVG, DONE.** Shipped across four PRs: the raster path
`@onadiet/image` (JPEG/PNG/WebP/AVIF, the format-switch lever, content heuristic, SSIM floors) (#18); the
shared conformance testkit `@onadiet/testkit` + ssim→core (#19); the image golden corpus + measured floor
re-tune — the v0.1 floors held and stand (#21); and the SVG vector sub-phase `@onadiet/svg` (svgo, float
precision as the quality knob, lossless `cleanse`) (#22). The CLI routes PDF, images, and SVG; `diet checkup`
lists all three engines. Golden corpora (image + SVG) drive measured before/after in a dedicated
`test:integration` job; per-sub-phase adversarial review with findings fixed in-phase (incl. a caught
silent-corruption bug on non-UTF-8 SVG and a lenient-SSIM measurement corrected to the honest up-direction).
Full gate green across five packages; smoke covers all five under import + require.

**v0.3 — folders & budgets, DONE.** `diet ./folder` slims a directory into a
structure-preserved mirrored tree, copying unknowns through and refusing signed PDFs untouched. Shipped
across five PRs: the folder engine (#24), the performance pillar doc (#25), per-file budgets — `--to-each`,
folder `weigh` / `check --max` / `--max-total` (#26), parallel per-file fan-out — `--concurrency` / `--jobs`,
≈3.6× on a 60-file tree, byte-identical at any concurrency (#27), and the folder golden-corpus integration
suite (#28). One target-flag family (`--to` / `--to-each` / `--to-total`; `check --max` / `--max-total`);
full output-safety guard set; each sub-phase behind its own adversarial-review gate.

**v0.3.1 — `--to-total` (the whole-folder budget), shipped.** The uniform-quality budget realized as a
**plan-sweep**: dry-run the 5 plans gentlest→aggressive and apply the gentlest whose whole-folder total fits,
uniformly; honest refuse (exit 1, smallest achievable) if even `crash` overflows — the pragmatic, faithful
form of the locked "uniform quality" decision (the fine-grained cross-format lever stays a later refinement
if the coarse fit proves too loose). Honesty guards from the review gate: the fit is re-asserted on the
_written_ tree (a TOCTOU change surfaces as an `overran` result, exit 1, never a false "fit"), and an
explicit `--plan` with `--to-total` is a usage error (the budget owns the dial).

## Decisions locked

- **Product:** local, no-upload CLI (`diet`) + library (`@onadiet/core`) that slims files/PDFs/images/
  folders under a size limit, safe by default, with an honest before/after receipt.
- **Wedge:** PDF → a target size, safely (JS has no native PDF size reducer; the pain is real + local).
  Images/SVG are table-stakes.
- **Defensible kernel:** dual-constraint target-size search (byte target ∧ perceptual-quality floor) +
  honest measurement + never-break-a-signed-PDF safety. Not "a new codec," not an "algorithm brain."
- **Stack:** TypeScript; `@onadiet/core` pure + format adapters. Rust/napi-rs only later if a hot path
  demands it.
- **Licensing:** Apache-2.0; permissive engines only. Ghostscript (AGPL) / pngquant (GPL) = optional PATH
  adapters, never bundled.
- **Positioning:** portfolio/credibility flagship + genuinely useful OSS — not a startup (local-only
  removes the billing surface).
- **Vision:** "put your X on a diet" franchise on one shared engine; **launch narrow** (files), architect
  wide. The franchise rungs below are candidates, not commitments.

## Names, handles & reservations

Public-name + handle reservations.

- [x] **npm org scope** `@onadiet` — done (engine + adapters: `@onadiet/core`, `@onadiet/pdf`, …).
      **The CLI ships unscoped as `onadiet`** (bin `diet`).
- [x] **GitHub org** `on-a-diet` — created; home of the project (`on-a-diet/onadiet`).
- [x] **GitHub repo** `on-a-diet/onadiet` — created + pushed.
- [x] **Unscoped npm `onadiet`** — reserved (published `onadiet@0.0.0` placeholder). It will
      **graduate into the real CLI package** (the CLI ships unscoped as `onadiet`, bin `diet`, so
      `npx onadiet` / `npm i -g onadiet` work). _Decided: unscoped CLI over `@onadiet/cli` — better DX._
- [ ] **JSR scope** `@onadiet` — **deferred** (3-scope-at-a-time limit; scoped npm already protects the
      code names; do later).
- [ ] **Domain** (`onadiet.dev` / `.sh`) — **deferred** (costs money; grab right before launch, not now).
- [ ] **crates.io `onadiet`** — only if a Rust core ever happens (low priority).
- [ ] **Homebrew tap** — at distribution (v0.4).

Binary: `diet` (alias `onadiet`). Wordmark: "on a diet". Every identifier: `onadiet`.

## Phase 0 — scaffold

Bring the repo to the engineering baseline (mirror `../cloud-roaring` + `../babystack`). Exit criteria: a
fresh clone passes `install → lint → format:check → typecheck → test → build` with no manual setup, green in CI.

**Done ✓ — a fresh clone passes the full gate.**

- [x] pnpm monorepo (turbo + pnpm catalog): the unscoped `onadiet` CLI package + `@onadiet/core`.
- [x] TS strict (`tsconfig.base.json`); dual ESM+CJS via tsup + **package-import smoke test** (import & require).
- [x] ESLint flat config, **zero-warning**; `.dependency-cruiser.cjs` enforcing the **pure core** (no I/O,
      no adapter imports into core); Prettier + `.editorconfig`; Husky + lint-staged pre-commit.
- [x] Vitest + `tests/` mirroring `src/` — 19 tests (size parsing, plans, error, CLI).
- [x] GitHub Actions CI (lint → format:check → typecheck → test → build → smoke; Node 22 & 24).
- [x] Dependabot **monthly + grouped**; `.env.example`; `.nvmrc`; `engines`; `CONTRIBUTING.md`;
      Commands wired in [CLAUDE.md](../CLAUDE.md).
- [x] _Hardening:_ CI actions **pinned to commit SHAs** (Dependabot github-actions + 30-day cooldown keeps them current).
- [ ] _Deferred hardening:_ add a `@/` path alias if import depth grows; optional TS-7 forward-compat
      `--noEmit` gate (dual-compiler, as in babystack). Golden-corpus harness → v0.1.

## v0.1 — the PDF wedge

The one killer command, done well. Exit criteria: `diet report.pdf --to 5mb` hits the target, holds the
quality floor, never corrupts a signed/form PDF, keeps the original, and prints an honest receipt — proven
on the golden corpus. **Full guide: [PDF](./guide/pdf.md)** (pipeline, seams, safety, size-search,
plan semantics, corpus, build order).

- [x] `@onadiet/core`: detect · weigh · plan · slim · verify · report; the `FormatAdapter` /
      `QualityMetric` / `SizeSearch` seams + conformance suites.
- [x] The **dual-constraint target-size search** (byte target ∧ perceptual floor; degrade quality →
      downscale → format; honest infeasibility).
- [x] `@onadiet/pdf`: **in-house extract→downsample→re-embed** (pdf-lib + sharp) + **signed/form detection
      → refuse-or-warn**. _(A qpdf structural pass is deferred to post-v0.1 — see deferred findings.)_
- [x] Plans `cleanse` / `balanced` / `lowcarb` / `keto` / `crash`; safe output (no overwrite, skip-if-larger,
      atomic write). _(In v0.1 `cleanse` is a lossless no-op — the structural pass that would give it savings
      is deferred.)_
- [x] `diet`, `diet weigh`, `diet plan`, `diet check`, `diet checkup`; `--json`; semantic exit codes.
- [x] Golden corpus + integration tests (real 9 MB deck; measured, floor-validated).
- [x] Publish the corpus benchmark table in the README. _The original "parity-or-better vs
      hand-run Ghostscript" comparison is **deferred to post-v0.1** — Ghostscript is the optional adapter
      below, not part of the permissive v0.1, so a fair parity benchmark waits until it lands._
- [ ] Optional Ghostscript PATH adapter for `keto`/`crash` (never bundled) — post-v0.1.

## v0.2 — images & SVG (table-stakes)

**Design spec: [06-IMAGES](./guide/images.md)** (scope, permissive codec stack, the format-switch lever,
photo/flat heuristic, plan semantics, CLI, corpus, build order). The codec stack (JPEG/PNG/WebP/**AVIF**) is
verified available + permissive in the pinned sharp; the SizeSearch kernel + SSIM metric are reused verbatim.

- [x] `@onadiet/image` (sharp/libvips: JPEG/PNG/WebP/AVIF); content heuristic (photo vs flat) —
      cheap, no ML; **format-switch** lever (WebP/AVIF valid for standalone images). Makes "one tool for your
      files" literally true. _(Raster path merged in #18.)_
- [x] **Shared conformance testkit** — `@onadiet/testkit` (private, source-only) exports the
      `FormatAdapter` / `ImageCodec` / `QualityMetric` conformance suites so `@onadiet/image` proves the same
      contract as `@onadiet/pdf`; SSIM test moved into `@onadiet/core` (self-contained, keeping core a
      dependency leaf); `@onadiet/pdf` re-exports `ssimMetric`. _(Step A — #19.)_
- [x] **Image golden corpus + measured floor re-tune** (build step B — #21) — a license-clean corpus (NASA public-domain "Blue Marble" photo + the author's own graphic + RGBA card) drives the real `slim` pipeline in a dedicated `test:integration` job with measured before/after + up-direction SSIM. The v0.1 floors (0.96 / 0.90 / 0.80) were **re-measured on standalone images and left unchanged** — each plan holds its floor and binds sensibly on the photo (`lowcarb` 0.982 ≥ 0.96, `balanced` 0.944, `keto` 0.814), bytes _and_ quality monotonic across plans. (Confirms the floors are enforced + behave sensibly; not a claim they're provably optimal.) Benchmark in the README + docs/06-IMAGES.
- [x] **SVG** (`@onadiet/svg`, `svgo`) — the vector sub-phase (step C — #22). A separate pipeline (no raster,
      no SSIM, no downscale): plans map to svgo aggressiveness with float precision as the quality knob;
      `cleanse` is genuinely lossless (real cruft removal, unlike the raster no-op). CLI routes `.svg`
      alongside PDF/image. Measured on a golden corpus: `cleanse` 58% → `crash` 78%, monotonic, always valid
      SVG. See [docs/06-IMAGES § SVG](./guide/images.md#svg--the-vector-sub-phase-step-c).

## v0.3 — folders & budgets

**Design spec: [07-FOLDERS](./guide/folders.md)** (scope, pipeline, purity boundary, the flag family, the
uniform-quality `--to-total` design, safety, manifest, corpus, build order). `diet ./folder` fans out over
the shipped per-file adapters (pdf/image/svg) into a structure-preserved output tree. Decisions locked:
`--to-total` realizes the **uniform-quality** budget as a **plan-sweep** (apply the gentlest plan whose
whole-folder total fits; a finer per-file `searchSize` allocation is a later refinement); **staged** so
folders landed before the harder whole-folder budget; canonical target family **`--to` / `--to-each` /
`--to-total`** (+ `check --max` / `--max-total`), superseding all earlier doc spellings.

- [x] **v0.3.0 sub-phase 1 — the folder engine.** Recursive walk (no symlink/special-file follow, bounded
      depth + total-entry count), structure-preserved output tree, copy-through of unknowns, `--plan` /
      `--include` / `--exclude` / `--copy-unknown`, `diet plan <dir>` dry-run, per-file manifest + `--json`.
      Zip-Slip / traversal guards on every write; symlink-proof + `sameFile` output-root guard; output-name
      collision skip; per-file degradation (one bad file/dir never aborts the run). `--to-each` /
      `--to-total` / `--max-total` and folder `weigh` / `check` rejected with a "later v0.3 step" message.
      Pure core helpers (glob/safe-path/output-path/manifest) unit-tested; CLI walk + E2E tested.
- [x] **v0.3.0 sub-phase 2 — per-file budgets + `weigh`/`check`.** `--to-each` caps every recognized file (reuses the adapter's dual-constraint search; an infeasible file is copied through + flagged, `--to-each` on a single file is a usage error). `diet weigh ./dir` = a read-only size overview (by-kind breakdown + heaviest + total; extension-labelled, stat-only, no reads). `diet check ./dir --max` (per file) / `--max-total` (whole tree) = CI gates, exit 1 on any breach. Pure `weighFolder`/`checkFolder`/`classifyByExtension` in core; a `size` port added; the walk shared via `listFiles`.
- [x] **v0.3.0 sub-phase 3 — folder golden corpus.** `packages/cli/tests/integration/folder-corpus.integration.test.ts` builds a mixed tree of REAL files (jpeg/png/svg/pdf + a signed pdf + unknowns + nested/empty dirs) on a real temp filesystem and drives `diet ./dir` end-to-end through the actual CLI + adapters — measured folder totals, structure preserved, unknowns copied byte-for-byte, signed pdf refused + copied intact, originals never mutated, `weigh`/`check` read-only with honest exit codes, and a byte-identical output tree at `--concurrency 1` vs `4`. New CLI `test:integration` task wired into turbo + the CI job.
- [x] **v0.3.1 — `--to-total`** (shipped). The uniform-quality whole-folder budget, realized as a
      **plan-sweep**: dry-run each of the 5 plans over the tree and apply the gentlest whose whole-folder
      total fits the budget, uniformly; honest refuse (exit 1, smallest achievable) if even `crash` overflows.
      The pragmatic, adapter-agnostic form of the locked "uniform quality" decision — no cross-format quality
      proxy needed (SVG has no SSIM). A fine-grained per-file allocation (the `searchSize`-lever form) stays a
      later refinement, only if the coarse fit proves too loose in practice. **Honesty guards** (from the
      review gate): the winner's fit is re-asserted on the _written_ tree, not just the dry-run — a TOCTOU
      change between planning and writing surfaces as an `overran` result (exit 1), never a false "fit"; and
      an explicit `--plan` alongside `--to-total` is a usage error (the budget owns the dial) rather than a
      silent no-op. `--to-total` + `--to-each` is a usage error; `--to-total` on a single file points at `--to`. - _Deferred low (review gate):_ `--to-total` (like `--to-each` / `--to`) is silently ignored on the
      read-only `weigh` / `check` verbs — consistent with how those verbs drop every slim-target flag, but a
      no-op rather than a usage error. Revisit as one guard covering all slim-target flags on `weigh`/`check`.
- [ ] Zip / archive in-out — **deferred to Later** (its own Zip-Slip + decompression-bomb hardening pass).

## v0.4 — distribution & agent Skill

> Two workstreams: **distribution** (npm publish) and **going public** (open-sourcing: repo model, doc
> split, leak-scan gate).

**Release-prep (P6) — done (prepare, not publish).** Metadata is release-ready: **keywords** on the four
scoped packages (`core`/`pdf`/`image`/`svg`, tailored per package), **READMEs** added for `@onadiet/image` +
`@onadiet/svg` (the two that lacked one; `npm pack --dry-run` confirms README + LICENSE ship). Fixed a real
release-blocker found here: the changeset config listed the **private** root `onadiet-monorepo` in `ignore`,
which `changeset status`/`version` **rejects** (private packages are auto-excluded) — removed it, so the
version machinery now runs. `changeset status` confirms the accumulated v0.4 changesets graduate cleanly off
`0.0.0`: **minor** for `onadiet` + `@onadiet/core`, **patch** for the adapters (`@onadiet/testkit` stays
`private`, never published).

- [x] **First-publish versions decided** (distribution): **align every publishable package to `0.1.0`** — one
      coordinated first release, not the `0.1.0`/`0.0.1` skew the raw changesets would produce. Implemented by a
      "first release" changeset bumping the adapters minor before `changeset version`.
- [x] **Release-readiness (standards) pass:** per-package `engines`/`bugs`/`sideEffects`, tsup target →
      node22, CI actions SHA-pinned, README CI badge + build-from-source (#40); the mandated **API reference**
      at [docs/guide/api-reference.md](guide/api-reference.md); `testkit` + `examples` READMEs added.
- [ ] Homebrew formula (`brew install onadiet`) + npm publish (unscoped `onadiet` CLI, bin `diet`; scoped
      `@onadiet/*` engine + adapters) + the publish workflow (OIDC + `--provenance` + `changeset publish`).
- [ ] A Claude Code **Skill** wrapping the CLI (the agent channel; MCP is a later thin wrapper).
- [ ] Docs site + intent pages (compress-pdf-locally, no-upload).

## Performance (cross-cutting)

Performance is a **product pillar** — onadiet is both a local CLI and an embeddable engine meant to run in
**hot paths** (a server slimming an upload, an API compressing a generated PDF, a build crunching an asset
dir). Design of record: **[08-PERFORMANCE](./guide/performance.md)** (two workloads, fan-out design,
concurrency-safety, embedded ergonomics, benchmark-as-a-gate). Measured baseline (v0.3 folder engine): the
orchestration layer is ~free; ~all cost is the per-file SSIM search (≈0.44 s / 700×500 JPEG), and folder mode
runs **sequentially** today — so parallelism is the top bulk lever.

- [x] **v0.3.x — parallel per-file fan-out** (bulk): a bounded worker pool + **user-controllable
      `--concurrency` / `--jobs`** (default `min(cores−1, 8)`; `1` = sequential/repro; `auto` = default). Two
      phases — parallel decide, then a serial sorted commit — so output-name collisions resolve to the
      sorted-first input and the tree is **byte-identical at any concurrency**. Measured ≈3.6× on a 60-file
      tree. Highest-leverage throughput win — **shipped**.
- [x] **v0.4 — bounded memory & fail-fast** (P1, shipped): a per-file size cap (`--max-input` /
      `FolderOptions.maxInputBytes`) that skips-with-reason (folder) / fails fast (single file) by **stat,
      before the file is read**; slimmed folder outputs **streamed to temp files on disk** (rename the
      sorted-first winner at commit) so peak memory stays ~`concurrency` regardless of tree size; the
      compiled-glob memo bounded (FIFO cap). Closes the deferred unbounded-read finding.
- [x] **v0.4 — `test:perf` harness** (P4, shipped): per-package `tests/**/*.perf.test.ts` +
      `vitest.perf.config.ts` + `test:perf` scripts + a (cache-off) `turbo.json` task, measuring wall time +
      peak RSS on the real photo / a temp folder tree vs a committed `baseline.json`. **Local/manual — NOT a
      CI job** (absolute numbers are machine-dependent; a per-PR gate would flake + burn Actions minutes); it
      asserts only robust _relative_ invariants (fast < full, parallel < sequential, byte-identical output)
      and prints the absolutes. README publishes the numbers: latency-by-plan, `--fast` vs full (~9×),
      folder throughput `--concurrency 1` vs default (~2.9×), peak RSS ~flat as the tree doubles.
- [x] **v0.4 — concurrent per-format search** (shipped): the first optimization the perf harness pointed at.
      `--format auto` / `keto` / `crash` searched WebP/AVIF/JPEG **serially**, stacking AVIF's slow search on
      top (the measured 9–20 s hot spot). They're independent (isolated per-format encode caches; the shared
      source decode is read-only), so they now search **concurrently** — ~1.6× back-to-back on the corpus photo
      (`keto` 9.0 s → 5.8 s, `auto` 13.3 s → 8.5 s), **byte-identical** output (golden corpus pins the winners).
      Keep-format plans (`balanced`/`lowcarb`) search one format → unchanged. Tradeoff: peak memory scales with
      concurrent format count (multi-format plans only), so a **folder run searches formats serially per file**
      (`SlimRequest.serialFormats`, set by the folder runner) — the file pool already fills the cores, so P1's
      `~concurrency` memory bound is preserved exactly; the concurrent win is for the standalone/server slim.
- [x] **v0.4 — cancellation** (P2, shipped): `SlimRequest.signal` (an `AbortSignal`) is checked between the
      per-image encode+SSIM evaluations and in the PDF apply loop, so a slow/oversized slim is abandoned
      mid-flight with an honest `ABORTED` outcome and no partial write; folder mode stops starting new files
      once aborted. CLI `--timeout <ms>` (via `AbortSignal.timeout`); `ABORTED` exits 2.
- [x] **v0.4 — fixed-quality fast path** (P3, shipped): opt-in `--fast` / `fast: true` — encode once at the
      plan's nominal quality + verify the floor, skipping the ladder search (the biggest per-call latency win).
      Mutually exclusive with a byte target; the default no-target slim keeps the full search (that's the
      savings). Amends the doc's original "no-target = fast" framing.
- [x] **v0.4 — embedded ergonomics** (P5, shipped): the **worker-offload pattern** so a server runs a slim
      off its event loop without the SSIM search blocking it — [`examples/worker-offload`](../examples/worker-offload)
      is a runnable stateless worker + a minimal self-healing pool (smoke-verified: 3 concurrent slims through a
      2-worker pool). Plus the **concurrency-safety statement** in the `@onadiet/core` + root READMEs (the
      engine holds no cross-call state; a single-file slim shares nothing). A documented pattern, not a bundled
      pool — spawn-per-request is wrong and a real pool belongs to the app (or `piscina`); the engine's
      statelessness makes either trivial (simplicity guardrail).

## Later

Video/audio/Office (plugins), zip archives, MCP server, and — deliberately, only if earned — the
**franchise** rungs below; the shared engine makes these the _same_ machinery.

**Separate research track (not core, not near-term):** a **likely closed-source** "smart PDF optimizer"
that would beat naive encoder use at the same quality and plug into onadiet as an optional **premium
adapter** (open-core) — always emitting standard formats, never a new codec. Kept out of the OSS core.

## Franchise candidates (future scope)

"What else can we put on a diet?" — the brainstorm. Each is the same engine (weigh → plan → slim → verify →
report) over a new adapter. **⭐ = most on-brand + real pain.** Nothing here is committed; it's the menu we
pick from _after_ files wins.

**Dev artifacts**

- ⭐ **`diet docker`** — container images (squash/reorder layers, slim base, drop build-only deps). Big, real pain.
- ⭐ **`diet bundle`** — JS/TS bundles & `node_modules` (tree-shake, dedupe deps, split heavy imports).
- **`diet repo`** — a codebase (dead code, unused deps, large blobs in git history, gc).
- **`diet app`** — mobile/desktop app bundles (`.apk`/`.ipa`/`.app`), WASM binaries.
- **`diet fonts`** — font subsetting; **`diet cache`** — CI/build-artifact caches.

**Data**

- ⭐ **`diet db`** — MySQL/Postgres/SQLite (archive cold rows, drop unused indexes, reclaim space, compress columns).
- **`diet data`** — datasets (CSV/Parquet: downcast dtypes, columnar, dedupe rows).
- **`diet logs`** — log files & retention (compact, roll, structured-log dedupe).
- **`diet backup`** — backups/snapshots (dedupe, incremental, compress); **notebooks** (`.ipynb` strip outputs).

**AI / ML**

- ⭐ **`diet model`** — quantize / prune / distill an ML model to a size or latency budget. _"On a diet" is literally the ML term._
- **`diet tokens`** — LLM context / prompts.
- **`diet embeddings`** — vector stores (dimensionality reduction / quantization).

**Infra / cloud**

- **`diet bucket`** — S3/cloud storage (lifecycle, drop old versions, dedupe, compress objects).
- **`diet disk`** — VM/disk images (sparsify, trim); **k8s/Helm** manifest bloat (niche).

**Consumer (plugin territory)**

- **`diet photos`** — photo library (dedupe, HEIC/AVIF convert); **`diet video`** — media library transcode;
  **`diet mail`** — mailbox (`.mbox`/`.pst`); **`diet downloads`** — the junk-drawer folder.

## Deferred findings log

_(Adversarial-review findings deferred out of a phase land here: severity · location · why · target phase.)_

**Phase 0 review (3 parallel lenses).** Fixed in-phase: the pure-core dependency-cruiser rule was dead
(workspace imports resolved into the excluded `dist/`) → now resolves to `packages/*/src` via a resolver
tsconfig + inverted rule; CLI `@onadiet/core` → devDependencies (it's bundled); per-package `LICENSE`;
`eslint --max-warnings 0`; `prepack` build guards; `savedPercent` validates `outputBytes`; `formatBytes`
promotes on round-up; CLI not-implemented → exit 2 (not 1); smoke `await` fix; bin uses `exitCode`
(no stdout truncation); Dependabot `cooldown`; README/CLAUDE "no code yet" → "scaffold". **Deferred:**

- ~~_minor_ · CI actions on floating tags → pin to commit SHAs~~ **DONE** — pinned (Dependabot actions + 30-day cooldown keeps them current).
- _minor_ · no TS-7 forward-compat `--noEmit` gate (`typescript-next` dual-compiler, as in babystack/cloud-roaring); code is checked on stable TS 6. → v0.1.
- _minor_ · publish provenance (OIDC + `--provenance`) not wired. → v0.4 (first publish).
- _minor_ · `minimumReleaseAge` is a no-op on pnpm 9.x — either bump to pnpm ≥10.16 or rely on the Dependabot cooldown (current choice). → revisit at a pnpm-10 bump.
- _nit_ · pure-core ESLint `process` selector misses destructuring/`globalThis`; add a `@/` path alias if import depth grows; golden-corpus harness → v0.1.

**v0.1 step-1 review (core seams + SizeSearch, 3 parallel lenses).** Fixed in-phase: infeasibility now
distinguishes **`infeasible-floor-hit`** (floor is the binding constraint) from **`infeasible`** (hard —
incompressible / fixed bytes exceed target) so the report never blames the floor falsely; added the locked
`ENCRYPTED_PDF` error code; refreshed the stale core-barrel docstring; fixed a stray "WebP" in the spec's
`crash` row; closed test-coverage gaps (determinism + tie-break, the recode tier + its disable, empty image
set, multi-image plan-only, exact-boundary targets, `.code` assertions on validation). **Deferred:**

- _minor_ · SizeSearch ranks by raw byte saving ("attack the fattest first"), not bytes-saved-÷-quality-lost. Documented in the [PDF guide](./guide/pdf.md#sizesearch--the-dual-constraint-loop); revisit as a quality-weighted refinement once the real metric lands. → v0.1 step 2+ (needs measured quality).
- _minor_ · `ImageCodec` / `QualityMetric` seams are declared but have **no conformance suite** yet (nothing implements them in core). The suite ships with the `@onadiet/pdf` implementations. → v0.1 step 2.
- _nit_ · `EncodeParams` exposes `quality`/`scale`/`recodeToJpeg` only; chroma subsampling is adapter-derived from quality (mozjpeg), not a separate search lever. Revisit only if measurement shows it should be independent. → v0.1 step 2.

**v0.1 step-2 review (@onadiet/pdf: probe + detect/weigh + ImageCodec + SSIM, 3 parallel lenses).** The
capability probe passed (pdf-lib replaces an image XObject in place → measured **375 KB → 43 KB, 88.5% off**,
still-valid PDF). Fixed in-phase: **gray+alpha (2-channel) images were flattened to black** (only RGBA was
handled) → now composited onto white; discovered **pdf-lib 1.17.1's `EncryptedPDFError` is broken** (ES5
`extends Error` yields a plain `Error`, so `instanceof`/name checks never match) → detect encryption via the
reliable `doc.isEncrypted` flag instead; removed the public-barrel leak of low-level pdf-lib helpers
(`findImages`/`imageByteTotal`/`PdfImage`); wrapped sharp decode failures in a typed error; hardened the
`error instanceof Error` narrowing; added `sideEffects:false`; closed test gaps (ENCRYPTED_PDF branch,
generic + non-Error parse failures, image-free weigh, grayscale/RGBA/gray+alpha encode, real grayscale-SSIM
branch, `pdf-images` mirror test, typed-error assertion in the FormatAdapter conformance suite). **Deferred:**

- _minor→must-do-in-step-3_ · Untrusted-input hardening: bound sharp `limitInputPixels` (+ optional per-image timeout) before `slim` decodes untrusted pixels, and add a PDF input-size guard / note that pdf-lib parse isn't decompression-bomb-hardened. Bundle with the step-3 safety work (atomic write, signed/encrypted refuse). weigh only sums byte lengths today (no pixel decode), and the CLI isn't wired yet, so nothing untrusted reaches sharp in step 2. → v0.1 step 3.
- _minor_ · **Partially addressed in step 5, remainder deferred.** The golden corpus now carries a real over-budget deck (the 9 MB SpaceX roadshow); the signed/encrypted paths stay on **synthetic** fixtures (deterministic, and the flag-check + refuse logic is exercised there). Seeding a **real encrypted PDF** for an end-to-end `ENCRYPTED_PDF` test is the only piece not done — a genuine public/license-clean encrypted sample is hard to source, so → **post-v0.1**.
- _nit_ · `weigh` attribution is images-vs-other; fonts + inline images fold into "other". Finer breakdown later. → post-v0.1.
- _nit_ · SSIM ignores remainder pixels beyond the last full 8×8 block (standard non-overlapping SSIM); optimistic for tiny images. Acceptable at our sizes; revisit if it matters. → post-v0.1.
- _nit_ · add `sideEffects:false` to `@onadiet/core` too (already on `@onadiet/pdf`). → housekeeping.

**v0.1 step-3 review (`slim` end-to-end, 3 parallel lenses).** Fixed in-phase — the reviews caught real
silent-corruption bugs: **deleting `/SMask` destroyed soft transparency**, and `/Mask` (color-key),
`/Decode` (inversion), and ICCBased colorspaces would all corrupt on re-encode → `slim` now only touches
**"simply slimmable"** images (single-filter DCTDecode, Device gray/RGB, no SMask/Mask/Decode) and leaves
everything else untouched. Also: **grayscale scans were ballooning to 3-channel RGB** (sharp promotes gray
on `.jpeg()`) → decode/encode now preserve 1-channel gray (big win for scanned docs); **`hasSignature` now
also scans `/FT /Sig` fields** (not just `SigFlags`) so it's fail-safe; `slim` **never throws** (whole body
wrapped → typed `DietFailure`); `save({ updateFieldAppearances: false })` to not disturb unsigned forms;
`encode` got the pixel cap too; +12 tests (floor-binds, grayscale, multi-image, SMask-skip, invalid-request,
receipt method, `levers`/`hasSignature`/`slimmable` coverage). **Deferred:**

- _minor_ · **FlateDecode-photo → JPEG recode** (spec ladder step 3) is not implemented — v0.1 slims **DCTDecode images only**; a lossless-stored photo isn't recoded yet. The recode ladder tier stays dormant for real PDFs. → post-v0.1 (needs zlib-inflate + raw-sample colorspace handling).
- _minor_ · Performance/memory: `buildImageLevers` decodes + retains every slimmable image's raster at once (each capped at 100 MP), and SizeSearch evaluates the **full plan grid** per image (encode+decode+resample+SSIM per candidate) — expensive on large/many images (CI needs a raised test timeout). Bound total pixels / batch the search / coarse-to-fine the grid. → post-v0.1 (fine for typical local use).
- _minor_ · ICCBased / Indexed / CMYK / Separation images are **skipped** (not slimmed) to avoid colorspace shift. Faithful handling (keep ICC profile / convert correctly) would recover that coverage. → post-v0.1.

**Dependency bumps (2026-07, took over Dependabot #2/#3).** Taken (gate green): CI actions →
`checkout@v7` / `pnpm/action-setup@v6` / `setup-node@v6.4.0`; `vite ^7 → ^8` (vitest 4 peers `vite ^8`);
`@types/node ^22 → ^26`. **Held:** `typescript ~6.0 → ~7.0` — typescript-eslint 8.64 peers
`typescript >=4.8.4 <6.1.0`, so TS 7 breaks the type-aware lint stack; take it only with a coordinated
typescript-eslint major bump (its own change). Dependabot will keep re-proposing TS 7 monthly — hold until
then. Skipped the spurious `prettier ^3.9.5 → ^3.9.4` downgrade.

**v0.1 step-4 review (the CLI, 2 parallel lenses).** Fixed in-phase — the review caught a **critical safety
bug**: the never-overwrite-the-original guard compared path _strings_, so a symlinked `--out`, a
case-insensitive filesystem (macOS default!), or Unicode-normalization differences could clobber the
original → now compares real filesystem identity (`dev`+`inode`) via `nodePorts.sameFile`. Also:
`--out` no longer swallows the next flag; `--max-total`/`--to-total` are **rejected** (were silently aliased
to `--max`, which could make a CI gate pass when it should fail); `check` validates `--max` before any I/O;
surplus positionals (usually a mistyped verb) now error; `run()` can never reject (wrapped → typed result);
removed a dead `exists` port; DRY'd the verb list. +tests: real atomic-write + `sameFile` (hardlink),
the pure arg parser, JSON receipts for every verb, and the infeasible→exit-1 / kept-original→exit-0 paths.
**Deferred (documented, not in v0.1):**

- _minor_ · Flags `--in-place` / `--backup` / `--overwrite` / `--min-savings` / `--quiet` / `--verbose` and the glob filters (`--include`/`--exclude`/`--keep-tree`/`--copy-unknown`) from [03-CLI](./guide/cli.md) aren't implemented. Default safe behavior (write `*.diet.pdf`, never touch the original) covers the wedge. → post-v0.1.
- _minor_ · **Folder mode** (`diet <dir>`, `--max-total`/`--to-total`) → **v0.3** (folders & budgets). Rejected with a clear message for now.
- _nit_ · Diagnostics all go to stdout; the spec wants human logs on **stderr**, JSON on stdout. → post-v0.1 (needs a `{code, stdout, stderr}` shape).
- _nit_ · `writeFileAtomic` doesn't `fsync` (post-crash the output could be zero-length; the original is always safe) and doesn't preserve the source's file mode; `--out` doesn't `mkdir -p`. → post-v0.1.

**Dependabot × pnpm catalog (2026-07).** Dependabot has **no pnpm-catalog support** — it rewrites a
`catalog:` ref in package.json into a version, which mismatches the lockfile and fails
`pnpm install --frozen-lockfile` (this was the repeatedly-red npm-all PR). Fixed by **scoping Dependabot off
every catalog-managed tool** (they're bumped by hand in `pnpm-workspace.yaml`); it still auto-updates the
real non-catalog runtime deps (sharp, pdf-lib) and GitHub Actions. **Better long-term:** switch to
**Renovate** (first-class pnpm-catalog support) to re-automate the toolchain — needs the Renovate app
installed. → decision pending.

**sharp forward-compat + deferred 0.35 bump (2026-07).** sharp 0.34 exposed its types via `declare
namespace sharp`, so `sharp.OutputInfo` resolved; 0.35 drops the namespace for named type exports, which
broke a routine Dependabot bump at typecheck. Fixed by inferring the decode types from `toBuffer` instead
of the namespace annotation (version-agnostic; #15). The actual **0.34 → 0.35 runtime bump is deferred to
post-v0.1** (#13 closed) — a libvips/mozjpeg change can shift measured JPEG sizes and would invalidate the
just-calibrated plan floors; take it after the tag, when it'll pass CI cleanly on the forward-compat fix.

**v0.1 step-5 review (golden corpus + integration tests, 4 parallel lenses).** Fixed in-phase — the review
caught real test-quality defects: the **"never mutates input" test was tautological** (it re-read the file
from disk and passed a discarded copy, so it could never fail) → now snapshots the same buffer and compares
after seven real slims; the **infeasible-target test didn't prove the floor bound** (both floor-hit and
structural-miss map to `TARGET_INFEASIBLE`) → now targets balanced's measured floor-binding band and asserts
the receipt names the "quality floor"; the **leave-alone guard was only implied** by an image count → now
asserts every non-slimmable image's stream bytes are byte-for-byte identical while ≥1 slimmable image
changed. Perf: the monotonic test ran 3 full slims and risked the per-test timeout on a 2-core runner (a CI
run took &gt;10 min) → all expensive slims moved to a memoized `beforeAll` (fast tests, generous hook
timeout). Also: **corpus provenance** — the initial "pdf-lib mock" note was wrong (Info dict said pdf-lib
only because the deck was re-saved through it; XMP showed a real Adobe-exported presentation); confirmed the
deck is a **genuinely public** SEC-filed IPO roadshow FWP and rewrote the README accordingly.

- _minor_ · Fast/slow split is keyed off the `*.integration.test.ts` **filename suffix**, not the
  `tests/integration/` directory. A slow test dropped there under a plain `*.test.ts` name would silently
  run in the fast PR gate and be absent from the integration suite. Consider a dir-based split or a lint
  guard. → post-v0.1.
- _minor_ · The `integration` CI job runs on **every** PR (incl. docs-only), ~minutes on a 2-core runner
  cloning the 9 MB fixture. A `paths:` filter would skip it for non-code changes (mind required-check
  interaction). → post-v0.1.
- _nit_ · The 9 MB fixture is permanent git history (`*.pdf binary` set via `.gitattributes`); acceptable
  one-time cost. Trim to a few pages only if it becomes a problem. → watch.
- _nit_ · turbo's `test`/`test:integration` cache key doesn't include the Node version — a cache hit can
  replay a stale local pass across Node switches (CI is cold-cache, unaffected). → housekeeping.
- _nit_ · The `TARGET_INFEASIBLE` receipt's "smallest ~N bytes" over-states the floor by a few percent vs
  what a plan-only `slim` actually delivers (e.g. balanced reported ~5.01 MB but slims to ~4.82 MB). The
  estimate sums real re-encoded image bytes onto the **original** structure size, so it misses the
  structural savings a re-save also yields — pessimistic (never over-promises), but not exact. Report the
  post-save figure, or label it a floor. → post-v0.1.

**v0.2 raster path (`@onadiet/image`) review (4 parallel lenses).** Fixed in-phase — the review caught a
real **honest-reporting bug** (`--force` was wired only to `allowSigned`, so the floorless escape the
`TARGET_INFEASIBLE` receipt advertises did nothing; now `--force` also sets `floor: 0` for both adapters),
a **cleanse over-claim** (image `cleanse` silently did nothing while the docs promised savings → now an
honest lossless no-op with a clear message, docs reconciled), a **double-encode / determinism risk** (the
winner was re-encoded at apply, discarding the bytes the search measured — an AVIF size drift could flip a
feasible run to a false `TARGET_INFEASIBLE`; the lever now caches the encoded bytes and apply reuses them),
**`--format auto` fault-intolerance** (one codec throwing sank the whole run → now per-format, surviving
formats still win), **grayscale bloat** (decode expanded 1-ch gray to 3-ch → now preserved, mirroring the
PDF codec), an **untrusted-decode gap** (`estimateContent` decoded without the pixel cap → capped), a
**redundant PNG encode** (memo key ignored the no-op quality axis → collapsed), and a missing
**`LICENSE`** + AVIF `mif1`/`msf1` sniff. Tests: fixed a **false-confidence floor-hit test** (it passed via
the `infeasible` branch, never exercising the floor-hit message) and added the floor-hit/infeasible split,
cross-format "smallest wins", keto/crash auto-switch, cleanse, never-bigger, and content-estimate coverage.

- _done (#19)_ · ~~**Unify the seam conformance suites** into a shared testkit and run them for
  `@onadiet/image`; move the **SSIM test into `@onadiet/core`**.~~ Shipped as `@onadiet/testkit`
  (private, source-only): the three conformance runners + raster fixtures, run by both `@onadiet/pdf`
  and `@onadiet/image`; core's ssim test is self-contained (inline rasters, so core stays a dependency
  leaf — no `core ↔ testkit` cycle). `@onadiet/pdf` keeps re-exporting `ssimMetric` for API stability and
  to host the `QualityMetric` conformance run. Also fixed a pre-existing DTS-build race (build tsconfig
  now excludes `**/dist`).
- _minor_ · **Real lossless `cleanse`** for images (oxipng / jpegtran / metadata strip) — currently a no-op.
  Pairs with the PDF structural pass. → post-v0.2.
- _minor_ · **`--format auto` perf**: up to ~4 formats × ~16 encodes, serialized, AVIF-dominated, no progress
  output; on a 19 MP source that's tens of seconds. Parallelize the independent per-format searches (mind
  per-raster memory), lower AVIF effort, and print progress. → post-v0.2.
- _minor_ · **Animated-input refusal is untested** (a valid animated WebP/AVIF fixture is fiddly to
  synthesize with sharp) — add a committed binary fixture with the shared testkit. → next v0.2 step.
- _nit_ · The image `infeasible` message reports the floor-holding size, not the floorless minimum (same
  conservative-estimate class as the PDF nit above). `weigh`'s photo-vs-flat estimate isn't consulted by
  `slim` (auto measures all formats + gates on SSIM, which is strictly better) — spec reconciled. → post-v0.2.
- _done (#21)_ · ~~Image **golden-corpus integration** + measured floor re-tune (v0.2 step B).~~ Shipped: a
  license-clean 3-image corpus (photo + graphic + RGBA card) in a dedicated `test:integration` job; floors
  re-measured and stand.
- _done (#22)_ · ~~**SVG** sub-phase (v0.2 step C).~~ Shipped `@onadiet/svg` (svgo) + CLI routing + golden
  corpus. **v0.2 build steps are complete — next is the tag.**

**v0.2 SVG (`@onadiet/svg`) review.** Adversarial pass (correctness+security lens; a manual pass first, then
the subagent lens after a session-limit reset). Fixed in-phase: a **HIGH silent-corruption bug** — `slim`
decoded with a lenient UTF-8 decoder, so a non-UTF-8 SVG (declared ISO-8859-1/Windows-1252 with non-ASCII
bytes) was mangled to U+FFFD and shipped smaller as a false "win"; now decodes **strictly** and refuses with
an honest `UNSUPPORTED_INPUT` (regression test added). Also, earlier, two **detect() gaps** (a valid SVG
behind a >4 KB leading comment was rejected; XHTML embedding `<svg>` was accepted) → `looksLikeSvg` now skips
the prolog and requires `<svg>` as the first element. Verified clean: no XXE / external-DTD fetch / entity
expansion (svgo parses+serializes only), no ReDoS, scripts/handlers preserved by design (size tool, not a
sanitizer — documented). **Deferred (LOW, safe refusals / cosmetic → post-v0.2):** namespaced-root
`<prefix:svg>` and UTF-16-encoded SVGs aren't detected (both refuse safely, no corruption); a DOCTYPE with a
literal `]>` inside a quoted entity value mis-slices the sniff (obscure/malformed); `parseDimensions` drops
the `weigh` dimension label if a `>` sits inside a quoted attr on the `<svg` tag (label-only). `svgo` is
caret-pinned per-package (like `sharp`); the lockfile pins the exact version so CI is deterministic.

**v0.3 sub-phase 1 review (the folder engine, 4 parallel lenses: correctness · security · standards ·
testing).** Fixed in-phase — the reviews caught **two HIGH bugs**: (1) `formatFolder` recomputed savings
with the _throwing_ core `savedPercent`, so an **empty / all-filtered / `.gitkeep`-only folder crashed**
(exit 2, "inputBytes must be a positive number") instead of a clean 0-files report → now reuses the 0-safe
`totals.savedPercent` the manifest already carries (and `aggregateFolder` rounds it to one decimal, matching
the single-file receipt); (2) **`diet .` / `diet ./` was rejected** (code 4) — the default output `"..diet"`
resolved inside the input → the default is now the resolved sibling `${resolve(dir)}.diet`. Security/robustness
hardening (all fixed): a **symlinked output root is refused** (a pre-planted `evil.diet → /elsewhere` would
redirect writes out of the tree) and the output-vs-input guard now also uses `sameFile` (dev+inode) to catch
a **case-insensitive / Unicode alias** (`pics` vs `PICS` on macOS) a string compare misses; the walk now
**enqueues regular files only** (a FIFO/device read would block forever), **counts every entry** (files + dirs)
against `MAX_ENTRIES` so an all-directory fan-out can't hang, and **catches `readDir` per directory** so one
unreadable subdir doesn't abort the run; **output-name collisions** (`a.png` + `a.jpeg` → `a.webp`) skip the
second rather than clobber; `isSafeRelativePath` also rejects **backslash climbs / UNC**; a `--to` byte target
on a folder is now a **usage error** (not silently dropped); refuse reasons are humanized; and `matchGlob`
now matches a slash-free pattern against **any path segment** (gitignore-style) so `--exclude node_modules`
drops the whole subtree (was a no-op footgun) — with a memoized compiled-glob cache on the walk hot path.
Tests: a new `packages/cli/tests/folder.test.ts` unit-tests the orchestrator's safety branches (symlink /
special-file skip, unreadable file/dir, write failure, throwing decide, collision, deterministic order,
dry-run); +core cases (segment match, backslash reject, no-ext/multi-dot, negative/all-skipped aggregation);
+E2E (empty folder, `--include`, bare-name exclude, format-switch rename, `--to`-on-dir, symlink/alias output
refusal). **Deferred (none block the engine):**

- ~~_[MEDIUM]_ · **Unbounded whole-file reads** — every file (incl. copy-through unknowns) is buffered in
  memory, so a single huge file can OOM. Cross-cutting (single-file mode too, and pdf-lib/sharp already
  buffer): add a per-file size cap (skip-with-reason via `stat().size`) and stream copy-through.~~ **RESOLVED
  v0.4 (P1):** `--max-input` size cap (stat before read), slimmed folder outputs streamed to disk, single-file
  `check` is now stat-only. Default is still uncapped — protection is opt-in via `--max-input`.
- _[LOW]_ · **Nested symlink inside an explicit `--out` tree** — the output-root symlink guard covers the
  root; a symlink **within** a user-supplied `--out` subtree could still redirect a write. Harden with a
  per-write realpath containment check (or `O_NOFOLLOW`). → v0.3.x.
- _[LOW]_ · **TOCTOU on input read** — the walk lstat-skips symlinks, but a file could be swapped for a
  symlink between enumeration and `readFile` (needs a local attacker racing the run). Open inputs
  `O_NOFOLLOW`. → post-v0.3.
- _[LOW]_ · **Silent bound truncation** — hitting `MAX_DEPTH` (64) / `MAX_ENTRIES` (100k) stops the walk with
  no manifest marker; add a `truncated` flag so a partial mirror isn't reported as complete. Matters most for
  `check`: a truncated walk could false-PASS a gate on a huge tree, so `check` should treat truncation as
  non-clean (warn / fail-closed) once the flag exists. → v0.3.x.
- _[LOW]_ · **Skipped symlinks/special files aren't recorded** in the manifest (kept quiet like a
  `.gitignore` match); optionally surface them for a fully honest receipt. → post-v0.3.
- _[nit]_ · `FolderFileEntry` / `FileDecision` are flat optional-heavy interfaces, not discriminated unions
  keyed on `action`; defensible as serialized manifest rows, revisit if the fallbacks proliferate. → watch.

**v0.4 fast path (P3) review (3 parallel lenses: correctness/honesty · perf/edge · testing/docs).** All three
confirmed the two honesty invariants hold under `--fast` (the nominal `grid[0]` is provably the gentlest point;
the floor is still filtered, never bypassed; never-bigger is double-guarded) and that fast is strictly
work-reducing. Fixed in-phase — the review's headline was **vacuous end-to-end test coverage**: the image fast
test's `fastLen >= fullLen` passed on equality, so a silently-dropped `fast` flag in the adapter/CLI plumbing
would have shipped green → now asserts the observable `method` is exactly `jpeg q85` (the nominal point a no-op
can't produce) and the full search is strictly smaller. Also: the core "nominal point" test didn't assert the
**quality** dimension (a future ascending-ladder edit would silently pick the most aggressive point) → now
asserts `Math.max(...quality)`; added the missing **floor-fail-under-fast keeps-original**, **recode-tier-skip**
(a discriminating fast-vs-full pair), and **fast-ignored-when-a-target-is-set** core tests; the non-fast contrast
now asserts the full 32-point grid, not `> 1`; a **stale `08-PERFORMANCE.md` summary line** still framed the fast
path as "skip the search when there's no target _(next)_" (contradicting the shipped opt-in) → reworded; and the
recode-tier limitation (fast forgoes the lossless→JPEG recode, so a Flate-stored PDF photo may honestly show no
savings) is now documented in the CLI + perf specs. Hardening: the budget sweep's `requestFor` now strips `fast`
so a future guard change can't corrupt the "which plan fits" verdict (LOW-2 defense-in-depth).

- _[minor]_ · **Single-file `--out <dir>` to a _missing_ directory fails** (`cannot write …`, exit 2) instead of
  creating it, whereas folder mode mkdirs its output root. Pre-existing (not P3), surfaced during the fast-path
  e2e. A user running `diet photo.jpg --out ./slim` expects `./slim` created. Mkdir the parent in the single-file
  write path (mirror folder mode). → v0.4.x.
- _[resolved in-PR]_ · ~~**Bound per-file format concurrency inside a folder run.**~~ The concurrent
  per-format search multiplies a single slim's peak memory by the format count; in a folder that would further
  multiply the file-level pool (`--concurrency` × formats) and defeat P1's OOM bound on `--plan keto|crash` /
  `--format auto`. **Fixed before merge** (review-gate HIGH): `SlimRequest.serialFormats` — the folder runner
  searches each file's formats serially (the file pool already fills the cores), so peak memory stays one
  raster per in-flight file exactly as before; the concurrent win is kept for the standalone/server slim.
