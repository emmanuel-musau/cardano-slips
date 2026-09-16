import { describe, expect, it } from "vitest"

import { asResolvedInput } from "../src/resolve.js"
import { mainnetAddress } from "./stub-wallet.js"
import { asResolvedInput as expected, type UtxoSpec, walletUtxo } from "./wallet-utxos.js"

/**
 * The conversion the derivation is handed, against the same value built a
 * second way. The fixture assembles it from the spec directly while `resolve`
 * reads it off an evolution-sdk UTxO — an agreement between two constructions
 * says something a round-trip through one of them would not.
 */

const spec = (assets: UtxoSpec["assets"]): UtxoSpec => ({
  bech32: mainnetAddress.bech32,
  lovelace: 42_000_000n,
  seed: 7,
  ...(assets === undefined ? {} : { assets })
})

const policy = "a".repeat(56)
const other = "b".repeat(56)

describe("an unspent output as the derivation takes it", () => {
  it("carries the reference, the address and the lovelace", () => {
    const held = spec(undefined)

    expect(asResolvedInput(walletUtxo(held))).toEqual(expected(held))
  })

  it("carries every asset under a policy", () => {
    // A value read short here understates what an input holds, which is
    // arithmetic a person is shown as what the transaction costs them.
    const held = spec([
      { policyId: policy, assetName: "4361726461", quantity: 3n },
      { policyId: policy, assetName: "536c697073", quantity: 1n }
    ])

    expect(asResolvedInput(walletUtxo(held))).toEqual(expected(held))
  })

  it("carries assets across policies", () => {
    const held = spec([
      { policyId: policy, assetName: "4361726461", quantity: 3n },
      { policyId: other, assetName: "", quantity: 9_999n }
    ])

    expect(asResolvedInput(walletUtxo(held))).toEqual(expected(held))
  })
})
