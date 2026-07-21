# Releasing onadiet

New versions of the `onadiet` CLI and the `@onadiet/*` packages are published by an **automated, tokenless,
human-gated** pipeline — you never run `npm publish` or `changeset publish` by hand. This is the map to that
pipeline (which lives in [`.github/workflows/release.yml`](.github/workflows/release.yml)).

## Table of contents

- [TL;DR — cutting a release](#tldr--cutting-a-release)
- [What the automation does](#what-the-automation-does)
- [One-time setup](#one-time-setup)
- [Manual / break-glass release](#manual--break-glass-release)
- [Troubleshooting](#troubleshooting)

## TL;DR — cutting a release

1. **In your feature PR, add a changeset:** `pnpm changeset` — pick the affected packages, the bump type
   (patch / minor / major), and write a one-line summary. Commit it.
2. **Merge the feature PR.** A bot opens or updates a **"Version Packages"** PR that bumps versions and
   writes changelogs from the accumulated changesets.
3. **Merge the "Version Packages" PR** when you're ready to release. The Release workflow runs and **pauses
   for approval** on the `release` environment.
4. **Approve the deployment** (the run → _Review deployments_ → approve `release`). It publishes every
   bumped package to npm — **tokenless via OIDC, with provenance** — then pushes git tags and opens a
   GitHub Release per package.

No local publish commands. Adding the changeset (step 1) is the only thing you do differently while coding.

## What the automation does

[`release.yml`](.github/workflows/release.yml) runs on every push to `main`, in two jobs:

- **`prepare`** (no gate) — runs `changeset version` (via `changesets/action`) to keep the "Version
  Packages" PR current, then checks whether any public package's local version is **ahead of the npm
  registry** (i.e. the Version PR was just merged). That check decides whether a real publish is due.
- **`publish`** (gated by the **`release` environment** → your manual approval) — runs **only when a publish
  is due**. It upgrades npm to ≥ 11.5.1, builds, and runs `changeset publish`, which uploads each
  not-yet-published package. Authentication is the GitHub **OIDC** token (there is **no `NPM_TOKEN`**), and
  `NPM_CONFIG_PROVENANCE=true` attaches a signed provenance attestation.

Because the gate is on `publish`, and `publish` runs only when a version is ahead of the registry, the
approval prompt appears **only for real releases** — never for an ordinary feature merge.

## One-time setup

Already configured for this repo; documented here so the pipeline can be rebuilt or audited.

**npm** (per published package — `onadiet`, `@onadiet/core`, `@onadiet/pdf`, `@onadiet/image`,
`@onadiet/svg`):

- Account-level 2FA enabled.
- Publishing access set to **"Require two-factor authentication and disallow tokens"** — bans automation
  tokens, so only interactive-2FA or the OIDC workflow can publish.
- A **Trusted Publisher** bound to repo `on-a-diet/onadiet`, workflow `release.yml`, environment `release`,
  action `npm publish`.

**GitHub:**

- A **`release` environment** with the maintainer as a **required reviewer** (this is the approval gate),
  deployments restricted to protected branches.
- `main` **branch-protected**: PRs required, force-pushes and deletions blocked.
- Account 2FA — ideally a passkey / hardware key (the account is the root of trust once tokens are gone).

## Manual / break-glass release

Only if the pipeline is down and a release cannot wait. Requires npm ≥ 11.5.1 and your **interactive npm
2FA** (automation tokens are disallowed by design):

```bash
pnpm install
pnpm run release      # = turbo run build && changeset publish
git push --follow-tags
```

Prefer the automated flow; this path exists so a broken pipeline never blocks a critical fix.

## Troubleshooting

- **No "Version Packages" PR appeared** — no changeset was added in the feature PR. Run `pnpm changeset`.
- **The `publish` job was skipped** — expected: no package version is ahead of the registry, so there was
  nothing to publish.
- **The run is stuck "waiting"** — it's paused on the `release` environment for your approval (_Review
  deployments_).
- **OIDC auth failed for a package** — its npm **Trusted Publisher** isn't set, or the repo / workflow /
  environment don't match. Fix it on npmjs.com → that package → Trusted Publisher. This is fail-safe:
  nothing incorrect gets published.
