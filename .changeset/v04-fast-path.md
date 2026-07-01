---
'onadiet': minor
'@onadiet/core': minor
'@onadiet/pdf': patch
'@onadiet/image': patch
---

Fixed-quality fast path (v0.4 P3). A new opt-in `--fast` / `SlimRequest.fast` encodes each image ONCE at the
plan's nominal (gentlest) quality and verifies the floor, skipping the SSIM ladder search — the single
biggest per-call latency win for latency-sensitive callers (a server slimming one file per request), trading
the deeper savings of the full search. Honesty holds: it still measures its output and keeps the never-bigger
and quality-floor guarantees (if the nominal encode can't beat the original, the original is kept). Mutually
exclusive with a byte target (`--to`/`--to-each`/`--to-total`), which is a usage error. The **default**
no-target slim is unchanged — it keeps the full ladder search, which is what delivers the meaningful shrink.
