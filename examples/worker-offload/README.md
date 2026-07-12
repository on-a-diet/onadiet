# Worker-thread offload

Run a slim **off the main event loop** so one compression can't add latency to a server's request loop.

## Why

`onadiet`'s codecs (sharp/libvips, qpdf) already do the heavy pixel/stream work on libuv's threadpool. But the
SSIM-guided **size search** — the encode→decode→compare loop that finds the floor-holding minimum — is
JavaScript on the **main thread**. On a busy server a large slim can therefore delay other requests. Moving the
whole slim onto a worker thread keeps the event loop free.

## The engine makes this trivial

A slim is a pure `(bytes, request) → SlimResult` call with **no cross-call state**, so:

- **it's safe to call concurrently** from many requests — no locks, no per-request setup;
- **a single-file slim shares nothing at all** (the only shared state anywhere is the folder API's read-mostly,
  bounded glob cache — irrelevant to per-file slims);
- **pooling is trivial** — any worker can serve any request, and there's nothing to reset between calls.

## Files

- [`worker.mjs`](./worker.mjs) — the offload target: detects the file type, runs the right adapter's `slim`,
  posts the `SlimResult` back.
- [`pool.mjs`](./pool.mjs) — a minimal, dependency-free worker pool (spawn once, reuse across requests — never
  spawn a worker per call on a hot path). Self-heals if a worker crashes.

## Usage

```js
import { readFile, writeFile } from 'node:fs/promises'
import { createSlimPool } from './pool.mjs'

const pool = createSlimPool({ workerUrl: new URL('./worker.mjs', import.meta.url) })

// In a request handler — the event loop stays responsive while the slim runs on a worker:
const input = new Uint8Array(await readFile('report.pdf'))
const result = await pool.slim(input, { plan: 'balanced', fast: true })

if (result.output) {
  await writeFile('report.diet.pdf', result.output) // a genuinely smaller file
} else {
  // Honest, never a fake win: kept the original (couldn't beat it) or the target was infeasible.
  console.log(result.outcome)
}
```

## Production notes

- **Use a pool, size it to your cores.** Spawning a worker per request is wasteful; the pool above defaults to
  `cores − 1`. For a battle-tested pool, [`piscina`](https://github.com/piscinajs/piscina) wraps the same
  `worker.mjs` with backpressure and metrics — the engine's statelessness means it drops straight in.
- **Widen the codec threadpool** if encodes queue: raise `UV_THREADPOOL_SIZE` (default 4).
- **Reach for `--fast` / `fast: true`** on latency-sensitive paths — one nominal encode instead of the full
  ladder search (see the README's "Fast on the hot path" numbers).
- **Message passing copies the bytes.** Input and output cross the thread boundary by structured clone. That's
  a copy of the (small, compressed) output and the input — negligible against the encode cost. Zero-copy
  transfer is possible only when you own a standalone `ArrayBuffer` (a pool-backed Node `Buffer` can't be
  transferred), so this example copies for robustness.
