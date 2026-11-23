import { readWalletAddress, readWalletUtxos } from "@cardano-slips/flow"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import { previewApi, previewHex, type PreviewNetwork } from "../src/app/preview/flow/wallet.js"

const networks: ReadonlyArray<{ readonly network: PreviewNetwork; readonly id: number; readonly prefix: string }> = [
  { network: "mainnet", id: 1, prefix: "addr1" },
  { network: "testnet", id: 0, prefix: "addr_test1" }
]

/** Hex pasted into a source file can rot unnoticed; these read it back through flow's own codecs. */
describe.each(networks)("the preview wallet's fixtures on $network", ({ id, network, prefix }) => {
  const fixtures = previewHex[network]

  it("are unspent outputs a real wallet could have sent", () => {
    const read = readWalletUtxos([fixtures.firstOutput, fixtures.secondOutput])
    expect(Either.isRight(read)).toBe(true)
  })

  it("hold their outputs at the address the wallet gives for change", () => {
    const address = Effect.runSync(readWalletAddress(fixtures.address))
    expect(address.bech32.startsWith(prefix)).toBe(true)
    expect(fixtures.firstOutput).toContain(fixtures.address)
    expect(fixtures.secondOutput).toContain(fixtures.address)
  })

  it("name the reward account of that address's stake key", () => {
    expect(fixtures.rewardAccount.slice(2)).toBe(fixtures.address.slice(58))
    expect(fixtures.rewardAccount.slice(0, 2)).toBe(id === 1 ? "e1" : "e0")
  })

  it("answer with the network they hold addresses on", async () => {
    const api = previewApi("signs", { delay: 0, network })
    expect(await api.getNetworkId()).toBe(id)
    expect(await api.getChangeAddress()).toBe(fixtures.address)
    expect(await api.getRewardAddresses()).toEqual([fixtures.rewardAccount])
  })
})

describe("the preview wallet", () => {
  it("is on a test network unless asked otherwise, like the examples the README serves", async () => {
    expect(await previewApi("signs", { delay: 0 }).getNetworkId()).toBe(0)
  })
})
