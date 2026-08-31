---
"@cardano-slips/server": minor
---

Add `toNodeHandler`, the bridge for NestJS, Express and Fastify.

Those frameworks serve Node's `IncomingMessage`/`ServerResponse` rather than the Web `Request`/`Response` that `defineSlip` returns. `toNodeHandler(endpoint, { origin })` returns one function they all mount directly. It reads the body from wherever a framework left it — a parser that already ran leaves the stream drained and the value on `req.body`, and reading the stream again would hang — and carries matched route parameters into the handlers as `params`.

The origin is required, either stated outright or opted into with `originFromHeaders: true`. `Host` and `X-Forwarded-Host` are the client's to set, and the origin both reaches the publisher's handlers as `context.url` and fixes what counts as same-origin when a linked action is checked, so deriving it from a request is a choice rather than a default.
