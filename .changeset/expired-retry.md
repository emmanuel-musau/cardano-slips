---
"@cardano-slips/flow": patch
---

Rebuild without the inputs the node just called spent. After an `InputsSpent` submission, `completeIntent` leaves those inputs out of every later build, even when the wallet still lists them: the ones whose transaction id appears in the node's text, or every input of the failed attempt when the text names none. When nothing else is left it stops with the new `WalletBehind` completion refusal instead of asking for another signature on a transaction the node will refuse again.
