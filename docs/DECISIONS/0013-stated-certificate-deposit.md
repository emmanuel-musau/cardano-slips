# ADR-0013: Hold a stated deposit to the protocol parameter, and leave a stated refund uncompared

**Status:** Accepted
**Date:** 2026-09-10
**Issue:** #152

## Context

Writing the certificate attack examples turned up a transaction the gate lets
through. A Conway `reg_cert` states its own deposit; where it states five
hundred ADA and the parameter is two, `compare` returns `match`. The engine sees
the figure — `readDeposits` reports it with `basis: "stated"` and the ADA delta
is derived from it — and nothing holds it to anything.

The written spec said two things that read as a conflict. **Matching the
certificates** says a deposit and a refund are "supplied, never compared". The
adjustments table says `a deposit | Exactly the protocol parameter`, with no
MUST and no reason code, unlike the fee row beside it which has both.

They are not in conflict. They have different subjects: nothing is compared
against a *declaration*, because the intent has no field for a deposit; the
table is about the *body's own stated figure* against the parameter. What the
table lacked was a subject and a gate.

Two facts shaped the answer.

**The surface is two certificates, not seven.** `basis: "stated"` covers seven
certificate forms plus proposals, but `carriedType` keeps the combined
registration-delegation forms and both DRep forms under their own names, so they
answer to no declaration this version can write and already block on
`certificate.missing` / `certificate.undeclared`. Proposal deposits are already
`body.unsupported`. Only `reg_cert` and `unreg_cert` reach `match`.

**The deposit and the refund are not one rule.** `reg_cert`'s deposit must equal
the current parameter, and the ledger enforces exactly that. `unreg_cert`'s
refund must equal what the credential was registered under, which after a
`keyDeposit` change is not the current parameter and is not recoverable from any
of the engine's five arguments. `deposits.ts` already knew this — it is why
`StakeDeregistration` carries `assumed` rather than `parameter`.

## Decision

**A stated deposit that is not the protocol parameter blocks**, reported as
`certificate.deposit`, carrying the certificate's index, the stated figure and
the parameter. The rule is checked against the derived effects rather than
against the match path, so it covers the certificates that already fail to match
and is already right if a later version makes one of them declarable.

**A stated refund is not gated.** It is supplied, rendered, and not checkable
against anything the client holds. The written spec says so, and says why.

The table now marks which rows are gates and which describe what the ledger will
do, against this test:

> A row is a gate when the ledger's own rule for that figure is computable from
> the five arguments the engine is handed, **and** a wrong figure costs the
> person something. Otherwise it is a description of what the ledger will do.

The deposit passes both. The refund fails the first. The fee's lower bound — in
the table today, never enforced in `compare.ts` — fails the second, and stays
descriptive on purpose.

Adding `certificate.deposit` grows the reason vocabulary, which is normative, so
this ships as a versioned spec change and not a silent edit.

## Alternatives considered

**Leave both uncompared.** The ledger rejects a misstated deposit, so nothing is
stolen and the cost is a failed submission. It loses because the ADA delta is
derived from the stated figure: the panel reads `500.2 ADA leaving` beside
`stake registration` beside a declaration that said two, and the gate says
match. There is no honest rendering available — show the stated figure and the
screen contradicts the declaration with nothing saying why, show the parameter
and the panel is the lie. `verifier` is sold as consumable standalone by a wallet
or an explorer, and "the ledger would have caught it" is not the guarantee the
package makes.

**Gate the deposit and the refund alike, as the table's wording implied.** It
ships a false block no attack example would catch. Every credential registered
before a `keyDeposit` change deregisters with the figure it paid, so gating on
the current parameter would make that population permanently unsignable through
a Slips client — not a window, a split.

**Two codes, one per row.** Only one row blocks, so the second code would be
unreachable, and an unreachable code in a normative vocabulary is worse than no
code.

## Consequences

The gate now mirrors a ledger rule exactly where it gates, which is why it costs
no false positives. Where it cannot mirror one it says so in the text rather
than inventing a rule it cannot enforce.

The table's two kinds of row are now distinguishable, so the next reader does not
have to re-derive whether a row is a gate. That test is the reusable part of this
decision; the code is the small part.

Reversing the block later means removing a code from a normative vocabulary,
which is a versioned change and a client-visible one. Reversing the refund
decision is cheaper — it would mean gaining a rule, not losing one — and the
`assumed` basis is already in the engine for whoever wants to try.

What stays open is display: `deposits.ts` distinguishes `stated`, `parameter`
and `assumed`, and nothing in the design sheet yet uses that distinction to tell
a person a refund is the certificate's own claim rather than a promise.
