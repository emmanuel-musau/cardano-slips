# @cardano-slips/flow

## 0.2.0

### Minor Changes

- [#165](https://github.com/emmanuel-musau/cardano-slips/pull/165) [`c86d136`](https://github.com/emmanuel-musau/cardano-slips/commit/c86d136a31df4b448c618f88e0d2f5d5b15680f9) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Balance a partial intent locally, against unspent outputs the endpoint never sees (ADR-0002). `balanceIntent` takes the intent, the wallet's unspent outputs, the change address, the protocol parameters and the clock — every term an argument, none of them fetched, for the same reason the verifier takes its five — and returns the complete unsigned transaction CBOR, the fee, and the slot the body expires at. Outputs, the four declarable certificates and a rewards withdrawal are applied; coin selection and change go through `@evolution-sdk/evolution`, which this package now depends on.
  
  Declared lovelace is treated as the floor the spec says it is: an output that cannot pay for its own bytes is raised to the ledger's minimum, so the difference reaches the person as the client's own adjustment rather than folded into the declared amount. Leftover too small to become change refuses rather than being paid as fee, which would be lovelace leaving the wallet that nothing on screen accounted for. Certificates are emitted in their Conway forms: the legacy pair encodes neither deposit nor refund, and the builder therefore leaves both out of the balance, producing a transaction the ledger rejects.
  
  Failure is a typed refusal carrying a spec error code — `INTENT_EXPIRED`, `INSUFFICIENT_FUNDS`, `CANNOT_BALANCE`, and `MALFORMED_RESPONSE` for an intent whose address is on another network. Every failure is one of those, the unreadable change address included: nothing here throws past the error channel, because a defect reaches a person as a stack trace where a refusal reaches them as words. `readWalletUtxos` is the conversion from CIP-30's CBOR hex to the typed values the builder takes; evolution-sdk has it, behind an export path its manifest blocks, so it is the sixth gap of ADR-0004 and belongs upstream.

- [#170](https://github.com/emmanuel-musau/cardano-slips/pull/170) [`a6ed723`](https://github.com/emmanuel-musau/cardano-slips/commit/a6ed723b0e4d3e9b5ae4fa5223a80ed295e81190) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - `completeIntent` is the whole path in one call: read what the wallet holds, build against it, derive what the built transaction does, compare that with what the endpoint declared, sign, submit. It answers with the transaction id, the effects a person was shown, and how many attempts it took.
  
  UTxOs spent between building and signing are the flow's main real-world failure, and they are the one submission failure worth repeating. On `InputsSpent` the transaction is built again from the wallet's fresh outputs — and everything downstream happens again with it. A rebuilt transaction is a different transaction with a different id, so its effects are derived again and compared again before the wallet is asked for a second signature; a re-prompt against effects derived from the body that just failed would be a signature for something nobody read. Rebuilds are bounded, three by default, and every other submission failure fails on the spot rather than putting a second signature in front of someone for a reason no rebuild can fix.
  
  A mismatch hard-blocks here, in the error channel, with the reasons attached for the block to render and no field on the error that lets anyone past — invariant 3 where the signing actually happens rather than only in the UI that shows it. `CompletionError` also covers a wallet that holds nothing, a wallet that will not say what it holds or answers unreadably, and a transaction whose effects cannot be derived or compared — the last of which is reachable in practice: a wallet answering with the same input twice at two different values. `onAttempt` is where the caller puts the effects in front of a person, so a callback that throws fails closed as a refusal rather than escaping as a stack trace: nothing is signed that nobody was shown.
  
  `asResolvedInputs` converts the wallet's own unspent outputs into the values the derivation is handed. The engine never looks an input up (invariant 1), so this is where the client, which does know what it holds, says so — assets included, since a value read short understates what leaves the wallet.

- [#173](https://github.com/emmanuel-musau/cardano-slips/pull/173) [`e87c12e`](https://github.com/emmanuel-musau/cardano-slips/commit/e87c12e2f2c79920b65238bb7fbb994c50f4c8e9) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - `tokens.css` is one theme. The design sheet collapsed an earlier light/dark pair into a single ground that leans light, so `.slip-root[data-theme="dark"]` is gone and no role means two things any more. A component can no longer ask which theme it is in, which is the point: two components asking would eventually answer differently.
  
  The ground moves with it — `--page` is `#ebeef8`, `--card` is `#fcfdff`, `--ink` is `#141a26`, `--muted` is `#56628a` — and the transaction preview becomes its own slate surface at `#222b3d` with `--vault-ink` at `#f5f7ff`, rather than the white it was in the old light theme. That one deep surface is what lets the rest of the client stay bright while the screen that judges the publisher still reads as grave.
  
  `--on-accent` stays, because the sheet writes `#ffffff` inline on a button and a component cannot — `no-hard-coded-colours` forbids it. The `--dark-*` family stays too, and is now plainly a separate family rather than a value exempted from a theme: code blocks and the Open Graph card land on grounds we do not control, so they carry their own.
  
  The contrast audit is recomputed from these values rather than copied off the sheet, whose printed ratios had gone stale against its own hexes. Every pairing a person reads clears AA, and two assertions are deliberately the other way round: `--accent-fill` must keep failing AA on a card, since that failure is the whole reason `--accent-text` exists, and it is held to fills on the vault even though it clears 4.6:1 there — the rule is about what the colour is for, not the ratio it happens to reach.

- [#169](https://github.com/emmanuel-musau/cardano-slips/pull/169) [`38ea08f`](https://github.com/emmanuel-musau/cardano-slips/commit/38ea08ffe30bfc3a23c6ce389b2aedb5cf466890) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Sign a balanced transaction and submit it. `signTransaction` calls CIP-30 `signTx` with `partialSign: true`, assembles what comes back into the body, and returns the complete transaction with its id; `submitTransaction` sends it and answers with the id the chain will know it by. CIP-30 returns a **witness set**, never a signed transaction, which is invariant 4 and the detail that trips everyone up — a wallet that answers with a whole transaction is refused rather than submitted.
  
  Assembly is bound to one body. `transactionIdOf` is BLAKE2b-256 over the body's own bytes, never a re-encode, which is both the transaction id and CIP-0186's commit; the caller passes the id the effects were derived from, and witnesses go into that body or into none. The id is required rather than recomputed from whatever bytes arrive, because a function that recomputed it would bind the signature to the transaction in front of it instead of the one a person was shown. Witnesses append to `vkey_witnesses` and never replace them, so a co-signer's signature survives, and the id is checked again after assembly: an id that moved means the bytes moved.
  
  A returned set carrying native scripts, bootstrap witnesses, Plutus scripts, datums or redeemers is refused, not merged — version 1 builds nothing that spends from a script, so that is material the body was never judged with. A set carrying no signature is refused too: evolution-sdk returns the transaction untouched for an empty set, and without the check an unsigned transaction would reach `submitTx` looking signed. On submission, the wallet is held to the transaction it was given, because an id for something else would show a person a receipt for a transaction they never made — and an answer that is not an id at all is a refusal rather than a stack trace, since CIP-30 types these answers as strings and a wallet is under no obligation to send one.
  
  Failures are typed refusals. A declined signature is read from CIP-30's `TxSignError`, where `UserDeclined` is `2` — a different numbering from `APIError`, whose `2` is an internal error — and from an `APIError` `-3`, which wallets send from `signTx` in practice. Spent inputs are their own refusal for the rebuild path to watch for, a passed validity interval carries `INTENT_EXPIRED`, and nothing else carries a spec code: a decline and an unreachable node are states of a wallet, not failures of the exchange the spec describes.

### Patch Changes

- Updated dependencies [[`85e0601`](https://github.com/emmanuel-musau/cardano-slips/commit/85e06018ecf84d9983da3939c76a7a1335da1b23)]:
  - @cardano-slips/verifier@0.3.0

## 0.1.0

### Minor Changes

- [#161](https://github.com/emmanuel-musau/cardano-slips/pull/161) [`862e553`](https://github.com/emmanuel-musau/cardano-slips/commit/862e55348b6c2065e4d7a19606ac6603ef395faf) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Add `tokens.css` — colour, type, spacing and radius as CSS custom properties, taken from the design sheet. Scoped to a `slip-root` class rather than `:root`, because a package dropped into someone else's page must not redefine what that page already calls `--ink`; there is no reset in it and no rule that selects an element, so an inherited font stack survives. `data-theme="dark"` is the whole of the theme rule, rebinding the roles so a component writes `var(--ink)` once and is right in both themes — with the fixed dark palette for code blocks and the Open Graph card deliberately outside it, since a value that is fixed cannot also follow. Exported as `@cardano-slips/flow/tokens.css`, so the hosted page and a third party resolve the same file. Two tests hold it: nothing outside the token file writes a colour, and the sheet's contrast audit is recomputed against the values rather than copied in.

- [#160](https://github.com/emmanuel-musau/cardano-slips/pull/160) [`2d314ab`](https://github.com/emmanuel-musau/cardano-slips/commit/2d314ab6719a0d59cbe8e1280dafbfa0575935cb) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Discover and connect a CIP-30 wallet. `discoverWallets` reads `window.cardano` on demand — never at module load, so the package stays importable in a page rendered on a server — and names a wallet from our own registry, letting one it does not know name itself. `connectWallet` enables, then holds the wallet to the network the Slip declares: the reported network id and the network its own change address encodes must agree with it and with each other, and a change address comes back as bech32 ready for the `POST` body. Failure is a typed refusal per state a person can be shown, and a declined connection keeps the wallet's own CIP-30 `{ code, info }` so `-3` stays distinguishable from a crash.

### Patch Changes

- Updated dependencies [[`c6fd67a`](https://github.com/emmanuel-musau/cardano-slips/commit/c6fd67a51a5bba9e2c642d38629d28253e0249dc), [`c194003`](https://github.com/emmanuel-musau/cardano-slips/commit/c194003eeb2a68889a1bfe470b58ce000c7e459d), [`ce87c87`](https://github.com/emmanuel-musau/cardano-slips/commit/ce87c8787b93e4a3bde69776baa65f73b87c2f28), [`2241678`](https://github.com/emmanuel-musau/cardano-slips/commit/2241678462552eeec34d3c390893f072bb701fff), [`d1fdef8`](https://github.com/emmanuel-musau/cardano-slips/commit/d1fdef8a5863df9664dc3eea2d3a8a16e64b6589)]:
  - @cardano-slips/verifier@0.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [[`7c9d1fb`](https://github.com/emmanuel-musau/cardano-slips/commit/7c9d1fb608279b985f8bec062374550aee96967e), [`9ed2ff5`](https://github.com/emmanuel-musau/cardano-slips/commit/9ed2ff59a108a1c7b18823dca1f8c4e445ecf190), [`8d53fb2`](https://github.com/emmanuel-musau/cardano-slips/commit/8d53fb2e00e1953194f097b53bcb07d2911794ce), [`77ed6d9`](https://github.com/emmanuel-musau/cardano-slips/commit/77ed6d992549d8062cce55b5357c2941adad72c0)]:
  - @cardano-slips/verifier@0.1.0
  - @cardano-slips/core@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [[`a9c1c59`](https://github.com/emmanuel-musau/cardano-slips/commit/a9c1c59ba4174e4f5be63a0b195e7fd13d7498c9), [`81a35d2`](https://github.com/emmanuel-musau/cardano-slips/commit/81a35d28f7deee739c91ba7f9621619db2704c08), [`b29417c`](https://github.com/emmanuel-musau/cardano-slips/commit/b29417c5055b1edfc0f2a753456889e0267e2190)]:
  - @cardano-slips/core@0.1.0
  - @cardano-slips/verifier@0.0.2

## 0.0.1

### Patch Changes

- [#117](https://github.com/emmanuel-musau/cardano-slips/pull/117) [`8dae482`](https://github.com/emmanuel-musau/cardano-slips/commit/8dae482f99765f3afd1eec413e3389aab60fbeca) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core`, `verifier` and `server` carry, plus the two things only this package needs. React 19 is a peer dependency, and the sources compile through the automatic JSX runtime with React's types in place of Node's.
  
  Three tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/dependencies.test.ts` holds the architecture's dependency direction over the real code — no import of `server`, nothing imported that was not declared — and fails if React ever moves out of `peerDependencies`. `test/browser.test.tsx` renders a component to prove the JSX transform, React's types and the happy-dom environment agree with each other, and scans the sources for a Node builtin that would reach a bundler. No API yet — wallet discovery, balancing, the effects panel and the mismatch block land in their own issues.
