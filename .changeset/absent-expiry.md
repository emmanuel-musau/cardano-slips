---
"@cardano-slips/verifier": minor
---

Block a transaction that carries no validity end. The spec says a client MUST NOT set an interval ending after `validUntil`, and a body with no end never stops being submittable — by whoever obtains it, against a fee market and a UTxO set that have both moved — so it is the extreme of that rule rather than an exception to it. `compare` now reports `interval.beyond-declared` for it, and the reason's `validUntil` is `bigint | null` so a block can say there was no end rather than name one.
