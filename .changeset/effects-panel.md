---
"@cardano-slips/flow": minor
---

Add the effects panel and the mismatch block.

`EffectsPanel` renders what a transaction does, derived from its bytes: the one figure the person is deciding on, then every effect as a row — payments, tokens received, withdrawals, certificates, the fee, and deposits and refunds, each marked refundable where the ledger guarantees it and as stated where only the transaction claims it. It takes the verifier's own `Verdict` as a required prop, so no caller renders a match by leaving the reasons out. On a mismatch the sign button is gone rather than disabled, the claim is set beside what the transaction actually does, and only the row the link never described is marked. The countdown takes the headline's place under a minute, and an expired transaction offers a rebuild instead of a signature.

`effects.css` is a new export carrying the panel's styling, and `tokens.css` gains the type roles the panel uses. The functions behind the panel (`ledgerOf`, `headlineOf`, `evidenceOf` and the rest) are exported for anyone drawing it themselves.

The mismatch wording now holds the transaction to "the link" and keeps addresses out of the sentence, giving them in full on `Explanation.where` instead. `formatCountdown` now reads `4m 12s` rather than `4:12`.
