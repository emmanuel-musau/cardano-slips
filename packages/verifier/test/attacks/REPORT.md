# Attack examples: the block-rate report

Written by `test/regression.test.ts` from its own run. CI fails when this file
differs from what the run produces, so it cannot describe a run that no longer
happens. Rewrite it with `pnpm attack-examples -u`, never by hand.

| | Cases | Correct |
| --- | ---: | ---: |
| Transactions that lie, blocked | 30 | 30 |
| Honest transactions, signed | 3 | 3 |
| Verdict-table cases that must block, blocked | 26 | 26 |
| Verdict-table cases that must sign, signed | 10 | 10 |

Lying transactions that would have been signed: **0**.
Honest transactions refused: **0**.

## What it pays, and who it pays

`value-and-recipient.ts`

| Case | Verdict | What it lies about | Reasons |
| --- | --- | --- | --- |
| `honest` | signed | nothing: every case below is one edit away from this transaction | — |
| `inflated-amount` | blocked | the intent declares a 5 ADA tip and the body pays that address 500 ADA | `output.lovelace` |
| `shaved-amount` | blocked | the intent declares a 5 ADA payment and the body pays 1 ADA, so a bill the person believes settled is not | `output.lovelace` |
| `redirected-recipient` | blocked | the intent declares the tip to the merchant and the body pays the whole of it to an address the intent never names | `output.missing`, `output.undeclared` |
| `hidden-extra-output` | blocked | the body pays the declared 5 ADA tip, and 200 ADA more to a second address that appears nowhere in the intent | `output.undeclared` |
| `hidden-payment-behind-a-known-address` | blocked | the body pays the merchant twice, so the extra 200 ADA hides behind the one address the person was shown | `output.undeclared` |
| `split-into-two-payments` | blocked | the intent declares one payment to the merchant and the body makes two adding to the same total, which only a comparison holding the body to the declaration rather than to a sum can see | `output.undeclared` |
| `ada-in-place-of-the-stablecoin` | blocked | the intent declares 100 USDM and the body moves no USDM at all, paying 100 ADA instead | `output.assets`, `output.lovelace` |
| `lookalike-policy` | blocked | the intent declares 100 USDM and the body moves 100 of a worthless token carrying the same asset name under another policy | `output.assets` |
| `display-units-declared-for-base-units` | blocked | the intent declares 10 where the body moves 10000000 base units, which is what writing a six-decimal display amount into a base-unit field does — and the person pays a million times what the page said | `output.assets` |
| `base-units-declared-for-display-units` | blocked | the reverse: the intent declares 10000000 base units and the body moves 10, so the merchant is paid a millionth of what the page promised | `output.assets` |

## What it stakes, and what it drains

`certificates-and-withdrawals.ts`

| Case | Verdict | What it lies about | Reasons |
| --- | --- | --- | --- |
| `honest` | signed | nothing: every case below is one edit away from this transaction | — |
| `wrong-pool` | blocked | the intent names one pool and the certificate delegates the signer's stake to another | `certificate.target` |
| `wrong-drep` | blocked | the intent names one DRep and the certificate hands the signer's vote to another | `certificate.target` |
| `undeclared-deregistration` | blocked | the intent declares a delegation and the body delegates and then deregisters, so the stake the person meant to move ends up staked nowhere and the deposit comes back as if they had asked for it | `certificate.undeclared` |
| `deregistration-in-place-of-the-declared-registration` | blocked | the intent declares a registration and the body deregisters instead, which unstakes the person in the one move they thought was staking them | `certificate.missing`, `certificate.undeclared` |
| `misstated-deposit` | blocked | the intent declares a registration, whose deposit the ledger fixes at two ADA, and the certificate states five hundred — so the panel shows five hundred ADA leaving for a registration that costs two | `certificate.deposit` |
| `certificates-out-of-order` | blocked | the intent registers and then delegates, and the body delegates and then registers — the ledger applies them in order, so only one of the two does what the person was shown | `certificate.order` |
| `certificate-on-a-strangers-credential` | blocked | the certificate names the declared pool but acts on a stake credential the wallet never reported, so the signature pays for someone else's delegation | `certificate.credential` |
| `undeclared-reward-withdrawal` | blocked | the intent declares a delegation and says nothing about rewards, and the body drains the signer's whole reward balance on the way past | `withdrawal.undeclared` |
| `withdrawal-to-a-strangers-account` | blocked | the intent asks to withdraw the signer's rewards and the body withdraws from a reward account the wallet never reported | `withdrawal.account` |
| `declared-withdrawal-never-made` | blocked | the intent says the rewards are being withdrawn and the body withdraws nothing, so the person pays a fee for a claim that did not happen | `withdrawal.missing` |
| `second-undeclared-withdrawal` | blocked | the intent asks for one withdrawal and the body makes two, the second from an account the wallet never reported | `withdrawal.account`, `withdrawal.undeclared` |

## What it creates, and how long it stays submittable

`mint-and-validity.ts`

