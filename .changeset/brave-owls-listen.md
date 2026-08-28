---
"@cardano-slips/server": minor
---

Add `defineSlip` — two handlers in, a conforming Slip endpoint out.

`GET`, `POST` and the `OPTIONS` preflight are returned ready to export from a route file. A publisher writes what their Slip says and what their transaction does; `type`, `version` and `network` are filled in and cannot be restated by a handler, the spec's headers are set on every path — `Access-Control-Allow-Origin` on the failures too, without which a browser withholds the body of the very failures a person could have corrected — and a partial intent is sent `no-store`, because one is built for a single person against a single address and expires.

Nothing leaves without being decoded first. A discovery response goes through `decodeSlip` and then `checkTemplates`, so an `href` pointing off the publisher's own origin is caught here rather than at a stranger's wallet; a partial intent goes through `decodePartialIntent`; and the failure body is held to `decodeEndpointError` on the way out, so a publisher's own malformed failure is replaced rather than sent. Every one of those defects becomes a `500 INTERNAL_ERROR` with a fixed message and is reported to the publisher instead — as is anything a handler throws. A connection string in an exception is exactly the internal detail the spec forbids in a `message`, so the wire never carries it.

`POST` reads its body through `decodeBuildRequest` before a handler runs, and enforces the three statements of network the spec requires to agree: the network the endpoint declares, the network the request states, and the network the change address encodes. Any disagreement is `WRONG_NETWORK`, which is where a stale card and a wallet switched mid-flow both surface.

A request that cannot be answered is `fail("UNAVAILABLE", "Sold out for today.")`, mapped to the status the spec pairs with the code, with `Retry-After` where the publisher gives one — a whole number of seconds, because a client waits the interval that header names and `Retry-After: NaN` names none. An action that is merely closed stays a `200` with a complete body and `disabled` set — reporting that as a non-2xx turns a state the client can render into a failure a person meets only after committing.
