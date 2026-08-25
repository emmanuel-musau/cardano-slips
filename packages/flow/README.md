# @cardano-slips/flow

The client side. It resolves a Slip link, renders it, connects a wallet, balances the transaction against the person's own UTxOs, derives what that transaction actually does, and refuses to ask for a signature when the answer disagrees with what the endpoint declared.

```
pnpm add @cardano-slips/flow react
```

## What it does

| Step | What happens |
| --- | --- |
| resolve | the shared link through `slips.json`, then `GET` for the Slip's metadata |
| render | the card, the parameter form generated from what the endpoint declared, and the wallet selector |
| build | `POST` for the publisher's side of the transaction |
| balance | locally, against the wallet's own UTxOs — the endpoint never sees them |
| derive | what the built transaction does, from its bytes |
| compare | against the intent, and block on any disagreement |
| sign | `signTx` → assemble the witness set into the body → `submitTx` |

`useSlip`, `useWallet` and `useEffects` are the composable surface for anyone who wants the machinery without our components.

## It refuses; it does not decide

The comparison is `verifier`'s, and it is a pure function so the attack examples run the same code path a real signature does. This package is the consequence of a verdict: a mismatch renders as a block with no control to press. There is no override to configure — not a setting, not an allowlist, not a confirmation. See [Blocking](../../spec/CIP-XXXX/README.md#blocking).

## It does not own the page

These components are meant to be dropped into someone else's page. No fixed positioning, no assumption about the document, and styles that survive an inherited font stack. `tokens.css` holds the design tokens as CSS custom properties and is the only place a colour is defined.

React is a **peer** dependency: your copy is the one that renders, and a second copy in the tree is the oldest breakage in the ecosystem.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/flow"
```

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
