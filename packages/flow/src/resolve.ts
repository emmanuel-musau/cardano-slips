/**
 * The wallet's own unspent outputs, in the form the verifier's derivation takes
 * them. The engine is handed the value of every input the body spends because
 * it never looks one up (invariant 1) — this is where the client, which does
 * know, says so.
 */
import type { MultiAsset, ResolvedInput } from "@cardano-slips/verifier"
import {
  Address,
  AssetName,
  Assets,
  MultiAsset as Multi,
  PolicyId,
  Schema,
  TransactionHash
} from "@evolution-sdk/evolution"
import type { UTxO } from "@evolution-sdk/evolution"

const addressBytes = Schema.encodeSync(Address.FromBytes)

const multiAssetOf = (assets: Assets.Assets): MultiAsset => {
  const held = Assets.getMultiAsset(assets)
  if (held === undefined) return []
  return Multi.getPolicyIds(held).map((policyId) => ({
    policyId: PolicyId.toBytes(policyId),
    assets: Multi.getAssetsByPolicy(held, policyId).map(([name, quantity]) => ({
      name: AssetName.toBytes(name),
      quantity
    }))
  }))
}

export const asResolvedInput = (utxo: UTxO.UTxO): ResolvedInput => ({
  input: { transactionId: TransactionHash.toBytes(utxo.transactionId), index: utxo.index },
  address: addressBytes(utxo.address),
  value: { coin: Assets.lovelaceOf(utxo.assets), assets: multiAssetOf(utxo.assets) }
})

export const asResolvedInputs = (utxos: ReadonlyArray<UTxO.UTxO>): ReadonlyArray<ResolvedInput> =>
  utxos.map(asResolvedInput)
