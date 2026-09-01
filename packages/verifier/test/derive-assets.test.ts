/**
 * The per-policy asset arithmetic, over the same mainnet transactions the
 * lovelace is held to. Stablecoin payments are the launch use case, so
 * `usdm-payment` is a real one: ten USDM to a stranger, the change and thirteen
 * untouched tokens back.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { AssetEffects } from "../src/derive.js"
import { deriveAssets } from "../src/derive.js"
import { fromHex, toHex } from "./support/bytes.js"
import { decoded, derivationOf } from "./support/derivation.js"
import type { Fixture } from "./support/fixtures.js"
import { fixture, fixtures } from "./support/fixtures.js"

const derived = (one: Fixture): AssetEffects => {
  const result = deriveAssets(derivationOf(one))
  if (Either.isLeft(result)) throw new Error(`${one.name} was refused: ${result.left.message}`)
  return result.right
}

const asStrings = (effects: AssetEffects) =>
  effects.user.map((asset) => ({
    policyId: toHex(asset.policyId),
    name: toHex(asset.name),
    spent: String(asset.spent),
    received: String(asset.received),
    delta: String(asset.delta)
  }))

describe.each(fixtures.map((one) => [one.name, one] as const))("%s", (_name, one) => {
  it("reads the user's assets as the chain's own inputs and outputs do", () => {
    expect(asStrings(derived(one))).toEqual(one.user.assets)
  })

  it("places every asset the transaction moves", () => {
    // Inputs plus mint less outputs, per asset. Anything left over is the
    // engine saying its reading of the transaction is incomplete.
    expect(derived(one).unaccounted).toEqual([])
  })
})

describe("a real USDM payment", () => {
  const usdm = fixture("usdm-payment")
  const policy = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad"
  const name = "0014df105553444d"

  it("shows ten USDM leaving and nothing else", () => {
    // The wallet holds fourteen tokens and every one of them is in both the
    // input and the change. Only the one that moved is an effect.
    expect(asStrings(derived(usdm))).toEqual([
      { policyId: policy, name, spent: "10226121", received: "226121", delta: "10000000" }
    ])
  })

  it("counts the thirteen tokens that came straight back as no effect at all", () => {
    // Counted the way a delta is keyed, on the policy and the name together.
    const held = new Set(
      usdm.resolved.flatMap((input) => input.assets.map((asset) => `${asset.policyId}.${asset.name}`))
    )
    expect(held.size).toBe(14)
    expect(derived(usdm).user).toHaveLength(1)
  })

  it("shows the same ten USDM arriving, read from the recipient's side", () => {
    // The tip as the person receiving it sees it. Same bytes, same arithmetic,
    // the other sign — which is the whole of what a delta means.
    const ours = new Set(usdm.user.addresses)
    const recipient = decoded(usdm).body.outputs.find((output) => !ours.has(toHex(output.address)))
    expect(recipient).toBeDefined()
    const result = deriveAssets({ ...derivationOf(usdm), userAddresses: [recipient!.address] })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(asStrings(result.right)).toEqual([
        { policyId: policy, name, spent: "0", received: "10000000", delta: "-10000000" }
      ])
    }
  })

  it("keeps the quantity as the raw on-chain count, decimals untouched", () => {
    // USDM has six decimals. Ten USDM is 10000000 here and nowhere is it 10.
    expect(derived(usdm).user[0].delta).toBe(10_000_000n)
  })
})

describe("what the fixtures cover", () => {
  it("has transactions where assets move and transactions where none do", () => {
    const moving = fixtures.filter((one) => one.user.assets.length > 0)
    expect(moving.map((one) => one.name).sort()).toEqual(["mint-and-burn", "native-assets-in-output", "usdm-payment"])
    expect(fixtures.length - moving.length).toBeGreaterThan(20)
  })

  it("reaches an asset leaving through a burn as well as through an output", () => {
    // `mint-and-burn` destroys a token the user held: it left the wallet, and
    // no output anywhere received it.
    const burnt = derived(fixture("mint-and-burn")).user.find((asset) => asset.received === 0n)
    expect(burnt).toBeDefined()
    expect(burnt!.delta).toBeGreaterThan(0n)
  })

  it("counts an asset the user never held as none of theirs", () => {
    const usdm = fixture("usdm-payment")
    const result = deriveAssets({ ...derivationOf(usdm), userAddresses: [fromHex("00".repeat(57))] })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) expect(result.right.user).toEqual([])
  })
})
