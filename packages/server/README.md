# @cardano-slips/server

The publisher side. You write the two handlers a Slip endpoint needs; this validates what they return against the spec's own schemas before it goes on the wire, sets the headers a browser client cannot work without, and maps a failure to the status the spec pairs with it.

```
pnpm add @cardano-slips/server
```

## What it is for

A Slip endpoint is `GET` describing an intent and `POST` returning the publisher's side of a transaction. Both shapes are normative and both are easy to get subtly wrong — a missing `Access-Control-Allow-Origin`, an amount sent as a JSON number, a sold-out option reported as a `409` when the spec says answer `200` with `disabled`.

```ts
defineSlip({ get, post })
```

Every response the handlers produce is checked against the `core` schemas on the way out. A publisher who declares a shape version 1 does not define fails at their own boundary, at their own deploy — not at a stranger's wallet, where the same mistake arrives as a Slip that will not load and a person with nothing to act on.

## What ships in M1

One framework adapter: Next.js App Router. Route handlers for `GET`, `POST` and the `OPTIONS` preflight a JSON body makes mandatory, `slips.json` serving from the origin root, and the spec's failure codes mapped to their HTTP status. Hono and Express adapters are deferred — see [ARCHITECTURE](../../docs/ARCHITECTURE.md).

## What it will never import

`flow` or `verifier`. A dApp shipping an endpoint should get a request handler, not a React tree and not a CBOR decoder, and the dependency rule that says so is in [ARCHITECTURE](../../docs/ARCHITECTURE.md#dependency-rules). `test/dependencies.test.ts` is what keeps it true rather than intended.

It also holds no keys and signs nothing. An endpoint returns an unsigned partial intent; the person's own wallet is the only thing in this protocol that signs.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/server"
```

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
