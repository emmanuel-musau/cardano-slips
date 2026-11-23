---
"@cardano-slips/flow": patch
---

Refuse before signing what the node would refuse after. The built transaction now carries a validity start five minutes before the client's clock, so a preview wallet on a preprod Slip (or the reverse) fails at its node, and `completeIntent` reports that refusal as the new `WrongNetwork` completion refusal (`WRONG_NETWORK`) while the window is still open by the client's clock. `signTx` is called with `partialSign: false`, so a wallet missing a key refuses with `ProofGeneration` instead of returning a partial signature. Unspent outputs carrying a reference script are no longer selected, because the fee is computed without the per-byte reference-script cost the node would charge for them.
