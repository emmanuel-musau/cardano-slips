---
"@cardano-slips/core": minor
---

Add Effect Schema definitions and types for the partial intent a Slip endpoint returns from `POST`.

`decodePartialIntent` reads the publisher's side of a transaction — outputs, native assets, certificates, the rewards withdrawal and `validUntil` — and rejects any member the protocol does not declare, at whatever depth it appears. That is what keeps a declared fee, deposit or stake credential off the wire rather than silently ignored: each is fixed by the ledger or by the wallet, so a field to state one is a field to state one wrongly. Certificates are a union on `type`, so `poolId` is required by `stakeDelegation` and permitted nowhere else, and the same for `drep` and `voteDelegation`.

Quantities are integer base units in decimal strings, with no field in which a publisher may state an asset's decimals. `validUntil` must name a real instant as well as match the published pattern — the pattern alone accepts `2026-02-31T00:00:00Z`, which JavaScript then reads as 3 March.

The schema is run against the payloads under `spec/examples/partial`, including a round trip that encodes each one back to the bytes it arrived as.
