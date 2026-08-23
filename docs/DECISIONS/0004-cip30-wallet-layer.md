# ADR-0004: Build the CIP-30 layer on evolution-sdk, not cardano-connect-with-wallet

**Status:** Proposed
**Date:** 2026-08-19
**Issue:** TBD — `packages/flow` wallet layer

## Context

`packages/flow` needs a CIP-30 layer: discover and enable a wallet, then
`getUtxos`, `getChangeAddress`, `getUsedAddresses`, `getCollateral`,
`getNetworkId`, `signTx`, witness-set assembly, and `submitTx`.

Two constraints dominate every other consideration.

**The verifier decodes the transaction itself.** `packages/verifier` is a
pure function of (tx CBOR, declared metadata, user addresses). Any wallet layer
that hands us its own parsed abstraction instead of raw CBOR hex breaks the
thing that makes this protocol different from Solana Actions: we *derive* the
transaction's effects rather than trusting a simulation. Raw CBOR access is not
a preference, it is the product.

**The SDK ships into third-party pages we do not control.** It cannot assume a
framework, cannot claim global state, and cannot throw when evaluated outside a
browser — a large share of host pages are server-rendered.

We already depend on `@evolution-sdk/evolution` for transaction construction.
The question is whether to add `@cardano-foundation/cardano-connect-with-wallet-core`
alongside it, or to write a thin wrapper of our own over the gap.

All findings below come from reading the shipped source and type declarations of
`@evolution-sdk/evolution@0.5.12` and
`@cardano-foundation/cardano-connect-with-wallet-core@0.2.12`, installed in a
scratch directory, plus a compile and a runtime import under this repo's
`tsconfig.base.json` settings.

### What evolution-sdk already provides

This turned out to answer most of the question. evolution-sdk covers the entire
transaction path, and it does so without wrapping the CIP-30 object away from us.

`Client.make(chain).withCip30(api)` accepts a raw CIP-30 `WalletApi`. The
returned `ApiWallet` keeps that object reachable as `wallet.api`, so the raw
CBOR path is never closed off. Verified by compiling against the declarations:

| Need | evolution-sdk surface | Returns |
|---|---|---|
| Raw UTxOs | `wallet.api.getUtxos()` | `Promise<ReadonlyArray<string>>` — CBOR hex |
| Typed UTxOs | `wallet.getUtxos()` | `ReadonlyArray<UTxO>` |
| CBOR → UTxO | `cip30UtxoFromCBORHex(hex)` | `UTxO` — exported, usable standalone |
| Raw signing | `wallet.api.signTx(hex, true)` | `Promise<string>` — witness set CBOR hex |
| Typed signing | `wallet.signTx(tx)` | `TransactionWitnessSet` |
| Submit | `wallet.submitTx(tx)` | `TransactionHash` |
| Addresses | `getUsedAddresses` / `getUnusedAddresses` / `getRewardAddresses` | `ReadonlyArray<string>` |
| Batch signing | `wallet.signTxs(txs)` | CIP-103, with sequential fallback |

Two properties matter beyond the table. `signTx` returns a
`TransactionWitnessSet`, never a signed transaction — invariant 4 is the
library's own shape, not something we have to enforce on top of it. And
`cip30Wallet` already fails on a network mismatch, comparing the network id
derived from the wallet's address against the configured chain.

It is also the same Effect version, the same error idiom, and the same
TypeScript baseline we already mirror per ADR-0003.

### What evolution-sdk does not provide

Five gaps, all upstream of or adjacent to `enable()`:

1. **No wallet discovery.** Nothing enumerates `window.cardano`, calls
   `.enable()`, or carries wallet display names. `withCip30` expects a live API
   object and it is the caller's job to obtain one.
2. **No `getChangeAddress`** on the `WalletApi` interface.
3. **No `getCollateral`** on the `WalletApi` interface.
4. **No CIP-30 `getNetworkId()`.** Network is inferred from the address bech32
   rather than asked for directly.
5. **One flat error type.** Every failure collapses into a single `WalletError`
   carrying a message string and a `cause`. The CIP-30 `{ code, info }` object
   survives only inside `cause`, untyped.

Gaps 2–4 are narrower than they look. Because *we* call `.enable()` and hold the
resulting object, the runtime value is the full CIP-30 API regardless of what
evolution-sdk's interface declares. We can call those three methods on it under
our own typing without patching upstream.

### Evidence: cardano-connect-with-wallet-core

