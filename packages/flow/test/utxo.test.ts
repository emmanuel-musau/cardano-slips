import { Assets, Data, InlineDatum, NativeScripts, Script } from "@evolution-sdk/evolution"
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { readWalletUtxos } from "../src/utxo.js"
import { mainnetAddress } from "./stub-wallet.js"
import { asCip30Hex, someDatumHash, walletUtxo } from "./wallet-utxos.js"

/**
 * `getUtxos` answers in CBOR hex and the builder takes typed values, so this is
 * the one conversion between them. Every fixture is encoded with evolution-sdk's
 * own codecs: a hand-written one would prove we can read what we wrote.
 */

const read = (hexes: ReadonlyArray<string>) => {
  const result = readWalletUtxos(hexes)
  if (Either.isLeft(result)) throw new Error(`the unspent outputs were refused: ${result.left}`)
  return result.right
}

const refusal = (hexes: ReadonlyArray<string>): string => {
  const result = readWalletUtxos(hexes)
  if (Either.isRight(result)) throw new Error("the unspent outputs were expected to be refused and were not")
  return result.left
}

const ada = walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 42_000_000n, seed: 1 })

const withAsset = walletUtxo({
  bech32: mainnetAddress.bech32,
  lovelace: 2_000_000n,
  seed: 2,
  assets: [
    { policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128", assetName: "5553444d", quantity: 900n }
  ]
})

describe("reading what a wallet returned", () => {
  it("keeps the outpoint, the address and the lovelace", () => {
    const [read0] = read([asCip30Hex(ada)])

    expect(read0?.index).toBe(ada.index)
    expect(read0?.transactionId.hash).toEqual(ada.transactionId.hash)
    expect(Assets.lovelaceOf(read0?.assets ?? Assets.zero)).toBe(42_000_000n)
  })

  it("keeps a native asset and its quantity", () => {
    const [read0] = read([asCip30Hex(withAsset)])
    const units = Assets.getUnits(read0?.assets ?? Assets.zero)

    expect(Assets.lovelaceOf(read0?.assets ?? Assets.zero)).toBe(2_000_000n)
    expect(units).toContain("1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f401285553444d")
  })

  it("reads a whole set in the order the wallet gave it", () => {
    const utxos = read([asCip30Hex(ada), asCip30Hex(withAsset)])

    expect(utxos.map((utxo) => Assets.lovelaceOf(utxo.assets))).toEqual([42_000_000n, 2_000_000n])
  })

  it("reads an empty wallet as an empty set, not as a failure", () => {
    expect(read([])).toEqual([])
  })
})

describe("an output that carries more than value", () => {
  // These are not exotic: a wallet holds whatever was paid to it, and losing a
  // datum or a script here would understate the bytes the input occupies, which
  // is a fee computed from a size the ledger does not agree with.

  it("keeps a Babbage output's datum hash", () => {
    const [read0] = read([
      asCip30Hex(walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 5_000_000n, datum: someDatumHash }))
    ])

    expect(read0?.datumOption?._tag).toBe("DatumHash")
    expect(read0?.datumOption?._tag === "DatumHash" ? read0.datumOption.hash : "").toEqual(someDatumHash.hash)
  })

  it("keeps a Shelley output's datum hash, which the Babbage form calls a datum option", () => {
    const utxo = walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 5_000_000n, datum: someDatumHash })
    const [read0] = read([asCip30Hex(utxo, "shelley")])

    expect(read0?.datumOption?._tag).toBe("DatumHash")
  })

  it("keeps an inline datum whole", () => {
    const datum = new InlineDatum.InlineDatum({ data: Data.int(42n) })
    const [read0] = read([asCip30Hex(walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 5_000_000n, datum }))])

    expect(read0?.datumOption?._tag).toBe("InlineDatum")
    expect(read0?.datumOption?._tag === "InlineDatum" ? read0.datumOption.data : null).toEqual(Data.int(42n))
  })

  it("unwraps a reference script back to the script itself", () => {
    // `script_ref = #6.24(bytes .cbor script)`: the bytes inside the tag are the
    // script's own CBOR, so reading one is an unwrap and not a second decode.
    const script = NativeScripts.makeScriptPubKey(Uint8Array.from({ length: 28 }, () => 0xab))
    const [read0] = read([asCip30Hex(walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 5_000_000n, script }))])

    expect(read0?.scriptRef).toBeDefined()
    expect(read0?.scriptRef === undefined ? "" : Script.toCBORHex(read0.scriptRef)).toBe(Script.toCBORHex(script))
  })

  it("leaves both absent on an output that carries neither", () => {
    const [read0] = read([asCip30Hex(ada)])

    expect(read0?.datumOption).toBeUndefined()
    expect(read0?.scriptRef).toBeUndefined()
  })
})

describe("what it refuses", () => {
  it("says which entry could not be read", () => {
    expect(refusal([asCip30Hex(ada), "not hex at all"])).toContain("unspent output 1")
  })

  it("refuses CBOR that is not a pair at all", () => {
    // `0x01`: well-formed CBOR, and nothing shaped like an unspent output.
    expect(refusal(["01"])).toContain("an input and an output")
  })

  it("refuses a pair whose second half is not an output", () => {
    // A bare transaction input is itself a two-element array, so the shape check
    // passes and the refusal comes from the decode underneath it.
    const said = refusal(["825820abababababababababababababababababababababababababababababababab01"])

    expect(said).toContain("unspent output 0")
  })
})
