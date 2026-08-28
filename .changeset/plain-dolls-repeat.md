---
"@cardano-slips/verifier": minor
---

Decode Conway transaction CBOR into a typed structure, and hand back the body's
byte range beside it.

The reader is our own, per ADR-0010: no runtime CBOR dependency, and every body
key, certificate type and output shape either modelled or refused by name. An
era that adds a field arrives as a refusal rather than as an effect the user
never sees. `extractTransactionBody` answers where the body is without asking
what it says, which is what the commit is defined over.

Twenty-six mainnet fixtures come with it. Each one's BLAKE2b-256 over the
extracted body slice equals its known transaction id, and each carries the
chain's own reading of the transaction to check the decode against.
