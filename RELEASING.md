# Releasing onadiet

New versions of the `onadiet` CLI and the `@onadiet/*` packages are published by an **automated, tokenless,
human-gated** pipeline — you never run `npm publish` or `changeset publish` by hand. This is the map to that
pipeline (which lives in [`.github/workflows/release.yml`](.github/workflows/release.yml)).

## Table of contents

- [TL;DR — cutting a release](#tldr--cutting-a-release)
- [What the automation does](#what-the-automation-does)
- [Pre-flight guards](#pre-flight-guards)
- [One-time setup](#one-time-setup)
- [Bootstrapping a new package name](#bootstrapping-a-new-package-name)
- [Verifying a release](#verifying-a-release)
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

[`release.yml`](.github/workflows/release.yml) runs on every push to `main`, in three jobs:

- **`prepare`** (no gate) — checks whether any publishable package's local version is **missing from the npm
  registry** (i.e. the Version PR was just merged), then runs `changeset version` (via `changesets/action`)
  to keep the "Version Packages" PR current, then **verifies the approval gate actually exists**. The
  registry check **fails closed**: a timeout or 5xx aborts the run rather than being read as "not
  published".
- **`publish`** (gated by the **`release` environment** → your manual approval) — runs **only when a publish
  is due**. It upgrades npm to ≥ 11.5.1, builds, and runs `changeset publish`, which uploads each
  not-yet-published package. Authentication is the GitHub **OIDC** token (there is **no `NPM_TOKEN`**), and
  `NPM_CONFIG_PROVENANCE=true` attaches a signed provenance attestation. Before it publishes, it **re-runs the Tier-1 gate** — lint, arch, format, typecheck, test, build, smoke — against the exact commit being
  released, then runs the [pre-flight guards](#pre-flight-guards). Afterwards it **verifies from the registry API** that every
  expected package really resolves at the new version _and_ carries a provenance attestation — a green
  publish step is not proof that anything published.
- **`github-release`** — pushes the git tags and cuts one GitHub Release per published package, with notes
  from that package's `CHANGELOG.md`. It runs **only after `publish` succeeds**, so a Release object can
  never describe a version that never reached npm.

The re-run is not belt-and-braces. The "Version Packages" PR is opened by `changesets/action` using
`GITHUB_TOKEN`, and GitHub does not start workflow runs for events raised by that token — so `ci.yml` does
**not** run automatically on the Version PR. Merging it (the routine thing to do with a bot PR that "just
bumps versions") would otherwise publish a tree that was never gated on a PR at all.

**Two things it does _not_ re-run, deliberately — know them before you approve.** The `integration` job
(the golden corpora, including the 9 MB / 224-image PDF deck) is not repeated here: it takes minutes, in
front of a human already waiting on an approval prompt. Nor does the publish job repeat CI's **Node 22 + 24
matrix** — it builds on the one version in `.nvmrc`. Both _do_ run on the push to `main` that the Version PR
merge creates, but the publish job has no dependency on that run, so it can be approved while integration is
still going or after it has gone red. **Check that `main` is green before approving the deployment** — that
is the part the automation does not do for you.

**Why `github-release` is a separate job.** `changesets/action` injects `GITHUB_TOKEN` into the environment
of the publish script, so every build tool and every transitive dependency lifecycle script in
`pnpm run release` runs with whatever scopes that job holds — at the single highest-privilege moment in this
repo's life. The publish job therefore carries **only `id-token: write`**; `contents: write` lives on this
downstream job, which cannot publish.

Because the gate is on `publish`, and `publish` runs only when a version is ahead of the registry, the
approval prompt appears **only for real releases** — never for an ordinary feature merge.

> **`environment: release` is a name, not a gate.** GitHub's documented behaviour is that running a workflow
> which references an environment that does not exist _creates_ it, and the created environment "will not
> have any protection rules". A missing or reviewer-less environment therefore does not fail the job — it
> silently removes the pause, and neither the workflow file nor this document changes by a character. This
> repo's environment **is** configured; the sibling project `babystack` carried the identical line with zero
> environments configured. So the gate is now _verified_ on every release run and on every PR
> (`scripts/check-release.mjs --environment`), failing closed if the API cannot be reached, rather than
> trusted because it was set up once.

## Pre-flight guards

Everything that can still be _fixed_ is checked before the one step that cannot be undone. npm tarballs are
immutable outside a 72-hour window; every guard below is a read-only probe that costs seconds.

| Guard                     | Refuses when                                                                                  | Why it exists                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Package set**           | the publishable manifests under `packages/` are not exactly the names in `PUBLISHED_PACKAGES` | A glob that comes up short makes every per-package loop below it iterate **zero times and pass**. Naming the packages rather than counting them catches what a count cannot: a rename, or one package removed while another is added. A package present but _unlisted_ is refused because its npm name has almost certainly never been published, so no Trusted Publisher can exist for it and this tokenless pipeline cannot create one. |
| **Unbootstrapped name**   | a publishable package does not exist on the registry at all                                   | A Trusted Publisher is a **per-package** setting that cannot be bound to a name that has never been published. See [Bootstrapping a new package name](#bootstrapping-a-new-package-name).                                                                                                                                                                                                                                                 |
| **Nothing to publish**    | _every_ expected version is already on the registry                                           | `changeset publish` **silently skips** a version already there and exits 0. A re-run would go green having published nothing. (Skipping _some_ packages is normal: Changesets bumps only what changed, so an unchanged package keeps its version and must not be republished. Only "all of them" is the failure.)                                                                                                                         |
| **Still-private package** | a listed package carries `private: true`                                                      | `changeset publish` filters private packages out with **no log line at all** and exits 0, while `changeset version` still bumps them — so the Version PR looks complete and the release ships the rest of the family depending on a package that never went up.                                                                                                                                                                           |
| **Missing release notes** | a package about to publish has no `CHANGELOG.md` section for its version                      | A changelog is a two-line edit; an npm tarball is immutable outside a 72-hour window. Checked _before_ the publish rather than in `github-release`, where it would surface with nothing left to do about it.                                                                                                                                                                                                                              |
| **Approval gate present** | the `release` environment is missing or has no required reviewer                              | See the box above.                                                                                                                                                                                                                                                                                                                                                                                                                        |

**`@onadiet/testkit` is the case worth understanding.** It is a real workspace package that must never
publish — it exists to serve the other packages' tests. The guard does **not** handle that by skipping
private packages, which would make it blind to the accident it exists to catch (a package that went private
by mistake). Instead `testkit` declares itself excluded in **both** places: it is absent from
`PUBLISHED_PACKAGES` _and_ marked `private: true`. The guard checks both directions, so dropping either one
fails the build — including the direction a count-based check cannot see, where `testkit` stops being
private and an unbootstrapped name would be pushed to npm mid-release.

Both registry probes **fail closed**. `npm view` exits non-zero for a missing name _and_ for a 5xx, a rate
limit or a timeout — so the guards classify on the error text and treat **only a clean 404** as "not
published". Anything else refuses rather than guesses.

`scripts/check-release.mjs` keeps `PUBLISHED_PACKAGES` honest: it cross-checks the list against the real
workspace **in both directions** and runs in CI on every PR, so **adding a package fails there** — where the
fix is to bootstrap its name — instead of failing mid-release with half the family already published. Run it
yourself with `pnpm run check:release` (offline) or `node scripts/check-release.mjs --environment`.

**One ordering detail is load-bearing.** The "is a publish due?" check runs _before_ `changesets/action`,
because that action's version mode rewrites every `packages/*/package.json` in the working tree. A check
placed after it reads the **bumped** versions, so an ordinary feature merge that merely adds a changeset
looks like a pending release: the approval prompt fires, and the gate's whole value is that the prompt means
something.

**Why the family is published concurrently, and what that costs.** `changeset publish` publishes up to ten
packages at once rather than in dependency order, so a transient failure on one does not stop the others —
they land immutably while it does not. Cross-package dependencies use `workspace:^` (not `workspace:*`) so
that pnpm publishes a **caret** range: a straggler can then be recovered with a patch bump, which an exact
pin would not admit.

## One-time setup

Already configured for this repo; documented here so the pipeline can be rebuilt or audited. **Every version
on npm today (`0.1.1` and earlier) was published by hand, before this pipeline ever ran — none of them
carries a provenance attestation.** The first release through this pipeline will be the first attested one;
until then, treat "provenance-signed" as a property of the pipeline, not of what is currently on the
registry.

**npm** (per published package — `onadiet`, `@onadiet/core`, `@onadiet/pdf`, `@onadiet/image`,
`@onadiet/svg`):

- Account-level 2FA enabled.
- Publishing access set to **"Require two-factor authentication and disallow tokens"** — bans automation
  tokens, so only interactive-2FA or the OIDC workflow can publish.
- A **Trusted Publisher** bound to repo `on-a-diet/onadiet`, workflow `release.yml`, environment `release`,
  action `npm publish`.

  > **This one is a by-eye checklist item, per package name, and no gate can cover it.** There is no
  > unauthenticated way to read whether a package has a Trusted Publisher bound, so nothing in CI or in
  > `release.yml` can confirm it. The failure is fail-safe rather than silent — OIDC auth is rejected and
  > the publish errors — but `changeset publish` publishes the family concurrently, so a missing binding on
  > one package still leaves the others on the registry, immutably. **Verify all five by hand on npmjs.com
  > before the first pipeline release**, since none of the bindings has ever been exercised.

**GitHub:**

- A **`release` environment** with the maintainer as a **required reviewer** (this is the approval gate),
  deployments restricted to protected branches.
- `main` **branch-protected**: PRs required, force-pushes and deletions blocked.
- Account 2FA — ideally a passkey / hardware key (the account is the root of trust once tokens are gone).

## Bootstrapping a new package name

**Adding a package to `packages/` will fail CI**, deliberately, until you do this — and the same applies to
making `@onadiet/testkit` public. That is the guard working: this pipeline is tokenless, it authenticates
against a **per-package** npm Trusted Publisher, and a Trusted Publisher **cannot be bound to a name that has
never been published**. Because `changeset publish` publishes concurrently, releasing anyway would put the
rest of the family on npm immutably and fail only on the new one.

The order is fixed:

1. **Check the name is actually claimable.** A 404 on the name you want is _not_ proof. npm rejects a new
   name whose **punctuation-stripped** form matches an existing package, so check the stripped twin too:
   `npm view <name>` **and** `npm view <strippedtwin>`. (A scoped `@onadiet/*` name is reserved by the scope
   and not subject to this, but an unscoped name is.)
2. **Publish the name once by hand**, with interactive 2FA, at a prerelease version:
   ```bash
   cd packages/<new>
   npm publish --access public --tag rc      # requires npm >= 11.5.1 and your interactive 2FA
   ```
3. **Bind its Trusted Publisher** on npmjs.com → the package → Settings → Trusted Publisher: GitHub Actions,
   repo `on-a-diet/onadiet`, workflow `release.yml`, environment `release`. Set publishing access to
   **"Require two-factor authentication and disallow tokens"** while you are there.
4. **Add the name to `PUBLISHED_PACKAGES`** in `.github/workflows/release.yml`. CI goes green again, and the
   package releases with the family from then on.

Two traps that cost the sibling projects real time, both of which apply to step 2:

- **`latest` lands on a FIRST publish regardless of `--tag rc`.** npm sets `latest` when a package has no
  tags yet, and there is no undo — `npm dist-tag rm … latest` is refused. Expect it, and correct the tag
  once the first real release claims `latest`.
- **A bootstrap tarball is not installable, by design.** Its intra-workspace dependencies resolve against
  versions the registry does not have yet. That is correct for the one job it does — _exist, so a Trusted
  Publisher has something to bind to_ — and wrong for every other use. Do not link it, document it, or
  suggest anyone install it.

## Verifying a release

A green run is not proof — the pipeline checks this for you (`scripts/verify-published.mjs`), and you can
check it by hand the same way:

```bash
curl -s https://registry.npmjs.org/onadiet | \
  node -p "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); d['dist-tags'].latest"
curl -s https://registry.npmjs.org/onadiet/<version> | \
  node -p "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); JSON.stringify(d.dist.attestations ?? 'NO PROVENANCE')"
```

**Do not verify a fresh publish with `npm view`.** It reads a replica that lags for minutes after a publish,
so it will report the old version — or nothing — for a release that genuinely succeeded, and you will chase
a failure that did not happen. (`npm view` is fine for the _pre-flight_ guards, which run long before
anything is published.)

A release is done when, for every package: the new version is on the registry, `dist.attestations` is
present (this is what provenance looks like from outside), and the GitHub Release exists for the tag.

## Manual / break-glass release

Only if the pipeline is down and a release cannot wait. Requires npm ≥ 11.5.1 and your **interactive npm
2FA** (automation tokens are disallowed by design):

```bash
pnpm install --frozen-lockfile   # never a loose install on the one release nobody is reviewing carefully
pnpm run check                   # the gate the pipeline would have run for you
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
  environment don't match. Fix it on npmjs.com → that package → Trusted Publisher. Nothing _incorrect_ is
  published — but `changeset publish` publishes the family concurrently, so the packages that authenticated
  successfully are already on the registry and cannot be unpublished. Fix the binding and re-run; the
  already-published packages are skipped.
- **"is publishable but is not in PUBLISHED_PACKAGES"** — a package was added, or `@onadiet/testkit` lost its
  `private: true`. Follow [Bootstrapping a new package name](#bootstrapping-a-new-package-name) before adding
  it to the list, or restore `private: true`.
- **"no publishable manifest declares that name"** — a listed package was renamed, moved, or flipped to
  `private: true`. A short family is a partial publish, not a smaller release.
- **"X does not exist on the registry"** — the name was never published, so no Trusted Publisher can exist
  for it. Bootstrap it.
- **"every expected version is already on the registry"** — there is nothing to release. The Version Packages
  PR hasn't been merged, or this is a re-run of a release that already completed.
- **"could not reach the registry to check X"** — a 5xx, a rate limit or a timeout. The guards **fail
  closed** on purpose: a probe that could not answer is never read as "safe to publish". Re-run the job.
- **"has no `release` environment" / "has NO required reviewers"** — the approval gate is gone. Recreate it
  under Settings → Environments before releasing; the workflow will not publish without it.
- **A partial publish (some packages up, some not)** — the publish job goes red, because
  `changeset publish` exits non-zero. The packages that _did_ reach npm are there immutably; the
  `github-release` job still runs for exactly those, so they get their tag and Release rather than being
  left untracked. Fix whatever failed (usually a Trusted Publisher binding) and re-run: the already-published
  packages are skipped. Because cross-package deps are published as **caret** ranges, a straggler can also be
  recovered by a patch bump — an exact pin would not admit that.
- **"published WITHOUT a provenance attestation"** — the publish reached npm but unsigned. Check that the
  `publish` job still has `id-token: write` and ran on a GitHub-hosted runner; a self-hosted runner has no
  OIDC identity to attest to and costs the attestation silently.
- **"release-notes: … has no CHANGELOG.md"** — the version being published was not produced by the Version
  Packages PR, so Changesets never wrote its changelog. Don't hand-bump versions.
