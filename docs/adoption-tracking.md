# Adoption metrics & telemetry policy

> **The tool never phones home.** onadiet makes **zero network calls** — no usage analytics, no
> telemetry, no "anonymous stats," ever. That is a hard product invariant, not a default you can toggle.
> We learn whether onadiet is useful **only** from public, aggregate signals we look up ourselves —
> never from anything running on your machine.

## Table of contents

- [The rule](#the-rule)
- [What we watch (external signals)](#what-we-watch-external-signals)
- [Vanity vs. real adoption](#vanity-vs-real-adoption)
- [Site analytics](#site-analytics)
- [Cadence](#cadence)
- [Status](#status)

## The rule

**No telemetry in the CLI or the library.** No opt-in "help us improve" ping, no crash reporter, no
version check. The moment onadiet made a network call it would break its core promise — local, no
uploads, safe by default — so it doesn't, and the smoke + architecture tests keep the core I/O-free.
Adoption is measured **from the outside**, by the maintainer, from public data.

## What we watch (external signals)

Public dashboards, checked by hand — nothing embedded in the tool:

- **npm** — download trend and, more meaningfully, **dependents** (packages that install onadiet — the
  strongest npm signal that it's actually used).
- **GitHub** — stars and forks, and (most telling) **issues / PRs opened by people who aren't the
  maintainer**; _Insights → Traffic_ for views, clones, and referrers.
- **Ecosystem indexes** — [deps.dev](https://deps.dev), [libraries.io](https://libraries.io), the Socket
  score, and the npm "dependents" tab.
- **Site** — privacy-respecting traffic on [onadiet.pages.dev](https://onadiet.pages.dev) (see below).

## Vanity vs. real adoption

npm **weekly downloads is near-meaningless at low volume.** It counts every tarball fetch, and for a new
package that's dominated by registry mirrors, security scanners (Socket, Snyk, deps.dev, Dependabot,
libraries.io), and our own publishes/CI — a spike right at publish time is scanners, not humans. Trust
instead: **dependents**, **stars / issues / PRs from strangers**, and traffic that is **sustained between
releases**, not just at a publish.

## Site analytics

For the site, use a **privacy-first, cookieless** option that matches the project's ethos — e.g.
**Cloudflare Web Analytics** (no cookies, no cross-site tracking, no PII collection). Never add a tracker
that profiles visitors: the site honors the same no-surveillance stance as the tool.

## Cadence

Lightweight — a monthly glance at the signals above, not a dashboard obsession. Record any real
inflection (first external contributor, first dependent, a real referral spike) in
[99-ROADMAP.md](./99-ROADMAP.md) so the milestone log reflects traction, not vanity counts.

## Status

- [ ] Enable Cloudflare Web Analytics on `onadiet.pages.dev`.
- [ ] Add an honest downloads/version badge set to the README (real badges only — no inflated claims).
- [ ] First monthly adoption check once there's a full month of post-launch data.
