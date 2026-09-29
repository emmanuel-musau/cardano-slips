import { readWalletAddress, readWalletUtxos } from "@cardano-slips/flow"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import { previewHex } from "../src/app/preview/flow/wallet.js"

/** Hex pasted into a source file can rot unnoticed; these read it back through flow's own codecs. */
describe("the preview wallet's fixtures", () => {
  it("are unspent outputs a real wallet could have sent", () => {
    const read = readWalletUtxos([previewHex.firstOutput, previewHex.secondOutput])
    expect(Either.isRight(read)).toBe(true)
  })

  it("hold their outputs at the address the wallet gives for change", () => {
    const address = Effect.runSync(readWalletAddress(previewHex.address))
    expect(address.bech32.startsWith("addr1")).toBe(true)
  })
})
