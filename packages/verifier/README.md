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

## Standalone by design

A wallet or an explorer can take this package on its own, without the rest of the protocol. It depends on `core` for types and on no other workspace package — never on `flow`, `server`, or any network layer.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/verifier"
```

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
