# @cardano-slips/verifier

## 0.2.0

### Minor Changes

- [#154](https://github.com/emmanuel-musau/cardano-slips/pull/154) [`c6fd67a`](https://github.com/emmanuel-musau/cardano-slips/commit/c6fd67a51a5bba9e2c642d38629d28253e0249dc) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Block a transaction that carries no validity end. The spec says a client MUST NOT set an interval ending after `validUntil`, and a body with no end never stops being submittable — by whoever obtains it, against a fee market and a UTxO set that have both moved — so it is the extreme of that rule rather than an exception to it. `compare` now reports `interval.beyond-declared` for it, and the reason's `validUntil` is `bigint | null` so a block can say there was no end rather than name one.

- [#144](https://github.com/emmanuel-musau/cardano-slips/pull/144) [`c194003`](https://github.com/emmanuel-musau/cardano-slips/commit/c194003eeb2a68889a1bfe470b58ce000c7e459d) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Derive native-asset deltas per policy and asset name. `deriveAssets` takes the same four arguments as `deriveLovelace` and returns the net for each asset across the user's addresses — positive is the asset leaving, negative is it arriving — with assets that come in and go straight back out left off, and `unaccounted` for anything the reading cannot place. Quantities are raw on-chain counts; decimals are a display concern.

- [#143](https://github.com/emmanuel-musau/cardano-slips/pull/143) [`ce87c87`](https://github.com/emmanuel-musau/cardano-slips/commit/ce87c8787b93e4a3bde69776baa65f73b87c2f28) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Derive the net lovelace delta for the user's addresses, the exact fee, and the deposits a transaction locks up or hands back. `deriveLovelace` takes the decoded transaction, the addresses the wallet reports, the value of every input the body spends, and the protocol parameters in force, and returns them alongside `unaccounted` — what the ledger consumes less what it produces, which is `0n` for a transaction the engine reads completely.

- [#149](https://github.com/emmanuel-musau/cardano-slips/pull/149) [`2241678`](https://github.com/emmanuel-musau/cardano-slips/commit/2241678462552eeec34d3c390893f072bb701fff) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Compare derived effects against the partial intent, and return the verdict that blocks a signature. `compare` answers `match` or `mismatch(reasons)`, where each reason carries the code the CIP names and the fact behind it — the address, the amounts, the certificate — so a client can show a person the difference rather than the rule that fired. The CIP's published table of 34 verdicts runs against this code.
  
  Both bounds the comparison enforces are computed rather than supplied, since a caller allowed to work them out could work them out generously: `ProtocolParameters` gains the minimum-fee coefficients and the per-byte cost, `minimumFee` and `minimumLovelace` apply them, and `minimumChangeLovelace` settles the amount a change output would need against its own encoding. `deriveEffects` assembles the view the comparison reads, including each output's ownership and encoded size and the body members this version cannot describe to a person. `decodeBech32` and `encodeBech32` read the addresses and identifiers an intent declares and write a body's bytes back in the form the person would recognise.

- [#145](https://github.com/emmanuel-musau/cardano-slips/pull/145) [`d1fdef8`](https://github.com/emmanuel-musau/cardano-slips/commit/d1fdef8a5863df9664dc3eea2d3a8a16e64b6589) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Derive what a transaction does besides move value. `deriveCertificates` returns each certificate with the credential it acts on and the namespace that credential belongs to, the pool or DRep it names, and the deposit or refund attached; `deriveWithdrawals` sums per reward account; `deriveMint` lists what is created and destroyed, signed; and `deriveValidity` converts the body's interval to wall-clock instants. `ProtocolParameters` gains the slot mapping those instants need, anchored at the first slot of the era in force.

## 0.1.0

### Minor Changes

- [#128](https://github.com/emmanuel-musau/cardano-slips/pull/128) [`7c9d1fb`](https://github.com/emmanuel-musau/cardano-slips/commit/7c9d1fb608279b985f8bec062374550aee96967e) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Decode Conway transaction CBOR into a typed structure, and hand back the body's
  byte range beside it.
  
  The reader is our own, per ADR-0010: no runtime CBOR dependency, and every body
  key, certificate type and output shape either modelled or refused by name. An
  era that adds a field arrives as a refusal rather than as an effect the user
  never sees. `extractTransactionBody` answers where the body is without asking
  what it says, which is what the commit is defined over.
  
  Twenty-six mainnet fixtures come with it. Each one's BLAKE2b-256 over the
  extracted body slice equals its known transaction id, and each carries the
  chain's own reading of the transaction to check the decode against.

### Patch Changes

- Updated dependencies [[`9ed2ff5`](https://github.com/emmanuel-musau/cardano-slips/commit/9ed2ff59a108a1c7b18823dca1f8c4e445ecf190), [`8d53fb2`](https://github.com/emmanuel-musau/cardano-slips/commit/8d53fb2e00e1953194f097b53bcb07d2911794ce), [`77ed6d9`](https://github.com/emmanuel-musau/cardano-slips/commit/77ed6d992549d8062cce55b5357c2941adad72c0)]:
  - @cardano-slips/core@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [[`a9c1c59`](https://github.com/emmanuel-musau/cardano-slips/commit/a9c1c59ba4174e4f5be63a0b195e7fd13d7498c9), [`81a35d2`](https://github.com/emmanuel-musau/cardano-slips/commit/81a35d28f7deee739c91ba7f9621619db2704c08), [`b29417c`](https://github.com/emmanuel-musau/cardano-slips/commit/b29417c5055b1edfc0f2a753456889e0267e2190)]:
  - @cardano-slips/core@0.1.0

## 0.0.1

### Patch Changes

- [#112](https://github.com/emmanuel-musau/cardano-slips/pull/112) [`b9256cc`](https://github.com/emmanuel-musau/cardano-slips/commit/b9256ccfe44584c5e4e290c8854b96d71daf9fa2) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core` carries.
  
  Two tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/no-io.test.ts` is hard invariant 1 over the real code: it walks every source file for an import or a global that could reach a disk, a socket or another process, holds the manifest to a reviewed dependency list, and loads the module with those routes trapped. No API yet — decode, derivation, deposits and the comparison land in their own issues.
