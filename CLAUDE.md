# CLAUDE.md — onadiet

onadiet is an open-source, local file-optimization tool that "puts your files on a diet": it shrinks
PDFs, images, and folders to fit under a size limit, **on your machine, with no uploads**, safe by
default, with an honest before/after receipt. **Engine built through v0.4** — PDF, image, SVG, and folder
slimming all work (detect · weigh · plan · slim · verify · report), driven end-to-end against real-file golden
corpora, with v0.4 engine-hardening done. **Published to npm + open-source:** all five packages are live at
`0.1.1` (unscoped `onadiet` + `@onadiet/{core,pdf,image,svg}`), the repo is public at `on-a-diet/onadiet`,
and the marketing site is live at [onadiet.pages.dev](https://onadiet.pages.dev). **Remaining distribution:**
a Homebrew tap, a Claude Code Skill, and the hardened publish workflow (OIDC Trusted Publishing +
`--provenance`).

Open-source project in the `on-a-diet` GitHub org; license is **Apache-2.0** (deliberate OSS choice).
Commit under your GitHub **noreply** email — the public history carries no personal address.

- **npm:** the CLI ships **unscoped** as `onadiet` (bin `diet`, `onadiet` alias); the engine + adapters are
  scoped `@onadiet/*` (`@onadiet/core`, `@onadiet/pdf`, …), published under the `@onadiet` org scope.
- **GitHub:** repo lives at `on-a-diet/onadiet` in the `on-a-diet` GitHub org. Human wordmark is
  "on a diet"; every identifier uses `onadiet` (npm treats `on-a-diet` /
  `onadiet` as the same name).

## Principles

Build by these:

- **SOLID** — single responsibility; extend via composition; substitutable implementations; small
  interfaces; depend on abstractions (inject deps).
- **DRY** — one source of truth; derive state, don't duplicate it; reuse before adding.
- **KISS / YAGNI** — the simplest thing that works; build for today's requirement. Over-engineering is a
  failure. (We **architect wide** via interfaces but **launch narrow** — PDF-to-target first.)
- **Fail fast, typed errors** — validate at boundaries; typed errors or `Result` values, never strings.
- **Security by default** — validate untrusted input; least privilege; no secrets in code or logs.
- **Determinism where it matters** — inject `Clock`/`Rng`; keep a **pure core**, lint-enforced.
- **Readable over clever; boy-scout rule** — leave it cleaner; delete dead code/assets.

## Conventions

- **Tests** under `tests/` mirroring `src/` (not co-located); no untested code; deterministic; name tests
  after the spec/invariant id; integration tests under `tests/integration/`.
- **Branching** off `main` (`feature/`/`fix/`/`chore/`); **squash-merge**; **delete the branch (remote +
  local) after merge**; code PRs wait for approval; docs-only may go straight to `main`. Never
  `--no-verify`; never `Co-Authored-By`.
- **Docs** numbered in `docs/` (`00`–`02` product/plan, `03+` specs, `99-ROADMAP`); every doc has a TOC; **keep `docs/99-ROADMAP.md` current after every meaningful change**.
  [`docs/guide/api-reference.md`](docs/guide/api-reference.md) is the canonical public surface —
  **update it in the same change** as any added/renamed/removed export, config field, CLI flag, or error code.
- **Strict typing**; discriminated unions over class hierarchies; `readonly` state; ESM-first with
  default-export interop for CJS deps; pluggable seams behind explicit interfaces, each with a
  **conformance suite** every implementation must pass.

**Project-specific conventions:**

- **Orchestrate & measure, never fake the win.** The engine drives best-in-class local encoders
  (sharp/libvips, qpdf, svgo; oxipng planned) and **verifies** the output; it never reports a saving it didn't
  measure, and it keeps the original if it can't beat it. A "compression" that isn't verified is a bug.
- **Pure core seam.** `@onadiet/core` holds detect · weigh · plan · slim · verify · report + the
  `FormatAdapter` / `QualityMetric` / `SizeSearch` interfaces, and imports **no** codec SDK and no raw I/O.
  Adapters depend on core, never the reverse (enforced by `.dependency-cruiser.cjs`).
- **Permissive core; copyleft engines stay optional.** The shipped core is Apache-2.0 and depends only on
  permissive engines. **Ghostscript (AGPL) and pngquant (GPL) are NEVER bundled** — they are optional,
  PATH-detected, opt-in adapters behind the `keto`/`crash` plans. Prefer the in-house permissive
  extract→downsample→re-embed PDF path.
- **Safe by default — a hard rule.** Never overwrite the original; never write output that's _larger_;
  write to a temp file then atomic-rename; **detect and refuse-or-warn on signed / form PDFs** rather than
  silently breaking them. A single silent corruption of a signed PDF destroys the whole trust pitch.
- **Honest reporting.** "visually-lossless"/`lowcarb` must hold a measured perceptual-quality floor
  (SSIM/butteraugli); report the real delta, the chosen codec/params, and honest "kept original" /
  "target infeasible without visible loss" outcomes.
- **CLI binary is `diet`** (alias `onadiet`), published as the **unscoped** package `onadiet`. Verbs: `diet <file>`, `diet weigh`,
  `diet plan`, `diet check`, `diet checkup`; target via `--to`/`--under`/`--goal`; quality via
  `--plan cleanse|balanced|lowcarb|keto|crash`. Everything supports `--json`.
- **One engine, four surfaces:** CLI · importable library (`@onadiet/core`) · CI (`diet check`) · agent
  **Skill** (wrapping the CLI). MCP is a later thin wrapper, not a v1 differentiator.

## Commands

CI runs exactly these and all must pass (pnpm) — _to be wired in Phase 0_:

- `pnpm run lint` · `pnpm run format:check` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`
- `pnpm run test:integration` — golden-corpus compression tests (real files, measured savings).

A fresh clone must pass `install → lint → format:check → typecheck → test → build` with no manual setup.

## Per-phase / per-task working process

1. **Branch off `main`** (docs-only may go straight to `main`).
2. **Build with tests, not after** — no untested behavior; conformance suites for the seams; a golden
   corpus of real files with measured before/after.
3. **Adversarial review gate — after every phase AND sub-phase.** Spawn parallel subagents across the
   review lenses (correctness/logic end-to-end · bug-hunt · security · scale/perf ·
   code-quality/standards · testing-quality · docs/spec-fidelity · anything-else). Fix real findings in
   the same change or log them with a severity + deferral in `docs/99-ROADMAP.md`.
4. **Commit and push always**; open/update the PR.
5. **Update `docs/99-ROADMAP.md`** — it must never lag reality.

## Project-specific invariants

- **Never overwrite the original; never write a bigger file; write atomically.**
- **Never silently alter a signed/form PDF** — detect and refuse-or-warn.
- **Never bundle a copyleft engine** (Ghostscript/pngquant) — optional PATH adapters only.
- **Never report an unverified saving** — measure the output; hold the quality floor; keep the original if
  you can't beat it honestly.
