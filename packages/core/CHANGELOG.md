# @cardano-slips/core

## 0.2.0

### Minor Changes

- [#126](https://github.com/emmanuel-musau/cardano-slips/pull/126) [`8d53fb2`](https://github.com/emmanuel-musau/cardano-slips/commit/8d53fb2e00e1953194f097b53bcb07d2911794ce) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Add templated references: the placeholders in a linked action's `label` and `href`, the values a person supplies for them, and the `POST` target that results.
  
  `checkTemplates` runs the three rules the discovery decoder had to defer, now that the discovery URL is in hand — an `href` that resolves off the discovery origin, a `{placeholder}` no parameter fills, a parameter no placeholder references, and a `max` below its `min`. The four `get/invalid/rule` payloads the CIP publishes are rejected here, and nowhere earlier.
  
  `checkValues` enforces `required`, `min` and `max` before a request is sent, counting characters on `text` and values on `number`, and refusing a `select` value that was never offered. It reads a number strictly rather than through `Number`, which would take `0x10` for 16.
  
  `fillHref` percent-encodes each value to RFC 3986 unreserved and no further, then resolves against the discovery URL; `fillLabel` substitutes verbatim, because a label is display. The encoding is what keeps the origin fixed by the template rather than by an answer: an encoded value carries no `:`, `/`, `?`, `#` or `@`, so nothing a person types can move the request.

- [#130](https://github.com/emmanuel-musau/cardano-slips/pull/130) [`77ed6d9`](https://github.com/emmanuel-musau/cardano-slips/commit/77ed6d992549d8062cce55b5357c2941adad72c0) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Add the build request: the body a client `POST`s to a Slip endpoint, and the one payload in this protocol that travels towards a publisher rather than away from one.
  
  `decodeBuildRequest` reads a closed object of `changeAddress` and `network`. Closed is the whole point — `utxos-in-the-body.json`, the payload Mode A exists to make unsendable, is rejected by the same rule that rejects any other undeclared member, so the privacy property is a decode failure rather than a promise. The six payloads the CIP publishes are held to it, a stake address and a bare hostname among the rejections.
  
  `addressIsOnNetwork` is the rule no schema can make: a change address and a stated network are two sibling values, and one of them encodes the answer to the other. It reads mainnet or testnet and no further, because CIP-19 cannot separate preprod from preview — which is the reason `network` is stated by name in the first place, and not taken from CIP-30's numeric id.

### Patch Changes

- [#127](https://github.com/emmanuel-musau/cardano-slips/pull/127) [`9ed2ff5`](https://github.com/emmanuel-musau/cardano-slips/commit/9ed2ff59a108a1c7b18823dca1f8c4e445ecf190) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Read a parameter value as unfilled unless the values object owns it.
  
  The parameter name pattern admits `constructor`, `toString` and the rest of `Object.prototype`, and a plain object answers for every one of them. A parameter named `constructor` that nobody filled substituted `function Object() { [native code] }` into both the button label and the request URL, and a required parameter named `toString` passed the required check while still empty. Lookups are own-property only now.

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
