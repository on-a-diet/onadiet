---
'@onadiet/image': patch
'@onadiet/pdf': patch
'@onadiet/svg': patch
---

Publish the dependency on `@onadiet/core` as a caret range rather than an exact pin.

These packages declared `@onadiet/core` as `workspace:*`, which pnpm rewrites to an **exact** version at
publish time. `changeset publish` uploads the family concurrently rather than in dependency order, so a
transient failure on `core` leaves these on the registry immutably, pinned to a version that does not exist
— and an exact pin admits no recovery. `workspace:^` publishes a caret range, so a straggler can be brought
up with a patch bump.

No API or behaviour change; this is the dependency metadata consumers resolve against.
