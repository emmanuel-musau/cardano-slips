/**
 * The arithmetic that has to hold over every transaction, not only the ones we
 * collected: what the ledger consumes equals what it produces, and the user's
 * delta is explained by the fee, the deposits and whoever else was paid.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { Certificate } from "../src/decode.js"
import { deriveLovelace } from "../src/derive.js"
import { totalOf } from "../src/deposits.js"
import { mainnetParameters } from "./support/derivation.js"
import { certificateKindCount, generate } from "./support/generate.js"
import { transaction } from "./support/transactions.js"

const runs = 500
const seeds = Array.from({ length: runs }, (_, index) => index + 1)

const effectsFor = (seed: number) => {
  const generated = generate(seed, mainnetParameters)
  const result = deriveLovelace({
    transaction: transaction(generated.body),
    userAddresses: generated.userAddresses,
    resolvedInputs: generated.resolved.map((one) => ({
      input: one.input,
      address: one.address,
      value: { coin: one.coin, assets: [] }
    })),
    protocolParameters: mainnetParameters
  })
  if (Either.isLeft(result)) throw new Error(`seed ${seed} was refused: ${result.left.message}`)
  return { generated, effects: result.right }
}

describe(`${runs} generated transactions`, () => {
  it("accounts for every lovelace, on every seed", () => {
    // The generator funds each transaction to the ledger's own equation, so a
    // non-zero figure here is the derivation disagreeing with the ledger.
    const unbalanced = seeds.filter((seed) => effectsFor(seed).effects.unaccounted !== 0n)
    expect(unbalanced).toEqual([])
  })

  it("reaches the same deposits and refunds the transaction was funded for", () => {
    for (const seed of seeds) {
      const { effects, generated } = effectsFor(seed)
      expect({ deposits: totalOf(effects.deposits), refunds: totalOf(effects.refunds) }, `seed ${seed}`).toEqual(
        generated.funded
      )
    }
  })

  it("explains the user's delta by the fee, the deposits and who else was paid", () => {
    for (const seed of seeds) {
      const { effects } = effectsFor(seed)
      const { deposits, donation, fee, refunds, total, user } = effects
      const othersSpent = total.inputs - user.spent
      const othersReceived = total.outputs - user.received
      const othersWithdrew = total.withdrawn - user.withdrawn
      expect(user.ada, `seed ${seed}`).toBe(
        fee +
          totalOf(deposits) +
          donation -
          totalOf(refunds) -
          user.withdrawn +
          othersReceived -
          othersSpent -
          othersWithdrew
      )
    }
  })

  it("puts each input, output and withdrawal on the side the generator meant it for", () => {
    for (const seed of seeds) {
      const { effects, generated } = effectsFor(seed)
      expect(
        { spent: effects.user.spent, received: effects.user.received, withdrawn: effects.user.withdrawn },
        `seed ${seed}`
      ).toEqual(generated.expected)
    }
  })

  it("never reads a negative deposit or refund", () => {
    for (const seed of seeds) {
      const { effects } = effectsFor(seed)
      for (const one of [...effects.deposits, ...effects.refunds]) {
        expect(one.amount, `seed ${seed}`).toBeGreaterThanOrEqual(0n)
      }
    }
  })

  it("generates every certificate the decoder models, so the deposit table cannot lose a row", () => {
    const seen = new Set<Certificate["_tag"]>(seeds.flatMap((seed) => effectsFor(seed).generated.certificateTags))
    expect(seen.size).toBe(certificateKindCount)
  })
})
