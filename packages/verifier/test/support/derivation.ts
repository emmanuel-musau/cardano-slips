/** A fixture, read and dressed as the four arguments a derivation takes. */
import { Either } from "effect"

import type { DecodedTransaction, MultiAsset } from "../../src/decode.js"
import { decodeTransaction } from "../../src/decode.js"
import type { Derivation, ResolvedInput } from "../../src/derive.js"
import type { ProtocolParameters } from "../../src/parameters.js"
import { fromHex } from "./bytes.js"
import type { Fixture, ResolvedFixtureInput } from "./fixtures.js"

/** Mainnet, epoch 651, from Koios `epoch_params` — the numbers every fixture here was charged under. */
export const mainnetParameters: ProtocolParameters = {
  stakeDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  governanceActionDeposit: 100_000_000_000n,
  // Mainnet's Shelley era: slot 4492800 at 2020-07-29T21:44:51Z, one second a
  // slot. Every fixture's block time is checked against it.
  slots: { slot: 4_492_800n, time: 1_596_059_091_000n, slotLength: 1_000n }
}

export const decoded = (fixture: Fixture): DecodedTransaction => {
  const result = decodeTransaction(fromHex(fixture.cbor))
  if (Either.isLeft(result)) throw new Error(`${fixture.name} was refused: ${result.left.message}`)
  return result.right
}

const grouped = (input: ResolvedFixtureInput): MultiAsset => {
  const byPolicy = new Map<string, Array<{ name: Uint8Array; quantity: bigint }>>()
  for (const asset of input.assets) {
    const held = byPolicy.get(asset.policyId) ?? []
    held.push({ name: fromHex(asset.name), quantity: BigInt(asset.quantity) })
    byPolicy.set(asset.policyId, held)
  }
  return [...byPolicy].map(([policyId, assets]) => ({ policyId: fromHex(policyId), assets }))
}

export const resolvedInputs = (fixture: Fixture): ReadonlyArray<ResolvedInput> =>
  fixture.resolved.map((input) => ({
    input: { transactionId: fromHex(input.transactionId), index: BigInt(input.index) },
    address: fromHex(input.address),
    value: { coin: BigInt(input.coin), assets: grouped(input) }
  }))

export const derivationOf = (fixture: Fixture): Derivation => ({
  transaction: decoded(fixture),
  userAddresses: fixture.user.addresses.map(fromHex),
  resolvedInputs: resolvedInputs(fixture),
  protocolParameters: mainnetParameters
})
