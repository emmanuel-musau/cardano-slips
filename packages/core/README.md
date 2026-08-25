# @cardano-slips/core

The shared contract every other Cardano Slips package is written against: the payload schemas, the URL resolution rules, and the error codes.

`server` validates against these schemas before a response leaves the endpoint; `flow` validates against the same ones before it renders anything. That is what makes the schema the executable form of the [spec](../../spec/CIP-XXXX/README.md) rather than a second description of it that can drift.

```
pnpm add @cardano-slips/core
```

## What it owns

| Concern | Covers |
| --- | --- |
| Types | `Slip`, `Parameter`, `PartialIntent`, `DerivedEffects` |
| URLs | parse, resolve and validate Slip URLs |
| `slips.json` | the domain mapping rules, so `linktap.example/pay/corner-store` resolves to `/api/slips/pay` |
| Errors | the typed error codes — every failure a client has to render has a code here |

It depends on no other workspace package and holds no wallet, network or React code. A tool that only needs to read a Slip endpoint can take this package alone.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/core"
```

## Reading a discovery response

`decodeSlip` returns an `Either` rather than throwing: it runs on whatever an endpoint chose to send, which makes failure an ordinary outcome. A member the protocol does not declare is rejected wherever it appears — a member silently ignored is a claim about the transaction that nothing checked, and it is why the protocol has major versions and no minor ones.

```ts
import { Either } from "effect"
import { classifyErrorCode, decodeSlip, decodeSlipError, PROTOCOL_VERSION } from "@cardano-slips/core"

const body = await (await fetch(url)).json()
const slip = decodeSlip(body)

if (Either.isRight(slip) && slip.right.version === PROTOCOL_VERSION) {
  render(slip.right)
}
```

A failed request carries its own shape. `decodeSlipError` constrains `code` to the shape of a code rather than to the list, so a publisher's `message` survives a code this version does not define; `classifyErrorCode` says what to do next — act, stop, or retry — and calls anything undefined terminal.

Some rules no schema can check, because they need context no payload carries: an `href` on another origin, a `max` below its `min`, a `{placeholder}` naming no parameter. Those arrive with URL resolution and parameter interpolation. Decoding is the first line of defence, not the whole of it.

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
