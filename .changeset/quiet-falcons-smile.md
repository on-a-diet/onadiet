---
'@onadiet/image': patch
'@onadiet/pdf': patch
'@onadiet/svg': patch
'onadiet': patch
---

Take the security fixes in `sharp` and `svgo`.

- **`sharp` `^0.34.4` → `^0.35.5`** — 0.34.x is affected by GHSA-f88m-g3jw-g9cj (vulnerabilities sharp
  inherits from libvips, fixed in 0.35.0) and GHSA-rgj7-g3m4-5g8c (vulnerabilities in libheif, fixed in 0.35.4).
  **Lossy AVIF output changes:** sharp 0.35 tunes AVIF quality with a different metric (SSIMULACRA2), so the
  same quality setting can produce a different file size, and where the output format is chosen automatically
  the choice between AVIF and WebP can change. JPEG and PNG output kept in its own format is unchanged.
- **`svgo` `^4.0.2` → `^4.1.0`** — 4.0.x lets `removeScripts` pass executable links through namespace and
  control-character bypasses (GHSA-w27v-7q3p-w38r) and incompletely sanitizes executable HTML inside
  `foreignObject` (GHSA-4vpr-x523-8j87). The declared range now starts at the fixed version, so an install can
  no longer resolve a vulnerable 4.0.x.

No API change.
