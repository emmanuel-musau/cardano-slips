# @cardano-slips/verifier

The security engine. It decodes a balanced transaction's CBOR, works out what the transaction actually does, and compares that against what the endpoint said it does. When the two disagree, signing is blocked — there is no override.

```
pnpm add @cardano-slips/verifier
```

## The signature

```
verify(tx CBOR, declared metadata, user addresses, resolved inputs, protocol parameters)
  → match | mismatch(reasons[])
```

Five arguments, and no sixth. Nothing is fetched: a transaction body carries only references to the inputs it spends, so their values are handed in; a fee ceiling, an output raised to the ledger minimum, a deposit told apart from a spend, and an expiry shown as a time all need protocol parameters, so those are handed in too. Anything the engine went and got for itself would put a network call between a person and a signature — one that can be slow, absent, or answered by whoever benefits from the answer.

That purity is what makes the attack examples worth anything. They run the same code that runs before a real signature, so "every lying transaction was blocked" is a property of a function rather than a claim about a system. `test/no-io.test.ts` is what keeps it true.

## What it derives

| Derived | Rendered as |
| --- | --- |
| net ADA delta for the user's addresses, exact fee, deposits | "You pay 0.17 ADA (fee)", "Deposit 2.00 ADA (refundable)" |
| net asset deltas per policy and asset | "You receive 25 USDM" |
| certificates | "Delegate → pool1xyz" |
| withdrawals | "Withdraws N ADA rewards" |
| mint and burn | assets created or destroyed |
| validity interval | "Expires in 4m 12s" |

Undeclared effects — an extra output, an unexpected certificate — are a mismatch, not an omission. The rules and the reason vocabulary are normative: see [The comparison](../../spec/CIP-XXXX/README.md#the-comparison).

## Reading the transaction

The first step is `decodeTransaction`, which takes the bytes and gives back a
Conway transaction body plus the byte range the body occupied:

```ts
import { decodeTransaction } from "@cardano-slips/verifier"
import { Either } from "effect"

const read = decodeTransaction(bytes)
if (Either.isLeft(read)) {
  read.left.refusal // "UnknownCertificateType"
  read.left.at // the byte it happened at
} else {
  read.right.body.fee
  read.right.bodyBytes // hash these for the transaction id
}
```

Two things about it are deliberate.

**It fails closed.** A body key we do not model, a certificate type from an era
that shipped after us, an output that is neither of the two known shapes: each
one refuses, by name, at a byte offset. A decoder that tolerated them would
derive effects from a transaction it only partly read, and the effect it missed
is the one nothing downstream can flag.

**It hands back the body's bytes, not a re-encode.** The transaction id is
BLAKE2b-256 over the body exactly as it arrived. Hashing our own re-encoding of
it would give a different id for any transaction whose body was not written the
way we would write it. `extractTransactionBody` does that half alone, for a
caller that needs the commit and not the contents.

The reasoning is in [ADR-0010](../../docs/DECISIONS/0010-cbor-decode-approach.md);
[ADR-0012](../../docs/DECISIONS/0012-decode-test-oracle.md) covers how it is tested.

## Working out the lovelace

`deriveLovelace` is the arithmetic: what the transaction does to a person's ADA,
the fee it states, and the deposits it locks up or hands back.

```ts
import { decodeTransaction, deriveLovelace } from "@cardano-slips/verifier"
import { Either } from "effect"

const derived = deriveLovelace({
  transaction, // from decodeTransaction
  userAddresses, // every address the wallet reports, its reward account included
  resolvedInputs, // the output each input points at, with its value
  protocolParameters
})

if (Either.isRight(derived)) {
  derived.right.user.ada // spent less received: positive is lovelace leaving
  derived.right.fee // exactly what the body states
  derived.right.deposits // "Deposit 2.00 ADA (refundable)"
  derived.right.unaccounted // 0n for a transaction the engine reads completely
}
```

**A deposit is not a cost.** It comes back, so it is listed apart from what is
spent rather than folded into `user.ada`, and each entry says where its number
came from: `stated` off the certificate, `parameter` from the protocol
parameters, or `assumed` where the body cannot settle whether the parameter
applies — a pool already registered pays nothing to re-register, and a
credential registered before the parameter last changed is refunded what it
paid rather than what the parameter says now. Each entry also carries `source`
and `index`, which say where in the body it came from: proposal deposits and
certificate deposits share one array and can share a position.

**Collateral is not in these figures.** It is consumed only when a script
fails, which is the is-valid-false case the derivation refuses, so it takes no
part in the arithmetic — but a transaction can still put collateral at risk
without that showing up anywhere here. Showing that risk is not modelled yet.

**`unaccounted` is the engine checking itself.** What the ledger consumes less
what it produces, under this reading: inputs and withdrawals and refunds against
outputs, fee, deposits and any treasury donation. It is `0n` for a transaction
the engine understands completely, and anything else is the engine saying the
arithmetic a person would be shown does not add up.

**An address the wallet did not report is someone else's.** That overstates what
leaves and understates what returns, which is the safe direction: the other one
would hide a payment to a stranger by calling it change. An address sharing a
payment credential but not a stake part is a different address, and is treated
as one.

The derivation refuses rather than guesses. An input with no supplied value
would otherwise count as zero, which is how a spend gets hidden; two readings of
one input disagree about what to show; and a transaction whose is-valid flag is
false spends collateral instead of its inputs, which is different arithmetic.

## Standalone by design

A wallet or an explorer can take this package on its own, without the rest of the protocol. It depends on `core` for types and on no other workspace package — never on `flow`, `server`, or any network layer.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/verifier"
```

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
