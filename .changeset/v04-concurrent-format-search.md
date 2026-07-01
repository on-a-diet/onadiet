---
'@onadiet/image': patch
'onadiet': patch
---

Concurrent per-format search (v0.4 perf). Under `--format auto` (and the `keto`/`crash` plans, which force the
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
