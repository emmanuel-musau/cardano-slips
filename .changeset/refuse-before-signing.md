---
"@cardano-slips/flow": patch
---

Refuse before signing what the node would refuse after. On preview and preprod the built transaction now carries a validity start a day before the client's clock, so a wallet on the other testnet (CIP-30 gives both one network id) fails at its node, and `completeIntent` reports that refusal as the new `WrongNetwork` completion refusal (`WRONG_NETWORK`) while the window is still open by the client's clock. Mainnet transactions carry no start, since connecting already tells mainnet apart. `signTx` is called with `partialSign: false`, so a wallet missing a key refuses with `ProofGeneration` instead of returning a partial signature. Unspent outputs carrying a reference script are no longer selected, because the fee is computed without the per-byte reference-script cost the node would charge for them.
