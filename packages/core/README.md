# @onadiet/core

The **pure engine** behind [onadiet](https://github.com/on-a-diet/onadiet) — _put your files on a diet._

> **Early (`0.x`).** The engine is built and working — this package holds the pure pipeline seams + helpers, and
> the format adapters ([`@onadiet/pdf`](https://www.npmjs.com/package/@onadiet/pdf), `@onadiet/image`,
> `@onadiet/svg`) implement the target-size search against real-file golden corpora.
> On npm: `npm i @onadiet/core`. See the
> [API reference](https://github.com/on-a-diet/onadiet/blob/main/docs/guide/api-reference.md) and
> [roadmap](https://github.com/on-a-diet/onadiet/blob/main/docs/ROADMAP.md).

## What this package is

The engine that both the [`onadiet` CLI](https://www.npmjs.com/package/onadiet) and (later) the format
adapters build on. Its defining property: it is **pure** — no filesystem, network, clock, or randomness. It
reaches the outside world only through injected ports, which keeps it deterministic, testable, and reusable
across the CLI, a runtime library, CI, and agents. Purity is enforced two ways: ESLint bans
time/randomness/`process` in `src`, and dependency-cruiser bans Node I/O built-ins and any import of a
sibling package (dependencies point _into_ core, never out).

## The pipeline

```
detect → weigh → plan → slim → verify → report
```

This package is the **pure core** of that loop — the seams + helpers below; the format adapters
(`@onadiet/pdf` / `@onadiet/image` / `@onadiet/svg`) implement `detect`/`weigh`/`slim` per format on top:

| Export                                                       | What it is                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `parseSize` · `formatBytes` · `savedPercent`                 | Size math (`"5mb"` ⇄ bytes, human formatting, % saved).               |
| `DIET_PLANS` · `PLAN_SPECS` · `resolvePlan` · `DEFAULT_PLAN` | The quality contracts: `cleanse · balanced · lowcarb · keto · crash`. |
| `OnadietError` (+ `OnadietErrorCode`)                        | Typed errors — callers branch on `.code`, never on message strings.   |
| `FormatAdapter` · `Weight` · `Outcome` (types)               | The seams the format adapters (`@onadiet/pdf`, …) will implement.     |

## Usage

```ts
import { parseSize, resolvePlan, savedPercent } from '@onadiet/core'

parseSize('5mb') // 5_000_000
resolvePlan('lowcarb') // { plan: 'lowcarb', lossless: false, summary: '…' }
savedPercent(41_200_000, 4_700_000) // 88.6
```

## Concurrency & the hot path

The engine holds **no cross-call mutable state**, so it is safe to call from many concurrent requests — a
server can slim on every request with no locks and no per-request setup. A single-file slim shares nothing at
all; the only shared state anywhere is the folder API's read-mostly, **bounded** glob cache (irrelevant to
per-file slims).

The codecs (sharp/libvips, qpdf) run the heavy pixel/stream work on libuv's threadpool, but the SSIM-guided
size search is JS on the main thread — so on a busy server, move a slim onto a **worker thread** to keep the
event loop free. Because a slim is a pure `(bytes, request) → SlimResult` call, it offloads cleanly and pools
trivially. Runnable pattern (worker + a minimal, self-healing pool):
[`examples/worker-offload`](https://github.com/on-a-diet/onadiet/tree/main/examples/worker-offload).

## License

[Apache-2.0](./LICENSE) © Sharvil Kadam.
