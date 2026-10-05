---
'@onadiet/image': patch
'@onadiet/pdf': patch
'@onadiet/svg': patch
---

Publish the dependency on `@onadiet/core` as a caret range rather than an exact pin.

These packages declared `@onadiet/core` as `workspace:*`, which pnpm rewrites to an **exact** version at
publish time. With an exact pin, a patch to `core` reaches nobody who installed it through one of these
adapters until every adapter is republished too — and two adapters installed at different patch levels of
`core` cannot share a copy. `workspace:^` publishes a caret range instead, so a fix to `core` reaches every
adapter without republishing them.

No API or behaviour change; this is the dependency metadata consumers resolve against.