**1. Raw CBOR access — disqualifying.** The library does not expose the
transaction path at all. Its entire public surface is `connect`, `disconnect`,
`getInstalledWalletExtensions`, `getRewardAddresses`, `signMessage`,
`clearLocalStorage`, event listeners, and observables. There is no `getUtxos`,
no `signTx`, no `submitTx`, no `getChangeAddress`, no `getCollateral`, no
`getNetworkId` anywhere in the shipped source.

The enabled CIP-30 object is reached through `private static async unwrapApi()`,
called in exactly two places — `getRewardAddresses` and `signMessage`. It is
never returned to the caller. The exported `Cip30Function` type is a union of
method *name* strings used for capability labelling; it is not an API.

This is not "returns its own abstraction instead of raw CBOR." It is a connect
-and-sign-message library that stops before the transaction path begins. On the
stated criterion it is disqualified, and the remaining criteria are recorded
only because the evaluation asked for them.

**2. Witness-set assembly.** Not applicable — there is no signing path to
assemble from. (Neither library assembles witnesses into the body; that stays
ours either way.)

**3. Framework independence.** The "framework-independent" claim is true in the
narrow sense — there is no React import, and the observable is a 30-line
hand-rolled class. It is false in the sense we care about. `Wallet` is a class
of `static` members: one global singleton per page, with no way to run two
instances or scope state to our SDK. It persists to `window.localStorage` under
`cf-wallet-connected`, `cf-last-connected-wallet`, and `cf-requested-extensions`,
and calls `window.dispatchEvent(new Event('storage'))`. Injected into a host
page, it writes keys into that origin's storage and fires global events the host
also listens to. That is not something we can ship into a page we do not own.

**4. Bundle size and dependency tree.** 1.7 MB installed marginal cost — 760 KB
for the package (576 KB `dist/`, a single 126 KB webpack UMD bundle plus a
367 KB source map, and roughly 50 KB of base64 wallet icons compiled into the
type declarations), plus `cborg` (880 KB), `buffer` (104 KB), and `bech32`
(24 KB). We would be pulling in a second CBOR implementation alongside the one
in evolution-sdk, and a `Buffer` polyfill.

**5. ESM + NodeNext + strict TS — fails at runtime.** The package declares no
`"type": "module"` and no `exports` map; `main` points at a webpack UMD bundle.
Types resolve under NodeNext with `skipLibCheck` on, so it compiles. It does not
run:

```
$ node --input-type=module -e "await import('@cardano-foundation/cardano-connect-with-wallet-core')"
IMPORT FAILED: window is not defined
```

The cause is a static class-property initializer evaluated at module load:

```ts
class Wallet {
  static isConnecting: Observable<boolean> = new Observable<boolean>(
    Boolean(window.localStorage.getItem('cf-wallet-connected')),
  );
```

The module cannot be imported outside a browser at all — not in Node, not in a
test runner without jsdom, not in any server-rendered host page. For a library
whose job is to be embedded in other people's sites, this alone would rule it
out.

**6. Wallet coverage.** 11 registry entries: `nami`, `typhoncip30`,
`gerowallet`, `nufi`, `lace`, `eternl`, `vespr`, `begin`, `yoroi`, `flint`,
`peer-connect`. All five wallets we care about — Lace, Eternl, Vespr, Typhon,
Nami — are present. Unknown wallets are handled reasonably: the registry drives
display metadata, and a wallet with no entry falls back to the icon the
extension injects at `window.cardano[key].icon`. Adding a wallet is a one-file
change. This is the library's genuinely good part, and it is the part that is
easiest to reproduce.

**7. Error types.** Seven `Error` subclasses, all about connection:
`WalletConnectError`, `WrongNetworkTypeError`, `WalletNotCip30CompatibleError`,
`ExtensionNotInjectedError`, `WalletNotInstalledError`,
`WalletExtensionNotFoundError`, `EnablementFailedError`. Of the four states we
need to distinguish, it covers wallet-not-found and network-mismatch, and cannot
cover user-rejected-signature or UTxOs-changed-mid-flow because it has no
signing path. CIP-30 numeric codes are flattened into human-readable message
strings at construction.

**8. Maintenance.** Active but low velocity. Last publish 2026-05-16 (0.2.12),
last repo push the same day, 90 stars, 4 open issues, releases automated with
release-please. Not parked, not abandoned — but three months quiet and clearly
not on a path toward covering transaction signing.

**9. Licence.** Apache-2.0. Permissive and compatible with shipping inside an
MIT project; it would add a NOTICE obligation and patent-grant terms that MIT
does not carry. Not a blocker, and moot given the recommendation.

