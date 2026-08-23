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

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
