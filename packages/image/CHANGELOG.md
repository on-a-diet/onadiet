# @onadiet/image

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
- e54da0a: Concurrent per-format search (v0.4 perf). Under `--format auto` (and the `keto`/`crash` plans, which force the
  format switch) the image engine searches each candidate format — WebP, AVIF, JPEG/PNG — for its own
  floor-holding minimum. Those searches are independent (each format's lever has its own encode cache; the
  one-time source decode they share is read-only), so they now run **concurrently** instead of serially: AVIF's
  slow search overlaps WebP/JPEG's rather than stacking on top. Measured **~1.6× faster** back-to-back on the
  corpus photo (`keto` 9.0 s → 5.8 s, `--format auto` 13.3 s → 8.5 s), with **byte-for-byte identical** output
  (the golden corpus pins the winners). No API or behavior change — just less waiting on the hot path. Keep-format
  plans
  (`balanced`/`lowcarb`) search a single format and are byte- and memory-identical to before. Tradeoff: peak
  memory rises with the number of formats searched at once (bounded by the format count, multi-format plans
  only).
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