## Decision

**Do not adopt `@cardano-foundation/cardano-connect-with-wallet-core`, in whole
or in part.** Build the CIP-30 layer on `@evolution-sdk/evolution`, and write a
thin wrapper of our own for the discovery-and-enable gap.

The split:

- **Ours** — `window.cardano` enumeration, a wallet registry (name, display
  name, icon, install link), `enable()` with CIP extension negotiation, and a
  set of typed errors that preserves the CIP-30 `{ code, info }` object.
  No global state, no `localStorage`, no module-scope browser access; every
  entry point takes an explicit `window`-like reference or lazily reads it
  inside a function.
- **evolution-sdk** — everything downstream of `enable()`. We pass the raw API
  into `Client.make(chain).withCip30(api)` and keep `wallet.api` as the raw CBOR
  path feeding `packages/verifier`.

`getChangeAddress`, `getCollateral`, and `getNetworkId` are called on the raw API
object under our own CIP-30 interface. Where that interface should live upstream
instead, we raise it against evolution-sdk — the maintainer of that SDK is this
project's author, so the fix path is direct rather than a fork or a patch.

Witness-set assembly stays ours in either case, per invariant 4.

## Alternatives considered

**Adopt connect-with-wallet-core wholesale.** Rejected on criterion 1: it has no
transaction path to adopt. Independently fatal: it throws `window is not defined`
on import, and it claims page-global `localStorage` keys.

**Adopt it partially, for discovery and the wallet registry only.** The most
tempting option, because the registry is the one part that is genuinely useful
and the part we will otherwise hand-maintain. Rejected anyway: the registry is
not separable. It ships from the same entry point as the `Wallet` singleton, so
importing it evaluates the static initializer and throws outside a browser.
Taking it means taking 1.7 MB, a second CBOR implementation, a `Buffer` polyfill,
and host-page storage writes — to avoid writing a list of eleven wallets. We
will instead maintain our own registry and consult theirs as prior art when
adding entries; the data is public and the shape is a good model.

**Write the whole CIP-30 layer ourselves, ignoring evolution-sdk's wallet
module.** Rejected as duplicated work with no upside. `cip30Wallet` already does
the CBOR decode, the witness-set decode, the network check, and CIP-103 batch
signing, in the Effect idiom we already use. Reimplementing it would mean a
second CBOR decode path in a codebase whose central claim is that it decodes
transactions correctly.

**Fork or patch evolution-sdk to add the missing methods.** Unnecessary. The
gaps are additive interface declarations, and we can call the methods on the raw
API object today. Where upstream should carry them, we contribute upstream.

## Consequences

**Easier.** One wallet dependency, one mental model, one CBOR implementation.
Raw CBOR hex stays reachable at every step, so `packages/verifier` keeps its pure
signature and its attack examples keep testing what actually reaches the
wallet. Invariant 4 falls out of evolution-sdk's own return type rather than
being enforced by us. Our error codes are designed for the four UI states we
actually need instead of inherited from a connection-only library.

**Harder.** We own the discovery layer: the wallet registry, install links, and
icons become ours to maintain as wallets come and go. That is real recurring
work, and it is the one thing connect-with-wallet-core would have given us. We
also own a small CIP-30 interface declaring `getChangeAddress`, `getCollateral`,
and `getNetworkId` until those land upstream — a typing we assert rather than
one the SDK guarantees, so it needs a test against a stubbed CIP-30 provider.

**Foreclosed.** Nothing structural. The wrapper is small and sits behind our own
interface, so replacing it later touches one module. Reversing this decision is
cheap in a way that adopting a page-global singleton would not have been.

**Testing.** Per the client bar in CLAUDE.md, the wallet flow is tested against a
stubbed CIP-30 provider. Specifically: each error code is reachable
and preserves its CIP-30 code; discovery is verified with zero, one, and several
injected wallets, and with an unknown wallet key; and the module is proved
importable in a non-browser environment — a test that fails if anyone reintroduces
module-scope `window` access.

## What would make us revisit

- connect-with-wallet-core exposes the enabled CIP-30 API object publicly and
  becomes importable outside a browser. Both would have to be true; either alone
  is insufficient.
- The wallet registry becomes a standalone, side-effect-free package we can
  depend on for data without the singleton.
- Maintaining discovery and the registry ourselves proves more expensive than
  estimated — say, more than a couple of hours a quarter chasing wallet changes.
- evolution-sdk absorbs discovery and `enable()`, at which point our wrapper
  shrinks to nothing and should be deleted.
