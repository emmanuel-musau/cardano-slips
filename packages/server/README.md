# @cardano-slips/server

The publisher side. You write the two handlers a Slip endpoint needs; this validates what they return against the spec's own schemas before it goes on the wire, sets the headers a browser client cannot work without, and maps a failure to the status the spec pairs with it.

```
pnpm add @cardano-slips/server
```

## What it is for

A Slip endpoint is `GET` describing an intent and `POST` returning the publisher's side of a transaction. Both shapes are normative and both are easy to get subtly wrong — a missing `Access-Control-Allow-Origin`, an amount sent as a JSON number, a sold-out option reported as a `409` when the spec says answer `200` with `disabled`.

```ts
// app/api/slips/pay/route.ts
export const { GET, POST, OPTIONS } = defineSlip({
  network: "mainnet",

  get: () => ({
    title: "Pay 12.00 USDM to Corner Store",
    description: "One payment to the shop's address. Nothing is stored, no account is created.",
    icon: "https://linktap.example/i/corner-store.png",
    label: "Pay 12.00 USDM"
  }),

  post: ({ changeAddress }) => ({
    intent: {
      outputs: [{ address: shop, lovelace: "0", assets: [usdm("12000000")] }],
      validUntil: inTenMinutes()
    }
  })
})
```

`type`, `version` and `network` are filled in, and a handler cannot restate them: one URL speaks one major version and serves one network, so there is nothing for a response to disagree with. A handler returns `fail("UNAVAILABLE", "Sold out for today.")` where a request cannot be answered, and a `disabled` Slip with its `reason` where the endpoint answers fine and there is currently nothing to sign — the spec keeps those apart, and so does this.

Every response the handlers produce is checked against the `core` schemas on the way out — the failure bodies included. A publisher who declares a shape version 1 does not define fails at their own boundary, at their own deploy — not at a stranger's wallet, where the same mistake arrives as a Slip that will not load and a person with nothing to act on.

## What ships in M1

Route handlers for `GET`, `POST` and the `OPTIONS` preflight a JSON body makes mandatory, `slips.json` serving from the origin root, and the spec's failure codes mapped to their HTTP status.

An endpoint written in something other than TypeScript does not need this package. The payload shapes are normative and published as JSON Schemas in [`spec/CIP-XXXX/schemas/`](../../spec/CIP-XXXX/schemas); a Laravel or Go endpoint validating against those conforms exactly as well as one built here. That is the protocol working, not a gap in it.

## Mounting it on Next.js

The App Router asks for exactly what `defineSlip` returns, so a route file is the destructure and nothing else:

```ts
// app/api/slips/pay/route.ts
export const { GET, POST, OPTIONS } = defineSlip({ ... })
```

**A route with dynamic segments** gets them as `params`, already resolved — Next 15 and 16 hand them over as a promise, 13 and 14 as a plain object, and both arrive here the same way:

```ts
// app/api/slips/pay/[handle]/route.ts
export const { GET, POST, OPTIONS } = defineSlip({
  network: "mainnet",
  get: ({ params }) => shopCard(params.handle as string),
  post: ({ params, changeAddress }) => payment(params.handle as string, changeAddress)
})
```

A catch-all segment matches more than one, so a value is `string | readonly string[]` and a route that uses one has to say which it expects. On a route with no dynamic segment `params` is `{}`.

**`slips.json` goes at the origin root**, which is a route segment named for the file:

```ts
// app/slips.json/route.ts
export const { GET } = defineDomainMapping({
  rules: [{ pathPattern: "/pay/*", apiPath: "/api/slips/pay/*" }]
})
```

The rules are fixed at deploy, so they are decoded when the module loads: a mapping the spec rejects throws where the publisher can see it rather than serving a file no client will accept. `Cache-Control: public, max-age=300` is the default, matching the spec's own example; pass `{ maxAge }` to change it. There is no `OPTIONS` here on purpose — a `GET` carrying only `Accept` is a simple request, so a browser never preflights it.

Both route shapes and the `params` typing are verified against Next 16.3.3. Serving the mapping from `public/slips.json` instead works too, but then the CORS header is yours to add in `next.config`, and a mapping the spec rejects ships silently.

## Mounting it anywhere else

`defineSlip` returns `(Request) => Promise<Response>`, so any runtime built on those needs no adapter — Hono, SvelteKit, Remix, Bun, Deno and Cloudflare Workers all take these handlers directly.

## Mounting it on NestJS, Express or Fastify

These serve Node's `IncomingMessage`/`ServerResponse` rather than the Web pair, so they get a bridge. `toNodeHandler` returns one function, and both frameworks mount it the same way:

```ts
// Express
const handler = toNodeHandler(endpoint, { origin: "https://linktap.example" })

app.use(express.json())
app.all("/api/slips/pay/:handle", handler)
```

```ts
// NestJS
const app = await NestFactory.create(AppModule)
app.use("/api/slips/pay", toNodeHandler(endpoint, { origin: "https://linktap.example" }))
```

It handles the two things that break a naive bridge. A body parser that already ran — `express.json()`, and Nest's, which is on by default — leaves the stream drained and the parsed value on `req.body`, and reading the stream again would hang forever; this takes the body from wherever it actually is. And route parameters a framework matched (`req.params`) arrive in the handlers as `params`, the same way a Next dynamic segment does.

**The origin is yours to state, and that is deliberate.** `toNodeHandler` refuses to be built without either an `origin` or `originFromHeaders: true`. `Host` and `X-Forwarded-Host` are the client's to set: the origin reaches your own handlers as `context.url`, and it fixes what counts as same-origin when a linked action's `href` is checked. Behind a proxy that overwrites those headers, `originFromHeaders` is fine. Exposed to whatever a request claims, it is a header away from your endpoint describing itself as somewhere else. Naming the origin costs one line and removes the question.

A `POST` body is bounded at 64 KiB, since a conforming one is two short strings — pass `maxBytes` to change it. Anything else is `405` with an `Allow` header.

Verified against Express 5 and NestJS 11 on Node 22.

## What it will never import

`flow` or `verifier`. A dApp shipping an endpoint should get a request handler, not a React tree and not a CBOR decoder, and the dependency rule that says so is in [ARCHITECTURE](../../docs/ARCHITECTURE.md#dependency-rules). `test/dependencies.test.ts` is what keeps it true rather than intended.

It also holds no keys and signs nothing. An endpoint returns an unsigned partial intent; the person's own wallet is the only thing in this protocol that signs.

## Entry point

One export, the package root. Deep imports into `dist/` are not a supported surface, so moving a file is never a breaking change:

```ts
import { ... } from "@cardano-slips/server"
```

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
