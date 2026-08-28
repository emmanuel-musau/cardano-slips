---
"@cardano-slips/core": minor
---

Add the build request: the body a client `POST`s to a Slip endpoint, and the one payload in this protocol that travels towards a publisher rather than away from one.

`decodeBuildRequest` reads a closed object of `changeAddress` and `network`. Closed is the whole point — `utxos-in-the-body.json`, the payload Mode A exists to make unsendable, is rejected by the same rule that rejects any other undeclared member, so the privacy property is a decode failure rather than a promise. The six payloads the CIP publishes are held to it, a stake address and a bare hostname among the rejections.

`addressIsOnNetwork` is the rule no schema can make: a change address and a stated network are two sibling values, and one of them encodes the answer to the other. It reads mainnet or testnet and no further, because CIP-19 cannot separate preprod from preview — which is the reason `network` is stated by name in the first place, and not taken from CIP-30's numeric id.
