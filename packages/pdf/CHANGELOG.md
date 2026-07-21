# @onadiet/pdf

## 0.1.1

### Patch Changes

- docs: package READMEs now reflect the public npm release (`0.1.0` shipped) — install with `npm i -g onadiet`
  (or `npm i @onadiet/…`), with the honest `0.x`/early framing kept. No code changes; this patch exists to
  refresh the npm package pages, which were published from the pre-release READMEs.
- Updated dependencies
  - @onadiet/core@0.1.1

## 0.1.0

### Minor Changes

- e54da0a: First coordinated public release — align every publishable package to `0.1.0`.

  The accumulated v0.4 changesets already graduate `onadiet` and `@onadiet/core` to a **minor** (`0.1.0`) but
  the adapters only to a **patch** (`0.0.1`). This changeset bumps `@onadiet/pdf`, `@onadiet/image`, and
  `@onadiet/svg` to **minor** as well, so the first release ships as one aligned **`0.1.0`** across the CLI,
  core, and all three adapters — rather than a `0.1.0` / `0.0.1` split. (Decision D1 — the version-strategy
  decision.) No code change.

### Patch Changes

- e54da0a: Cancellation / deadlines (v0.4 P2). `SlimRequest.signal` now accepts an `AbortSignal`: it's checked between
  the expensive per-image encode+SSIM evaluations (and in the PDF apply loop), so a slow or oversized slim can
  be abandoned mid-flight without leaking further work — the slim returns an honest `ABORTED` outcome and never
  leaves a partial write. Essential when the engine runs on a request path. Pass the caller's own signal, or
  `AbortSignal.timeout(ms)` for a deadline. New `throwIfAborted` helper and `ABORTED` error code in
  `@onadiet/core`. The CLI gains `--timeout <ms>`: a single file writes nothing on abort, a folder run stops
  early and marks the unprocessed files `aborted` in the manifest (and `--to-total` refuses rather than report
  a budget verdict on a truncated sweep); either way an aborted run exits `2`.
- e54da0a: Fixed-quality fast path (v0.4 P3). A new opt-in `--fast` / `SlimRequest.fast` encodes each image ONCE at the
  plan's nominal (gentlest) quality and verifies the floor, skipping the SSIM ladder search — the single
  biggest per-call latency win for latency-sensitive callers (a server slimming one file per request), trading
  the deeper savings of the full search. Honesty holds: it still measures its output and keeps the never-bigger
  and quality-floor guarantees (if the nominal encode can't beat the original, the original is kept). Mutually
  exclusive with a byte target (`--to`/`--to-each`/`--to-total`), which is a usage error. The **default**
  no-target slim is unchanged — it keeps the full ladder search, which is what delivers the meaningful shrink.
- Updated dependencies [e54da0a]
- Updated dependencies [e54da0a]
- Updated dependencies [e54da0a]
  - @onadiet/core@0.1.0
