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

## Components

```tsx
import { SlipCard } from "@cardano-slips/flow"
import "@cardano-slips/flow/tokens.css"
import "@cardano-slips/flow/card.css"

<SlipCard slip={slip} discoveryUrl={url} onSubmit={({ href, values }) => …} />
```

`SlipCard` renders what the endpoint declared — icon, title, description, and a button per linked action — generates the form its parameters describe, and hands you the `POST` target once every value passes. `SlipCardSkeleton` holds the same box while the metadata is in flight; `SlipCardError` replaces it when the endpoint never answered.

The card makes no claim about the transaction. Title and description are the publisher's words, and checking them against what the transaction actually does is the effects panel's job — against the bytes, not against this card.

Nothing here decides for a person on the endpoint's behalf: a value that fails `required`, `min` or `max` is caught before anything is sent, in `core`'s own sentence, so the same bad value reads identically in every client. A field the endpoint itself refuses lands on that field and leaves the card standing, and what was typed stays typed.

### Restyling

`card.css` is optional. Import it and you get the design sheet; skip it and you get the markup, where every element carries a class of ours and nothing else:

| Class | What it is |
| --- | --- |
| `slip-card` | the card, and `slip-card--loading` / `slip-card--failed` for the other two; `data-closed` marks a Slip that cannot be signed and `data-busy` one with a request in flight |
| `slip-card__head`, `__icon`, `__title`, `__origin`, `__description` | what the endpoint declared |
| `slip-card__actions`, `__action` | the buttons; `data-primary` marks the one that is emphasised |
| `slip-card__reason`, `__note` | why an action is closed, and the promise the card makes |
| `slip-fields`, `slip-field`, `slip-field__*` | the generated form; `data-invalid` marks a field that was rejected |

The card is the publisher's surface and is meant to be restyled. The chrome that judges it — the effects panel, the mismatch block, the network indicator — is not, hosted or self-hosted: a publisher who can restyle the surface that judges them makes the verdict look like something they control.

## Tokens

```ts
import "@cardano-slips/flow/tokens.css"
```

```html
<div class="slip-root">…</div>
```

The tokens are scoped to `slip-root` rather than `:root`, because a package that writes `--ink` onto the document redefines whatever the host already called that. Every component of ours puts the class on its own root, so an embedded card carries its tokens with it. There is no reset in the file and no rule that selects an element, so an inherited font stack stays where it is until something of ours asks for a token.

There is one theme. The design sheet collapsed an earlier light/dark pair into a single ground that leans light, so there is no `data-theme` and no role that means two things — a component that can ask which theme it is in is a component that will answer differently from the next one. What carries the weight instead is that the three families of surface are genuinely different surfaces:

| Family | What it is |
| --- | --- |
| `--page`, `--card` | the ordinary ground, and what lifts off it |
| `--vault-*` | the transaction preview, on slate — the one grave surface, and the reason the rest can stay bright |
| `--dark-*` | code blocks and the Open Graph card, fixed wherever they appear because neither sits on a ground we control |

There is one typeface, Poppins, and one token naming it. The package does not fetch it — a stylesheet that reaches a third-party CDN makes a privacy and performance decision that belongs to whoever owns the page — so load Poppins yourself, or take the `system-ui` the stack falls back to. Type arrives as whole roles — `font: var(--type-card-title)` carries family, weight, size and line-height together — because a role is a pairing, not a size, and because a component that can apply the size without the family is a component that will. What separates a title from a label is weight and size; there is no second face to reach for, and `--type-technical` is the role for text meant for a machine — an address, a hash, an error code.

Depth is a border; there is no shadow token. Buttons are outlined rather than filled: the accent is the label and the edge, not the ground.

Three rules the tests keep: no colour is written anywhere but `tokens.css`, every `var(--…)` a stylesheet reaches for is a token that exists, and the design sheet's contrast audit is recomputed against these values rather than trusted — which is how `--vault-bad` came to be a shade lighter here than on the sheet, where the value drawn measures 4.42:1 on the preview surface under a row labelled a pass. `--accent-fill` is a fill — it does not clear AA on a light card, which is why `--accent-text` exists for any accent-coloured word, and it stays a fill on the preview surface where the ratio alone would allow otherwise.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/flow"
```

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
