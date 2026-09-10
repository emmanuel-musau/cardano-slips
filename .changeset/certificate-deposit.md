---
"@cardano-slips/verifier": minor
---

Block a certificate that states a deposit which is not the protocol parameter, reported as `certificate.deposit` (ADR-0013). A Conway `reg_cert` states its own figure and the ledger fixes it at the current parameter exactly, so a body stating five hundred ADA where the parameter is two put five hundred ADA of "leaving your wallet" in front of a person and still returned `match`. The rule reads the derived effects rather than the match, so it covers the combined registration-delegation and DRep forms this version cannot declare.

A stated *refund* is deliberately not gated: the ledger returns what the credential was registered under, which after a `keyDeposit` change is neither the current parameter nor recoverable from any of the engine's five arguments, and gating it would permanently false-block every credential registered before such a change. `reasonCodes` is new, an exhaustive record of the block vocabulary that the suite holds to the table the CIP publishes.
