---
"@cardano-slips/core": minor
---

Add Effect Schema definitions and types for the GET discovery response and the failure body.

`decodeSlip` decodes an endpoint's metadata — parameters, linked actions, the `disabled`/`reason` pair — rejecting any member the protocol does not declare, at whatever depth it appears. `decodeSlipError` and `decodeEndpointError` are the two sides of the failure body: an endpoint may send only the eight codes version 1 allows it, while a client reads any well-shaped code so a publisher's message survives one this version does not define. `errorCodeClass`, `endpointErrorStatus`, `classifyErrorCode` and `classifyStatus` carry the vocabulary itself, checked against the table in the CIP.

Both schemas are run against the payloads published under `spec/examples`, so the decoder and the specification cannot drift apart quietly.
