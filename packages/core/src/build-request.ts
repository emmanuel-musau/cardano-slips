/**
 * The body a client sends with `POST` — the executable form of
 * `spec/CIP-XXXX/schemas/slip-post-request.schema.json`, held to the same
 * examples by `test/build-request.test.ts`.
 *
 * Two fields, and the closed object is the point: an endpoint learns one
 * address and the network it is on, and nothing else about the person. A
 * client's unspent outputs are rejected here by the same rule that rejects any
 * other undeclared member.
 */
import { Schema } from "effect"

import { PaymentAddress } from "./intent.js"
import { Network } from "./types.js"

/**
 * `onExcessProperty: "error"` is what makes Mode A structural rather than
 * promised: `utxos` in the body is a decode failure, not an ignored field.
 */
export const BuildRequest = Schema.Struct({
  changeAddress: PaymentAddress,
  network: Network
}).annotations({
  identifier: "BuildRequest",
  parseOptions: { onExcessProperty: "error", errors: "all" }
})
export type BuildRequest = typeof BuildRequest.Type

/** `Either`, not a throw: this runs on whatever arrived at the endpoint. */
export const decodeBuildRequest = Schema.decodeUnknownEither(BuildRequest)

/**
 * A CIP-19 address carries mainnet or testnet and no more, so `addr_test1`
 * answers for preprod and preview alike. Separating those two is exactly why
 * `network` is stated by name and not taken from CIP-30's numeric id.
 */
export const addressIsOnNetwork = (address: string, network: Network): boolean =>
  address.startsWith("addr_test") ? network !== "mainnet" : network === "mainnet"
