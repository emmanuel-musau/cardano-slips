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

## The assets

`deriveAssets` is the same arithmetic per policy and asset name, and takes the
same four arguments.

```ts
import { deriveAssets } from "@cardano-slips/verifier"

const derived = deriveAssets({ transaction, userAddresses, resolvedInputs, protocolParameters })

if (Either.isRight(derived)) {
  derived.right.user // [{ policyId, name, spent, received, delta }]
  derived.right.unaccounted // [] for a transaction the engine reads completely
}
```

`delta` runs the same way as `user.ada`: positive is the asset leaving,
negative is the asset arriving, so the person paying and the person being paid
read the same transaction with opposite signs.

**Every quantity is the raw on-chain count.** A token's decimals are a display
concern; ten USDM is `10000000n` here and nowhere is it `10`.

**An asset that comes in and goes straight back out is not an effect.** A
wallet holding fourteen tokens and moving one has one delta, not fourteen —
`test/fixtures/usdm-payment.json` is exactly that transaction. `unaccounted`
here is what the inputs hold plus what the body mints, less what the outputs
hold; the mint is read for that sum alone, and rendering what a transaction
creates or destroys belongs elsewhere.

## What it does besides move value

Four more, taking the same argument and refusing on the same terms.

```ts
import { deriveCertificates, deriveMint, deriveValidity, deriveWithdrawals } from "@cardano-slips/verifier"

deriveCertificates(derivation) // [{ kind, credential, role, ours, pool, drep, deposit, refund, index }]
deriveWithdrawals(derivation) // [{ rewardAccount, amount, ours }]
deriveMint(derivation) // [{ policyId, name, quantity }] — a burn is negative
deriveValidity(derivation) // { validFrom, validUntil }, each a slot and the instant it begins
```

**A certificate carries what a person needs to read it**: what it is, the
credential it acts on, the pool or DRep it names, and the deposit or refund the
ledger applies to it, already joined from `deposits.ts`.

**Read `role` before rendering `credential`.** Three different namespaces arrive
in that one field — a stake credential, a DRep's own, and a committee cold key —
and a DRep or committee key shown as a `stake1…` address is an address the
person does not hold. `ours` is true where the wallet reported that credential,
in a reward account or in the stake half of one of its addresses; a credential
it did not report is someone else's, the same rule the addresses follow.

**A withdrawal is summed per reward account, and a mint per asset.** The ledger
writes one entry each, but both are CBOR maps nothing forces to have distinct
keys: two withdrawal entries rendered separately would show one account's
rewards twice, and a policy written twice in a mint would show as a mint and a
burn of an asset the transaction creates none of.

**`validUntil` is when the transaction expires**, not the last moment it is
good for: the body's `invalid_hereafter` is the first slot it is no longer
valid. Both ends convert through the slot mapping in the protocol parameters,
anchored at the first slot of the era in force — mainnet's Shelley era begins at
slot 4492800, and using slot zero would put every conversion two hours out.

## What every derivation holds to

**An address the wallet did not report is someone else's.** That overstates what
leaves and understates what returns, which is the safe direction: the other one
would hide a payment to a stranger by calling it change. An address sharing a
payment credential but not a stake part is a different address, and is treated
as one.

**They refuse rather than guess.** An input with no supplied value would
otherwise count as zero, which is how a spend gets hidden; two readings of one
input disagree about what to show; and a transaction whose is-valid flag is
false spends collateral instead of its inputs, which is different arithmetic.
Every derivation resolves the body's inputs through one shared step, so none of
them can grow its own idea of when to stop.

## Standalone by design

A wallet or an explorer can take this package on its own, without the rest of the protocol. It depends on `core` for types and on no other workspace package — never on `flow`, `server`, or any network layer.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/verifier"
```

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
