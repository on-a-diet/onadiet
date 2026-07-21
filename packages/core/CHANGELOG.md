# @onadiet/core

## 0.1.0

### Minor Changes

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

### Patch Changes

- e54da0a: Bounded memory & fail-fast (v0.4 P1). Folder mode is now memory-safe on arbitrarily large trees: slimmed
  outputs are streamed to temp files on disk as they're produced (the sorted-first winner is renamed into place
  at commit) instead of held in memory, so peak stays ~`--concurrency` regardless of tree size. A new
  `--max-input <size>` flag (folder `maxInputBytes`) skips-with-reason (folder) / fails fast (single file) any
  file larger than the cap, checked by **stat before the file is ever read** — no OOM on a hostile huge file.
  Single-file `check` is now **stat-only** (it no longer reads the whole file just to measure its size), so it's
  memory-safe on any size. The pure-core compiled-glob memo is now bounded (FIFO cap) so it can't grow
  unboundedly on a long-lived server.
