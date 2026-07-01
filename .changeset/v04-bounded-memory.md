---
'onadiet': minor
'@onadiet/core': patch
---

Bounded memory & fail-fast (v0.4 P1). Folder mode is now memory-safe on arbitrarily large trees: slimmed
outputs are streamed to temp files on disk as they're produced (the sorted-first winner is renamed into place
at commit) instead of held in memory, so peak stays ~`--concurrency` regardless of tree size. A new
`--max-input <size>` flag (folder `maxInputBytes`) skips-with-reason (folder) / fails fast (single file) any
file larger than the cap, checked by **stat before the file is ever read** — no OOM on a hostile huge file.
Single-file `check` is now **stat-only** (it no longer reads the whole file just to measure its size), so it's
memory-safe on any size. The pure-core compiled-glob memo is now bounded (FIFO cap) so it can't grow
unboundedly on a long-lived server.
