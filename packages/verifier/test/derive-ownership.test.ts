/**
 * Whose address it is. The spec requires an address the wallet did not report
 * to be treated as someone else's: that overstates what leaves and understates
 * what returns, where the other direction would hide a payment to a stranger by
 * calling it change.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { LovelaceEffects } from "../src/derive.js"
import { deriveLovelace } from "../src/derive.js"
import { fromHex } from "./support/bytes.js"
import { derivationOf } from "./support/derivation.js"
import { fixture } from "./support/fixtures.js"

const withdrawal = fixture("withdrawal")
const [paymentAddress, rewardAccount] = withdrawal.user.addresses

const derived = (addresses: ReadonlyArray<string>): LovelaceEffects => {
  const result = deriveLovelace({ ...derivationOf(withdrawal), userAddresses: addresses.map(fromHex) })
  if (Either.isLeft(result)) throw new Error(result.left.message)
  return result.right
}

describe("an address the wallet did not report", () => {
  it("counts an output to it as leaving, not as change", () => {
    const effects = derived([])
    expect(effects.user.received).toBe(0n)
    expect(effects.user.spent).toBe(0n)
    // The output is still the transaction's, and the total is untouched.
    expect(String(effects.total.outputs)).toBe(withdrawal.chain.totalOutput)
  })

  it("counts a withdrawal from it as someone else's rewards", () => {
    const effects = derived([paymentAddress])
    expect(effects.user.withdrawn).toBe(0n)
    expect(String(effects.total.withdrawn)).toBe(withdrawal.chain.withdrawals[0].amount)
  })

  it("leaves the ledger's own equation alone either way", () => {
    // Ownership decides what the person is shown, never what the ledger did.
    for (const addresses of [[], [paymentAddress], [paymentAddress, rewardAccount]]) {
      expect(derived(addresses).unaccounted).toBe(0n)
    }
  })
})

describe("an address that is nearly the user's", () => {
  /** The same payment credential, someone else's stake part — spendable by the user, staked by another. */
  const restaked = paymentAddress.slice(0, 58) + "ff".repeat(28)

  it("is not the user's, because the wallet never reported it", () => {
    expect(restaked).not.toBe(paymentAddress)
    expect(restaked.slice(0, 58)).toBe(paymentAddress.slice(0, 58))
    expect(derived([restaked, rewardAccount]).user.received).toBe(0n)
  })
})

describe("the whole address set", () => {
  it("reads the fixture's own figures back", () => {
    const effects = derived(withdrawal.user.addresses)
    expect({
      spent: String(effects.user.spent),
      received: String(effects.user.received),
      ada: String(effects.user.ada),
      withdrawn: String(effects.user.withdrawn)
    }).toEqual({
      spent: withdrawal.user.spent,
      received: withdrawal.user.received,
      ada: withdrawal.user.ada,
      withdrawn: withdrawal.chain.withdrawals[0].amount
    })
  })
})
