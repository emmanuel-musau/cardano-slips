# @cardano-slips/core

## 0.1.0

### Minor Changes

- [#121](https://github.com/emmanuel-musau/cardano-slips/pull/121) [`a9c1c59`](https://github.com/emmanuel-musau/cardano-slips/commit/a9c1c59ba4174e4f5be63a0b195e7fd13d7498c9) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Add Effect Schema definitions and types for the partial intent a Slip endpoint returns from `POST`.
  
  `decodePartialIntent` reads the publisher's side of a transaction — outputs, native assets, certificates, the rewards withdrawal and `validUntil` — and rejects any member the protocol does not declare, at whatever depth it appears. That is what keeps a declared fee, deposit or stake credential off the wire rather than silently ignored: each is fixed by the ledger or by the wallet, so a field to state one is a field to state one wrongly. Certificates are a union on `type`, so `poolId` is required by `stakeDelegation` and permitted nowhere else, and the same for `drep` and `voteDelegation`.
  
  Quantities are integer base units in decimal strings, with no field in which a publisher may state an asset's decimals. `validUntil` must name a real instant as well as match the published pattern — the pattern alone accepts `2026-02-31T00:00:00Z`, which JavaScript then reads as 3 March.
  
  The schema is run against the payloads under `spec/examples/partial`, including a round trip that encodes each one back to the bytes it arrived as.

- [#122](https://github.com/emmanuel-musau/cardano-slips/pull/122) [`81a35d2`](https://github.com/emmanuel-musau/cardano-slips/commit/81a35d28f7deee739c91ba7f9621619db2704c08) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Add the `slips.json` domain mapping: the schema, the fetch, and the resolution that turns a shared human URL into the endpoint behind it.
  
  `decodeSlipsJson` also refuses the two things the JSON Schema cannot see — an `apiPath` whose wildcards disagree with its `pathPattern`, and the same `pathPattern` declared twice — because both are visible in the payload and there is no later step that would catch them.
  
  `fetchDomainMapping` keeps the distinction the spec turns on: `404` and `410` mean the origin serves no mapping and the link is its own endpoint, while a timeout, a `5xx`, an oversized body or a refused request are `UNREACHABLE` rather than absent, and a file that arrives and does not conform is `MALFORMED_RESPONSE` with no fall back to the human path. It refuses a redirect that leaves the origin, and refuses any scheme but `https:`, admitting `http:` on a loopback host for development.
  
  `resolvePath` runs the resolution table the CIP publishes, including the cases that separate it from a naive rewriter: one hop with no re-matching of its own output, dot segments removed before matching, an encoded slash that stays inside its segment, and a trailing slash that is not equivalent to its absence. `resolveSlipUrl` takes the origin from the link and never from the file, which is what makes the same-origin constraint structural.

- [#120](https://github.com/emmanuel-musau/cardano-slips/pull/120) [`b29417c`](https://github.com/emmanuel-musau/cardano-slips/commit/b29417c5055b1edfc0f2a753456889e0267e2190) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Add Effect Schema definitions and types for the GET discovery response and the failure body.
  
  `decodeSlip` decodes an endpoint's metadata — parameters, linked actions, the `disabled`/`reason` pair — rejecting any member the protocol does not declare, at whatever depth it appears. `decodeSlipError` and `decodeEndpointError` are the two sides of the failure body: an endpoint may send only the eight codes version 1 allows it, while a client reads any well-shaped code so a publisher's message survives one this version does not define. `errorCodeClass`, `endpointErrorStatus`, `classifyErrorCode` and `classifyStatus` carry the vocabulary itself, checked against the table in the CIP.
  
  Both schemas are run against the payloads published under `spec/examples`, so the decoder and the specification cannot drift apart quietly.

## 0.0.2

### Patch Changes

- [#102](https://github.com/emmanuel-musau/cardano-slips/pull/102) [`be8d5b9`](https://github.com/emmanuel-musau/cardano-slips/commit/be8d5b9e82b545384ae30c50c4a3002e71152bec) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Say "error codes" instead of "error taxonomy" in the package description, README
  and module docs. Wording only — no API, schema or behaviour change.

## 0.0.1

### Patch Changes

- [#89](https://github.com/emmanuel-musau/cardano-slips/pull/89) [`0d438bd`](https://github.com/emmanuel-musau/cardano-slips/commit/0d438bdebd796fffe3705e21d11a27d139e2ea1e) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project. No API yet — the modules land in [#23](https://github.com/emmanuel-musau/cardano-slips/issues/23)–[#26](https://github.com/emmanuel-musau/cardano-slips/issues/26).
