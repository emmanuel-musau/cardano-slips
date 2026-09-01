---
"@cardano-slips/verifier": minor
---

Derive the net lovelace delta for the user's addresses, the exact fee, and the deposits a transaction locks up or hands back. `deriveLovelace` takes the decoded transaction, the addresses the wallet reports, the value of every input the body spends, and the protocol parameters in force, and returns them alongside `unaccounted` — what the ledger consumes less what it produces, which is `0n` for a transaction the engine reads completely.
