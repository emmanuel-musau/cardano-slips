# ADR-0005: Name packages for the job they do, not the tier they sit in

**Status:** Accepted
**Date:** 2026-08-20
**Issue:** TBD — package rename

## Context

The five workspace packages were originally named by tier: `core`, `server`,
`effects`, `identity`, `client`. Two of those names were wrong in ways that get
more expensive the longer they stand.

**`effects` collided with the stack.** `Effect` is the TypeScript library this
repo is built on. Every file in `core` and `server` imports from `effect`, and a
file that imports from both `effect` and `@cardano-actions/effects` is
gratuitously confusing. The name was also borrowed vocabulary from Solana
Actions, and it described the package's output rather than its job — "effects"
reads as a passive data structure, when the package returns a verdict that
hard-blocks a signature.

**`client` was ambiguous and too narrow at once.** In Cardano, "client" most
often means a node client. The word is also load-bearing protocol vocabulary in
our own spec — a *client* is anything that renders a link and drives the wallet
handoff, of which the package is only one implementation. Having the package and
the protocol role share a name makes both harder to write about.

Nothing is published to npm and no `packages/` directory exists yet, so the
rename costs three document edits today. After the M1 release (#70) it costs
deprecated packages, redirect stubs, a documentation rewrite, and a CIP that
already cites the old names in public.

## Decision

Packages are named for the job they do. The `@cardano-actions` scope already
carries the domain, so the package half is free to be a plain verb or agent
noun, and names that restate the domain (`action-verifier`) stutter and are
rejected.

| Package | Was | Does |
|---|---|---|
| `@cardano-actions/core` | — | the shared contract: schemas, URL rules, error codes |
| `@cardano-actions/server` | — | publish an action endpoint |
| `@cardano-actions/verifier` | `effects` | derive what the transaction really does, block signing if the metadata lies |
| `@cardano-actions/flow` | `client` | run the user through it, drive the wallet |
| `@cardano-actions/identity` | — | prove who is asking |

`core`, `server` and `identity` keep their names: they are already plain, and
`core`/`server` correctly describe *where the code runs*, which is the axis this
architecture is organised around.

**The rename covers package identifiers only.** `effects` and `client` remain
protocol vocabulary and are not renamed anywhere they carry that meaning:
*derived effects*, *the effects panel*, *the effects model*, *effects
derivation*, *client-side balancing*, and *client* as the role defined in
REQUIREMENTS §2 all stand. In writing, a backticked `` `verifier` `` is the
package; unbackticked "effects" is the concept it computes.

## Alternatives considered

**Keep `effects`.** It is the term of art in the transaction-safety space
(Blowfish, Wallet Guard and others all speak of transaction effects), so there is
a discoverability argument for wallet teams evaluating the engine standalone.
Rejected because the `effect` library collision is a daily cost paid by every
contributor, while discoverability is a one-time cost paid in a README line.

**`@cardano-actions/preview`.** The strongest layman candidate and the actual
industry term. Rejected outright: Cardano has a testnet named Preview, so the
package would read as network-specific tooling.

**`@cardano-actions/engine`.** Short and weighty, and the docs already call this
"the security engine". Rejected because it says nothing about what the engine
does, which was the whole complaint against `effects`.

**`gate`, `inspector`.** `gate` is the most accurate description of the
consequence but names only the compare half, leaving the derivation — the novel
half — unnamed. `inspector` is unambiguous but passive, implying an advisory
tool rather than a blocking one. `verifier` is the only candidate that is an
agent noun (so it reads as machinery), a plain verb root, and descriptive of the
whole job.

**`@cardano-actions/react` for the client package.** Follows a strong ecosystem
convention and is maximally explicit. Rejected because the package is CIP-30
orchestration *plus* React components, and the orchestration half is not
framework-bound — `react` would misname the majority of the code.

**`checkout`, `frontend`, `wallet`.** `checkout` is the most layman but implies
commerce, and delegation is a headline action type that is not a purchase.
`frontend` is a lateral move that swaps one location word for a plainer one
without adding information. `wallet` was rejected on safety grounds: nothing here
holds funds, and the name invites exactly the assumption the project exists to
refuse.

## Consequences

Package names now survive a cold read. `pnpm add @cardano-actions/verifier`
tells a wallet team what they are getting without opening the README, which
matters because standalone adoption of the engine is an argument in the CIP.

The signature-verification ambiguity in `verifier` is real and accepted: in a
Cardano context "verify" can suggest signature verification, which this package
does not do. It resolves on one line of README, and the cost was judged lower
than `inspector` permanently misrepresenting a blocking gate as advisory.

`flow` claims the whole browser-side surface. If the CIP-30 orchestration later
needs to be consumable without the React components, that is a subpackage split
(`flow` plus a `flow/react` entry point) rather than another rename — decide it
inside `flow`'s boundary, not by renaming again.

Reversing this is free until #70 publishes to npm and cheap until the CIP PR
(#71) is filed. After the CIP is public the names are effectively permanent,
because a third-party implementer reading the CIP will cite them.
