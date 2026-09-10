---
"@cardano-slips/verifier": minor
---

Derive what a transaction does besides move value. `deriveCertificates` returns each certificate with the credential it acts on and the namespace that credential belongs to, the pool or DRep it names, and the deposit or refund attached; `deriveWithdrawals` sums per reward account; `deriveMint` lists what is created and destroyed, signed; and `deriveValidity` converts the body's interval to wall-clock instants. `ProtocolParameters` gains the slot mapping those instants need, anchored at the first slot of the era in force.
