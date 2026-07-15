# Performance

onadiet is built to stay fast in two very different settings: a CLI slimming a large folder, and an embedded library sitting on a server's hot path. This guide covers how it stays fast in both, the measured numbers behind those claims, and the knobs for tuning throughput, memory, and latency.

## Table of contents

- [Two workloads](#two-workloads)
- [Where the time actually goes](#where-the-time-actually-goes)
- [Folder throughput: parallel per-file fan-out](#folder-throughput-parallel-per-file-fan-out)
- [Hot-path / embedded: a lean, concurrency-safe per-call path](#hot-path--embedded-a-lean-concurrency-safe-per-call-path)
- [Benchmarking with `test:perf`](#benchmarking-with-testperf)
- [Guardrails](#guardrails)

The guiding rule: **keep it simple, and never hurt the hot path** — push cost off the hot path or into the docs, never bury it in a clever hot loop. Measure before optimizing, then optimize the thing the measurement blames.

## Two workloads

The engine serves two performance profiles, and they optimize differently:

|              | **A · Bulk / batch**                                   | **B · Hot-path / embedded**                                                     |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Shape        | `diet ./folder`, CI gates, pre-processing an asset dir | the library inside a server, one slim per request                               |
| Bound by     | **throughput** (total wall time over N files)          | **latency + concurrency-safety** (p99 of one call, under load)                  |
| The win      | parallelism across files; don't redo work              | a lean per-call path; keep CPU off the event loop; bounded memory; cancellation |
| Who tunes it | the user (`--concurrency`)                             | the caller (options + how they schedule it)                                     |

Both ride the **same per-file adapters**: folder mode adds an orchestration layer around them, and embedded use adds lean entry points — the engine itself is never forked.

## Where the time actually goes

Measured on the folder engine with the `balanced` plan (numbers are from a development machine and are machine-dependent):

- **The folder orchestration layer is ~free** — walk, glob matching, output-path mapping, and manifest
  aggregation are milliseconds even on a 60-file tree. It is _not_ the bottleneck.
- **~All the cost is per-file adapter work** — dominated by the image path's SSIM-guided dual-constraint
  search (multiple encode → decode → SSIM evaluations per image). ≈ **0.44 s per 700×500 JPEG**; a 60-JPEG /
  11 MB tree took ≈ **26.6 s**.
- **Folder mode fans out across files.** On an 11-core machine a 60-JPEG / 11 MB tree went
  **23.0 s → 6.4 s (≈3.6×)** at the default concurrency, with byte-identical output.

This points to two levers: **parallelism across files** for bulk throughput, and an opt-in **fast path**
(`--fast`) for latency-sensitive embedded callers. `--fast` is opt-in, **not** the default — the search is
where the savings come from, so a default no-target slim keeps it.

## Folder throughput: parallel per-file fan-out

Each file is independent — its own bytes in, its own bytes out — so the fan-out is embarrassingly parallel. A
folder run happens in two phases: **decide** (read + slim, the expensive step) through a bounded pool, then
**commit** (collision-resolve + write) serially in sorted order.

- **Bounded worker pool** over the walked file list, at most _N_ decodes in flight — so `--concurrency`
  bounds the memory-heavy part: simultaneous raster decodes (each capped at 100 MP). Copy-through originals
  are **not** buffered — they're re-read from the input at commit time (a serial step, so at most one is
  resident). Slimmed (already-compressed) outputs are also not held until commit: each is **streamed to a
  temp file in its destination directory** as it's produced and renamed into place at commit (on an
  output-name collision the sorted-first input still wins), so peak memory stays ~`N` regardless of how large
  the tree is. A file whose staging fails is skipped-with-reason rather than buffered, so the bound holds
  unconditionally.
- **User-controllable concurrency** — `--concurrency N` (alias `--jobs N`). Default = **`min(cores − 1, 8)`**:
  it scales with the machine, leaves a core free, and caps at 8 so an uncapped default on a many-core box
  can't OOM on simultaneous decodes; raise it explicitly when you have the RAM. `--concurrency 1` forces
  sequential (deterministic repro, low-resource boxes); `auto`/`0` selects the default. The library's
  folder-run API takes the same `concurrency` option; the CLI flag just maps to it.
- **Determinism is preserved — including collisions.** The manifest stays **sorted by input path** and byte
  totals are order-independent, so any concurrency yields a byte-identical manifest and output tree. The one
  real hazard — two inputs mapping to one output (`a.png` + `a.jpeg` → `a.webp`) — is settled in the **serial
  commit phase, in sorted input order**, so the **sorted-first** input always wins regardless of which decode
  finished first. (Verified by a test that diffs the full result at `--concurrency 1` vs `8`.)
- **Failure isolation stays per file** — a worker that throws records a `refused`/`skipped` entry without
  draining the pool or aborting the run.

See the [folders guide](./folders.md) for the full folder-mode reference.

## Hot-path / embedded: a lean, concurrency-safe per-call path

When the engine is a dependency inside a server, the unit of work is **one file per request**, many requests
at once. The bar is different: low, predictable latency and safety under concurrency.

- **A fixed-quality fast path (opt-in `--fast` / `fast: true`).** The SSIM search walks the whole degrade
  ladder to squeeze out the deepest floor-holding savings — which is what makes the **default** no-target
  slim (`diet photo.jpg`) actually shrink meaningfully, so it stays on. A latency-sensitive caller can
  instead opt into `fast`: **encode once at the plan's nominal (gentlest) quality and verify the floor**,
  skipping the ladder — the single biggest per-call latency win (one encode + SSIM vs the full grid), at the
  cost of the deeper savings. One concrete consequence: the nominal point never reaches the lossless→JPEG
  **recode tier** (it sits deep in the ladder), so a losslessly-stored (FlateDecode) PDF photo can honestly
  report _no_ savings under `--fast` where the full search would recode it — the trade-off is real, not just
  smaller numbers. Honesty holds: `fast` still measures its output and keeps the never-bigger + floor
  guarantees (if the nominal encode can't beat the original, the original is kept). Mutually exclusive with a
  byte target (hitting a size needs the search).
- **Concurrent per-format search.** Under `--format auto` (and `keto`/`crash`, which force the format switch)
  the engine searches each candidate format — WebP, AVIF, JPEG/PNG — for its own floor-holding minimum, then
  keeps the smallest. Those searches are **independent** (each lever has its own encode cache; the one-time
  source decode they share is read-only), so they run **concurrently** rather than serially: AVIF's slow
  search overlaps WebP/JPEG's instead of stacking on top of it. Measured **~1.6×** back-to-back on the corpus
  photo (`keto` 9.0 s → 5.8 s, `--format auto` 13.3 s → 8.5 s), **byte-for-byte identical** output. The
  tradeoff is peak memory: it rises with the number of formats searched at once (each holds an encode/decode
  pipeline over the shared decode), so it's bounded by the format count (≤ ~4) and touches **only**
  multi-format plans — a keep-format plan (`balanced`/`lowcarb`) searches one format and is byte- and
  memory-identical to before. A **folder run searches each file's formats serially**
  (`SlimRequest.serialFormats`, set by the folder runner): the file pool already fills the cores, so parallel
  formats there would only multiply in-flight raster pipelines and defeat the pool's `~concurrency` memory
  bound — so peak memory stays exactly one raster per in-flight file. The concurrent win is for the
  standalone slim (CLI single file, or a server slimming one file per request) that has no outer pool; a
  memory-constrained embedder can opt into `serialFormats` too. Native concurrency stays capped by libuv's
  threadpool.
- **Keep CPU off the event loop.** sharp already does encode/decode on the libuv threadpool, but the search
  orchestration + SSIM bookkeeping is JS on the main thread. A slim is a pure `(bytes, request) → SlimResult`
  call, so it moves cleanly onto a **worker thread** to keep a server's event loop free —
  [`examples/worker-offload`](../../examples/worker-offload) is a runnable worker plus a minimal self-healing
  pool. onadiet ships the pattern, not a bespoke pool: spawning a worker per request is wrong, and a real
  pool belongs to the app (or a library like `piscina`) — the engine's statelessness makes either trivial.
- **Bounded memory + fail-fast.** A **max-input-size** cap (`--max-input`) makes a hostile/huge file fail
  fast — rejected by **stat, before it's ever read** — instead of OOM-ing the process. The cap applies
  exactly where a file is read into memory: single-file `slim`/`plan`/`weigh` (exit with an honest error) and
  folder `slim`/`plan` (skip-with-reason). The **stat-only** paths — all `check` (single + folder) and folder
  `weigh` — never read a body, so they're already memory-safe and ignore the cap. The default is uncapped;
  protection is opt-in. Embedded callers that hold their own `Uint8Array` should size-check before reading.
- **Cancellation / deadlines.** `SlimRequest.signal` accepts an `AbortSignal`; it's checked between the
  expensive encode + SSIM evaluations (and in the PDF apply loop), so a slow or oversized file is abandoned
  mid-slim without leaking further work — the slim returns an honest `ABORTED` outcome and never leaves a
  partial write. Pass the caller's own signal, or `AbortSignal.timeout(ms)` for a deadline; the CLI exposes
  `--timeout <ms>`.
- **Concurrency-safe by construction.** The engine is callable from many concurrent requests with no
  cross-call state: the only module-level mutable state in the pure core is the **compiled-glob memo**
  (`compileGlob`) — a read-mostly, deterministic cache keyed by pattern, safe to share and **bounded** (a
  FIFO cap) so even a request path that fed it distinct patterns can't grow it unboundedly. A single-file
  slim touches none of it. This guarantee is also stated in the library README (`@onadiet/core`).

For the request/result types (`SlimRequest`, `SlimResult`, `signal`, `fast`, `serialFormats`, …) see the
[API reference](./api-reference.md).

## Benchmarking with `test:perf`

Performance rots silently unless it's measured — so measure before optimizing, then optimize the thing the
measurement blames. onadiet ships a `test:perf` harness: per-package `tests/**/*.perf.test.ts` files, a
`vitest.perf.config.ts`, and a `test:perf` package script (mirrored into `turbo.json` and the root script).
It measures wall time + peak RSS on the existing corpora (the real photo; a temp-filesystem folder tree),
prints a table, and diffs the **wall time** against a committed `baseline.json`. (Peak RSS is reported
inline, not baselined — it's process-wide and sticky, so it's a coarse gross-regression signal, not a
precise metric.)

- **Local/manual — deliberately not a CI job.** Absolute numbers are machine-dependent, so a per-PR gate
  would flake and burn CI minutes for no signal. The harness asserts only robust _relative_ invariants
  (fast < full search; parallel < sequential where cores allow; output still byte-identical) and prints the
  absolutes; run it before a perf-sensitive change to _notice_ a 2× slowdown locally.
- **Published numbers.** Representative measured numbers (see the [README](../../README.md)): per-file
  latency by plan (including the ~1.6× concurrent-format-search win on `keto`/`crash`/`auto`); the **`--fast`
  vs full-search win (~9×** on the corpus photo — 0.24 s vs 2.2 s); folder throughput at `--concurrency 1` vs
  the default (**~2.9×**); and peak process RSS staying **~flat as the tree doubled**, corroborating the
  stream-to-disk bound (memory ~ concurrency, not tree size).

## Guardrails

- **Never regress the single-file path.** Fan-out is a bulk concern; `diet <file>` and a single library call
  stay zero-overhead — no pool spin-up, no worker thread unless asked.
- **Parallelism is always opt-out-able** (`--concurrency 1`) for reproducibility and constrained
  environments.
- **Simplicity first.** A worker pool and a fast path are the only structural additions — resist a bespoke
  scheduler or a cache that complicates the pure core. If a hot loop needs cleverness, document why.
- **Honesty holds under speed.** A faster path must still measure its output and keep the never-bigger /
  quality-floor guarantees — a fast path that skips verification is a bug, not an optimization.
