---
"@cardano-slips/flow": patch
---

Rebuild without the inputs the node just called spent. After an `InputsSpent` submission, `completeIntent` leaves the failed attempt's inputs out of every later build, even when the wallet still lists them, and when nothing else is left it stops with `OutOfAttempts` instead of asking for another signature on a transaction the node will refuse again.