| Case | Verdict | What it lies about | Reasons |
| --- | --- | --- | --- |
| `honest` | signed | nothing: every case below is one edit away from this transaction | — |
| `undeclared-mint` | blocked | the body pays the declared tip and mints a token into the signer's own wallet on the way, which this version has no field to describe and no way to render | `mint.undeclared` |
| `undeclared-burn` | blocked | the body pays the declared tip and destroys a token the signer already held, which no output records and nothing in the intent asked for | `mint.undeclared` |
| `mint-and-burn-in-one-body` | blocked | the body destroys the signer's stablecoin and mints a token of its own in the same breath, so a wallet totalling one line sees a swap that nobody agreed to | `mint.undeclared` |
| `minted-lookalike-in-place-of-the-stablecoin` | blocked | the intent declares 100 USDM and the body mints 100 of a token carrying USDM's own asset name under a policy nobody has heard of, then pays that — a wallet showing tickers shows the person exactly what they expected | `mint.undeclared`, `output.assets` |
| `mint-paid-to-a-stranger` | blocked | the body mints a token and sends it to an address the intent never names, so the signature pays the fee for someone else's issuance | `mint.undeclared`, `output.undeclared` |
| `no-expiry-at-all` | blocked | the body carries no validity end, so the signed transaction stays submittable for ever — by whoever obtains it, against a fee market and a UTxO set that have both moved | `interval.beyond-declared` |
| `expiry-past-the-declared-deadline` | blocked | the intent expires on the first of January and the body stays valid until June | `interval.beyond-declared` |
| `not-submittable-until-later` | blocked | the body cannot be submitted until a fortnight from now, so the person signs something they cannot act on and cannot recall | `interval.not-yet-valid` |
| `window-opening-after-the-deadline` | blocked | the body's window opens after the intent has already expired and closes months later, which is the whole of both interval rules broken at once | `interval.beyond-declared`, `interval.not-yet-valid` |

## The spec's table of verdicts

[`spec/examples/effects/verdicts.json`](../../../../spec/examples/effects/verdicts.json).
These state effects rather than encode bytes, so they prove each rule without
proving the path a real signature takes, and are counted apart from the
transactions above.

| Case | Verdict | Reasons |
| --- | --- | --- |
| `a payment built exactly as declared, with change returning to the wallet` | signed | — |
| `a token payment whose lovelace the client raised to the ledger minimum` | signed | — |
| `a declared amount already above the ledger minimum, left where it was` | signed | — |
| `two declared payments in one transaction` | signed | — |
| `a delegation, with the deposit and the fee supplied by the client` | signed | — |
| `a vote delegation naming the declared DRep` | signed | — |
| `a withdrawal of the whole reward balance, part of it paid on` | signed | — |
| `a fee that absorbs a remainder too small to return as change` | signed | — |
| `change split across two addresses the wallet controls` | signed | — |
| `the declared payment is missing from the transaction` | blocked | `output.missing` |
| `a second payment nobody declared, to an address the wallet does not control` | blocked | `output.undeclared` |
| `the declared amount split into two outputs at the declared address` | blocked | `output.undeclared` |
| `one lovelace short of what was declared` | blocked | `output.lovelace` |
| `more than the declared amount, which is not the client's to give away` | blocked | `output.lovelace` |
| `an asset-carrying output raised past the ledger minimum` | blocked | `output.lovelace` |
| `one base unit short on the declared asset` | blocked | `output.assets` |
| `an asset the intent never mentioned, riding along in a declared output` | blocked | `output.assets` |
| `change returned to an address the intent declares` | blocked | `output.undeclared` |
| `the declared certificate is absent` | blocked | `certificate.missing` |
| `a certificate nobody declared, alongside the one that was` | blocked | `certificate.undeclared` |
| `a delegation to a pool other than the declared one` | blocked | `certificate.target` |
| `a certificate acting on a stake credential the wallet does not control` | blocked | `certificate.credential` |
| `the declared certificates, in an order that changes what they do` | blocked | `certificate.order` |
| `a registration stating a deposit larger than the protocol parameter` | blocked | `certificate.deposit` |
| `a deregistration stating a refund that is not the protocol parameter` | signed | — |
| `a declared withdrawal the transaction does not make` | blocked | `withdrawal.missing` |
| `a withdrawal nobody declared` | blocked | `withdrawal.undeclared` |
| `a withdrawal from a reward account the wallet does not control` | blocked | `withdrawal.account` |
| `a mint, which nothing in this version can declare` | blocked | `mint.undeclared` |
| `a burn, which is the same rule with the sign reversed` | blocked | `mint.undeclared` |
| `a body member this version has no way to describe to a person` | blocked | `body.unsupported` |
| `a required signer, which the same rule blocks` | blocked | `body.unsupported` |
| `a fee one lovelace past what the ledger and a returned remainder explain` | blocked | `fee.excessive` |
| `a transaction that stays valid after the intent expires` | blocked | `interval.beyond-declared` |
| `a transaction that cannot be submitted until later today` | blocked | `interval.not-yet-valid` |
| `several lies at once, each reported` | blocked | `certificate.undeclared`, `output.lovelace` |
