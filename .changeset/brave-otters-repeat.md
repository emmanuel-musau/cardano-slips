---
"@cardano-slips/server": minor
---

Add `toNodeHandler`, the bridge for NestJS and Express.

Those frameworks serve Node's `IncomingMessage`/`ServerResponse` rather than the Web `Request`/`Response` that `defineSlip` returns. `toNodeHandler(endpoint, { origin })` returns one function they both mount directly. It ships as its own entry, `@cardano-slips/server/adapters/node`, so the package root stays free of Node's types for the runtimes that need no adapter at all.

It reads the body from wherever a framework left it — a parser that already ran leaves the stream drained and the value on `req.body`, and reading the stream again would hang — carries matched route parameters into the handlers as `params`, and reads the path from `req.originalUrl` where a framework rewrote `req.url` for a mounted handler. Request headers reach the handlers, less the hop-by-hop ones. `HEAD` answers as the `GET` does without the body.

The origin is required, either stated outright or opted into with `originFromHeaders: true`, and only the path and query are ever taken from the request. `Host` and `X-Forwarded-Host` are the client's to set, and the origin both reaches the publisher's handlers as `context.url` and fixes what counts as same-origin when a linked action is checked, so neither a spoofed header nor a protocol-relative target can move it.
