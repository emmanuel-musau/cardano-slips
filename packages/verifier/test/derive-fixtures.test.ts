/**
 * The lovelace arithmetic, run over the same twenty-seven mainnet transactions
 * the decoder is held to, with the inputs they spend resolved from the chain.
 * Every figure here is checked against Koios's own reading of the transaction.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { deriveLovelace, type LovelaceEffects } from "../src/derive.js"
import { totalOf } from "../src/deposits.js"
import { derivationOf, mainnetParameters } from "./support/derivation.js"
import type { Fixture } from "./support/fixtures.js"
import { fixture, fixtures } from "./support/fixtures.js"

const derived = (one: Fixture): LovelaceEffects => {
  const result = deriveLovelace(derivationOf(one))
  if (Either.isLeft(result)) throw new Error(`${one.name} was refused: ${result.left.message}`)
  return result.right
}

/**
 * The one transaction whose deposit cannot be read from its bytes: a pool
 * re-registration pays nothing, a first registration pays 500 ADA, and the body
 * is identical either way. It has a section of its own below.
 */
const poolReregistration = "pool-registration"
const balancing = fixtures.filter((one) => one.name !== poolReregistration)

describe.each(balancing.map((one) => [one.name, one] as const))("%s", (_name, one) => {
  it("states the fee the chain states", () => {
    expect(String(derived(one).fee)).toBe(one.chain.fee)
  })

  it("reads the user's side as the chain's own inputs and outputs do", () => {
    const { user } = derived(one)
    expect({ spent: String(user.spent), received: String(user.received), ada: String(user.ada) }).toEqual({
      spent: one.user.spent,
      received: one.user.received,
      ada: one.user.ada
    })
  })

  it("agrees with the chain on deposits less refunds", () => {
    const effects = derived(one)
    expect(String(totalOf(effects.deposits) - totalOf(effects.refunds))).toBe(one.chain.deposit)
  })

  it("agrees with the chain on the treasury donation", () => {
    expect(String(derived(one).donation)).toBe(one.chain.treasuryDonation)
  })

  it("accounts for every lovelace the ledger moves", () => {
    // What consumed minus produced has to be. A non-zero figure is the engine
    // saying its reading of the transaction is incomplete.
    expect(derived(one).unaccounted).toBe(0n)
  })

  it("explains the user's delta by the fee, the deposits and who else was paid", () => {
    const { deposits, donation, fee, refunds, total, user } = derived(one)
    const othersSpent = total.inputs - user.spent
    const othersReceived = total.outputs - user.received
    const othersWithdrew = total.withdrawn - user.withdrawn
    expect(user.ada).toBe(
      fee +
        totalOf(deposits) +
        donation -
        totalOf(refunds) -
        user.withdrawn +
        othersReceived -
        othersSpent -
        othersWithdrew
    )
  })
})

describe("the pool registration nothing can settle from the bytes", () => {
  const one = fixture(poolReregistration)

  it("reads the deposit from the protocol parameter, and says so", () => {
    const { deposits } = derived(one)
    expect(deposits).toEqual([
      { kind: "pool", amount: mainnetParameters.poolDeposit, basis: "assumed", source: "certificate", index: 0 }
    ])
  })

  it("reports the whole pool deposit as unaccounted, because this pool was already registered", () => {
    // The chain charged nothing: the certificate updates a registration rather
    // than making one. The engine cannot tell, so it charges the parameter and
    // the shortfall says out loud that the reading does not add up.
    expect(one.chain.deposit).toBe("0")
    expect(derived(one).unaccounted).toBe(-mainnetParameters.poolDeposit)
  })
})

describe("what the fixtures cover", () => {
  it("has a transaction that pays a deposit, one that takes a refund, and one that does neither", () => {
    const deposits = fixtures.map((one) => BigInt(one.chain.deposit))
    expect(deposits.some((amount) => amount > 0n)).toBe(true)
    expect(deposits.some((amount) => amount < 0n)).toBe(true)
    expect(deposits.some((amount) => amount === 0n)).toBe(true)
  })

  it("has a transaction whose lovelace comes back to the user and one whose leaves", () => {
    const ada = fixtures.map((one) => BigInt(one.user.ada))
    expect(ada.some((amount) => amount < 0n)).toBe(true)
    expect(ada.some((amount) => amount > 0n)).toBe(true)
  })

  it("reaches every kind of deposit", () => {
    const kinds = new Set(fixtures.flatMap((one) => derived(one).deposits.map((deposit) => deposit.kind)))
    expect([...kinds].sort()).toEqual(["drep", "governance-action", "pool", "stake"])
  })

  it("reaches every basis a deposit can be read on", () => {
    const bases = new Set(
      fixtures.flatMap((one) => {
        const effects = derived(one)
        return [...effects.deposits, ...effects.refunds].map((deposit) => deposit.basis)
      })
    )
    expect([...bases].sort()).toEqual(["assumed", "parameter", "stated"])
  })
})
