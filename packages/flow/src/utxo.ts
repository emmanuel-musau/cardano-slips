/**
 * CIP-30 hands unspent outputs back as CBOR hex; evolution-sdk's builder takes
 * them typed. The SDK has this conversion — `cip30UtxoFromCBORHex` — but only
 * behind an export path its manifest blocks, so it is the sixth gap of ADR-0004
 * and belongs upstream rather than here.
 */
import {
  Address,
  AddressEras,
  Assets,
  CBOR,
  Schema,
  Script,
  TransactionInput,
  TransactionOutput,
  UTxO
} from "@evolution-sdk/evolution"
import { Either } from "effect"

import type { CborHex } from "./cip30.js"

/** The output's address is era-tagged and a UTxO's is not; the bytes are the same. */
const toAddressStructure = (tagged: AddressEras.AddressEras): Address.Address =>
  Schema.decodeSync(Address.FromBytes)(Schema.encodeSync(AddressEras.FromBytes)(tagged))

const readOne = (hex: CborHex): UTxO.UTxO => {
  const decoded = CBOR.fromCBORHex(hex)
  if (!Array.isArray(decoded) || decoded.length !== 2) {
    throw new Error("a CIP-30 unspent output is an input and an output, and this is neither")
  }
  const input = TransactionInput.fromCBORBytes(CBOR.toCBORBytes(decoded[0]))
  const output = TransactionOutput.fromCBORBytes(CBOR.toCBORBytes(decoded[1]))
  const amount = output.amount

  return new UTxO.UTxO({
    transactionId: input.transactionId,
    index: input.index,
    address: toAddressStructure(output.address),
    assets:
      amount._tag === "WithAssets"
        ? Assets.withMultiAsset(amount.coin, amount.assets)
        : Assets.fromLovelace(amount.coin),
    // A Babbage output carries a datum option and a script; a Shelley one carries
    // a datum hash, which is itself a valid datum option.
    datumOption: output._tag === "BabbageTransactionOutput" ? output.datumOption : output.datumHash,
    scriptRef:
      output._tag === "BabbageTransactionOutput" && output.scriptRef
        ? Script.fromCBOR(output.scriptRef.bytes)
        : undefined
  })
}

/**
 * Reads what `getUtxos` returned. `Either` and not a throw: this runs on
 * whatever a browser extension chose to send, and one unreadable entry must
 * not take the page down.
 */
export const readWalletUtxos = (hexes: ReadonlyArray<CborHex>): Either.Either<ReadonlyArray<UTxO.UTxO>, string> => {
  const utxos: Array<UTxO.UTxO> = []
  for (const [index, hex] of hexes.entries()) {
    try {
      utxos.push(readOne(hex))
    } catch (cause) {
      return Either.left(
        `unspent output ${index} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }
  return Either.right(utxos)
}
