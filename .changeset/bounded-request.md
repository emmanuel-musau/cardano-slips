---
"@cardano-slips/core": minor
---

`boundedRequest` makes one request of an origin, bounded in time and size, and never follows a redirect. It fails as a `RequestFailure`: `UNREACHABLE` when nothing usable arrived in time or within the size limit, `MALFORMED_RESPONSE` on any redirect or an answer from another origin.

`fetchDomainMapping` now uses it, so its time limit covers reading the body as well as the headers. It also refuses a redirect even on the same origin: a browser told not to follow a redirect won't say where it pointed, so the spec's optional same-origin follow is declined, and nothing reaches another origin before it is refused.
