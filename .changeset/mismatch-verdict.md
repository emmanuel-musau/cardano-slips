---
"@cardano-slips/verifier": minor
---

Compare derived effects against the partial intent, and return the verdict that blocks a signature. `compare` answers `match` or `mismatch(reasons)`, where each reason carries the code the CIP names and the fact behind it — the address, the amounts, the certificate — so a client can show a person the difference rather than the rule that fired. The CIP's published table of 34 verdicts runs against this code.

Both bounds the comparison enforces are computed rather than supplied, since a caller allowed to work them out could work them out generously: `ProtocolParameters` gains the minimum-fee coefficients and the per-byte cost, `minimumFee` and `minimumLovelace` apply them, and `minimumChangeLovelace` settles the amount a change output would need against its own encoding. `deriveEffects` assembles the view the comparison reads, including each output's ownership and encoded size and the body members this version cannot describe to a person. `decodeBech32` and `encodeBech32` read the addresses and identifiers an intent declares and write a body's bytes back in the form the person would recognise.
