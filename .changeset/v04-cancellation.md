---
'onadiet': minor
'@onadiet/core': minor
'@onadiet/pdf': patch
'@onadiet/image': patch
'@onadiet/svg': patch
---

Cancellation / deadlines (v0.4 P2). `SlimRequest.signal` now accepts an `AbortSignal`: it's checked between
the expensive per-image encode+SSIM evaluations (and in the PDF apply loop), so a slow or oversized slim can
be abandoned mid-flight without leaking further work — the slim returns an honest `ABORTED` outcome and never
leaves a partial write. Essential when the engine runs on a request path. Pass the caller's own signal, or
`AbortSignal.timeout(ms)` for a deadline. New `throwIfAborted` helper and `ABORTED` error code in
`@onadiet/core`. The CLI gains `--timeout <ms>`: a single file writes nothing on abort, a folder run stops
early and marks the unprocessed files `aborted` in the manifest (and `--to-total` refuses rather than report
a budget verdict on a truncated sweep); either way an aborted run exits `2`.
