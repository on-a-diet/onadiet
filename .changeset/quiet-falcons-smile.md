---
'@onadiet/image': patch
'@onadiet/pdf': patch
'@onadiet/svg': patch
'onadiet': patch
---

Take the security fixes in `sharp` and `svgo`.

- **`sharp` `^0.34.4` → `^0.35.4`** — 0.34.x inherits libvips advisories (CVE-2026-33327, CVE-2026-33328,
  CVE-2026-35590) and libheif advisories (GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545). Both are fixed at
  0.35.4. sharp 0.35 moved its type definitions to an ESM `.d.mts` that exports `Sharp` as a named interface
  rather than under a `sharp` namespace, so the internal type annotations move with it. The image golden
  corpus passes unchanged on the new version.
- **`svgo` → `>=4.1.0`** — 4.0.x lets `removeScripts` pass executable links through a namespace and
  control-character bypass (GHSA-w27v-7q3p-w38r). Already inside the declared `^4.0.2` range; this pins the
  lockfile forward.

No API or behaviour change.
