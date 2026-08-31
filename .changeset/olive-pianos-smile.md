---
"@cardano-slips/server": minor
---

Serve `slips.json` with `defineDomainMapping`, and hand route params to the handlers.

`defineDomainMapping({ rules })` returns the `GET` a publisher mounts at their origin root. The rules are fixed at deploy, so they are decoded when the module loads — a mapping the spec rejects throws where the publisher can see it instead of serving a file no client will accept. It sets `Access-Control-Allow-Origin: *` and defaults to the `max-age=300` the spec's own example carries.

`defineSlip` handlers now receive `params`, the route's dynamic segments, resolved from either the promise Next 15 and 16 pass or the plain object 13 and 14 pass. On a route with no dynamic segment it is `{}`, so nothing existing changes.
