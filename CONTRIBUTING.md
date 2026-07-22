# Contributing to onadiet

Thanks for helping put files on a diet. This repo follows a consistent engineering standard — the short version is below.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Found a security issue? Please
report it privately — see [SECURITY.md](./SECURITY.md), not a public issue.

## Table of contents

- [Setup](#setup)
- [The bar](#the-bar)
- [Layout](#layout)
- [Conventions](#conventions)
- [Releasing](#releasing)

## Setup

Requires Node ≥ 22 (see `.nvmrc`) and `pnpm` (via Corepack).

```bash
pnpm install
pnpm run check   # lint · format:check · typecheck · test · build · smoke
```

## The bar

**A fresh clone passes `install → lint → format:check → typecheck → test → build` (plus the package-import
`smoke`) with no manual setup.** CI runs the same on every push/PR across Node 22 & 24. Nothing merges red.

Individual scripts: `pnpm run lint` · `format` / `format:check` · `typecheck` · `test` · `build` · `smoke`.

## Layout

```
packages/core      @onadiet/core — the pure engine (detect · weigh · plan · slim · verify · report + seams). No I/O.
packages/pdf       @onadiet/pdf — PDF adapter (re-encode embedded images; pdf-lib + sharp/mozjpeg).
packages/image     @onadiet/image — raster adapter (JPEG/PNG/WebP/AVIF; sharp/libvips + optional format switch).
packages/svg       @onadiet/svg — SVG adapter (svgo).
packages/cli       onadiet — the `diet` CLI (thin adapter over core; bin: diet / onadiet).
packages/testkit   @onadiet/testkit — internal, source-only shared test utilities (private, never published).
examples/          runnable patterns (e.g. worker-offload for server hot paths).
scripts/           smoke.cjs — package-import smoke test (both module systems).
docs/              guides, API reference, and the living roadmap.
```

Adapters depend on `@onadiet/core`, never the reverse (enforced by `.dependency-cruiser.cjs`).

## Conventions

- **Pure core.** `@onadiet/core` imports no I/O, no codec SDK, no time/randomness — reach the outside world
  through injected ports. Enforced by ESLint + `.dependency-cruiser.cjs`. Adapters depend on core, never the
  reverse.
- **Tests** under `tests/` mirroring `src/`; no untested behavior; deterministic.
- **Types**: strict; discriminated unions; `readonly`; typed errors (`OnadietError`) over strings.
- **Branch** off `main` (`feature/`/`fix/`/`chore/`); **squash-merge**; delete the branch after. Conventional
  commits; never `--no-verify`; never `Co-Authored-By`.
- **Keep [`docs/ROADMAP.md`](./docs/ROADMAP.md) current** with every meaningful change.

## Releasing

Releases are **automated** — Changesets + npm OIDC trusted publishing, behind a human approval gate. You
don't publish by hand; just add a changeset in your PR (`pnpm changeset`). The full flow (and the one-time
setup) is in [RELEASING.md](./RELEASING.md).
