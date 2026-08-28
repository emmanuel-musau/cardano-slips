---
"@cardano-slips/core": minor
---

Add templated references: the placeholders in a linked action's `label` and `href`, the values a person supplies for them, and the `POST` target that results.

`checkTemplates` runs the three rules the discovery decoder had to defer, now that the discovery URL is in hand — an `href` that resolves off the discovery origin, a `{placeholder}` no parameter fills, a parameter no placeholder references, and a `max` below its `min`. The four `get/invalid/rule` payloads the CIP publishes are rejected here, and nowhere earlier.

`checkValues` enforces `required`, `min` and `max` before a request is sent, counting characters on `text` and values on `number`, and refusing a `select` value that was never offered. It reads a number strictly rather than through `Number`, which would take `0x10` for 16.

`fillHref` percent-encodes each value to RFC 3986 unreserved and no further, then resolves against the discovery URL; `fillLabel` substitutes verbatim, because a label is display. The encoding is what keeps the origin fixed by the template rather than by an answer: an encoded value carries no `:`, `/`, `?`, `#` or `@`, so nothing a person types can move the request.
