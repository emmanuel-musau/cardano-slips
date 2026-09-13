/**
 * Unspent outputs in both forms a test needs: the CIP-30 hex a wallet returns,
 * and the typed value the builder takes. Built with evolution-sdk's own codecs,
 * so a fixture cannot encode something no wallet would send.
 */
import type { MultiAsset, ResolvedInput } from "@cardano-slips/verifier"
import {
  Address,
  AddressEras,
  Assets,
  CBOR,
  DatumHash,
  type InlineDatum,
  RewardAccount,
  Schema,
  Script,
  ScriptRef,
  TransactionHash,
  TransactionInput,
  TransactionOutput,
  UTxO,
  Value
} from "@evolution-sdk/evolution"

import type { BalancingParameters } from "../src/balance.js"

/** Mainnet, epoch 651, from Koios `epoch_params` — the same figures the verifier's fixtures were charged under. */
export const mainnetParameters: BalancingParameters = {
  stakeDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  governanceActionDeposit: 100_000_000_000n,
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384,
  // Mainnet's Shelley era: slot 4492800 at 2020-07-29T21:44:51Z, one second a slot.
  slots: { slot: 4_492_800n, time: 1_596_059_091_000n, slotLength: 1_000n }
}

export type AssetHolding = {
  readonly policyId: string
  readonly assetName: string
  readonly quantity: bigint
}

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))

const toEras = (address: Address.Address): AddressEras.AddressEras =>
  Schema.decodeSync(AddressEras.FromBytes)(Schema.encodeSync(Address.FromBytes)(address))

const assetsOf = (lovelace: bigint, holdings: ReadonlyArray<AssetHolding>): Assets.Assets =>
  holdings.reduce(
    (assets, holding) => Assets.addByHex(assets, holding.policyId, holding.assetName, holding.quantity),
    Assets.fromLovelace(lovelace)
  )

export type UtxoSpec = {
  readonly bech32: string
  readonly lovelace: bigint
  readonly assets?: ReadonlyArray<AssetHolding>
  /** Distinguishes one fixture from another; any 32 bytes will do. */
  readonly seed?: number
  /** What the output locks its value behind, where it locks it behind anything. */
  readonly datum?: DatumHash.DatumHash | InlineDatum.InlineDatum
  /** A script the output carries for others to reference. */
  readonly script?: Script.Script
}

export const walletUtxo = ({ assets = [], bech32, datum, lovelace, script, seed = 1 }: UtxoSpec): UTxO.UTxO =>
  new UTxO.UTxO({
    transactionId: TransactionHash.fromHex(String(seed).padStart(64, "a")),
    index: 0n,
    address: Address.fromBech32(bech32),
    assets: assetsOf(lovelace, assets),
    ...(datum === undefined ? {} : { datumOption: datum }),
    ...(script === undefined ? {} : { scriptRef: script })
  })

/** Any 32 bytes: nothing here resolves a datum, it only carries the hash across. */
export const someDatumHash = DatumHash.fromHex("c".repeat(64))

const valueOf = (utxo: UTxO.UTxO): Value.Value => {
  const multiAsset = Assets.getMultiAsset(utxo.assets)
  return multiAsset === undefined
    ? Value.onlyCoin(Assets.lovelaceOf(utxo.assets))
    : Value.withAssets(Assets.lovelaceOf(utxo.assets), multiAsset)
}

/**
 * The same unspent output as the hex `getUtxos` would have returned. Both eras
 * reach a wallet: a Shelley output carries a bare datum hash where a Babbage one
 * carries a datum option, and only the Babbage form can carry a script.
 */
export const asCip30Hex = (utxo: UTxO.UTxO, era: "shelley" | "babbage" = "babbage"): string => {
  const input = new TransactionInput.TransactionInput({ transactionId: utxo.transactionId, index: utxo.index })
  const address = toEras(utxo.address)
  const amount = valueOf(utxo)
  const datum = utxo.datumOption
  const output =
    era === "shelley"
      ? new TransactionOutput.ShelleyTransactionOutput({
          address,
          amount,
          ...(datum !== undefined && datum._tag === "DatumHash" ? { datumHash: datum } : {})
        })
      : new TransactionOutput.BabbageTransactionOutput({
          address,
          amount,
          ...(datum === undefined ? {} : { datumOption: datum }),
          ...(utxo.scriptRef === undefined ? {} : { scriptRef: ScriptRef.fromBytes(Script.toCBOR(utxo.scriptRef)) })
        })

  return CBOR.toCBORHex([
    CBOR.fromCBORHex(TransactionInput.toCBORHex(input)),
    CBOR.fromCBORHex(TransactionOutput.toCBORHex(output))
  ])
}

/**
 * The reward account behind a base address, derived from the wallet's own
 * address rather than read off the transaction — a test that took the account
 * from the body it is checking would call any account the wallet's own.
 */
export const rewardAccountOf = (bech32: string): Uint8Array => {
  const address = Address.fromBech32(bech32)
  const stakeCredential = address.stakingCredential
  if (stakeCredential === undefined) throw new Error(`${bech32} carries no stake credential`)
  return RewardAccount.toBytes(new RewardAccount.RewardAccount({ networkId: address.networkId, stakeCredential }))
}

const multiAssetOf = (holdings: ReadonlyArray<AssetHolding>): MultiAsset => {
  const byPolicy = new Map<string, Array<{ name: Uint8Array; quantity: bigint }>>()
  for (const holding of holdings) {
    const held = byPolicy.get(holding.policyId) ?? []
    held.push({ name: fromHex(holding.assetName), quantity: holding.quantity })
    byPolicy.set(holding.policyId, held)
  }
  return [...byPolicy].map(([policyId, assets]) => ({ policyId: fromHex(policyId), assets }))
}

/** The same unspent output as the verifier's derivation takes it: a reference, an address, a value. */
export const asResolvedInput = ({ assets = [], bech32, lovelace, seed = 1 }: UtxoSpec): ResolvedInput => ({
  input: { transactionId: fromHex(String(seed).padStart(64, "a")), index: 0n },
  address: Schema.encodeSync(Address.FromBytes)(Address.fromBech32(bech32)),
  value: { coin: lovelace, assets: multiAssetOf(assets) }
})
