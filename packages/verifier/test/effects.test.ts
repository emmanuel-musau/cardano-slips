import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { toHex } from "../src/bytes.js"
import type { Effects, UnsupportedMember } from "../src/derive.js"
import { deriveCertificates, deriveEffects, deriveMint, deriveValidity, deriveWithdrawals } from "../src/derive.js"
import { minimumLovelace } from "../src/minimums.js"
import { fromHex } from "./support/bytes.js"
import { derivationOf, mainnetParameters } from "./support/derivation.js"
import { fixture, fixtures } from "./support/fixtures.js"

/**
 * The derived view the comparison reads. Assembling it once here rather than in
 * `compare` keeps one answer to whose an address is — a second opinion on
 * ownership would be a second security model.
 */

const effectsOf = (name: string): Effects => {
  const result = deriveEffects(derivationOf(fixture(name)))
  if (Either.isLeft(result)) throw new Error(`${name} was refused: ${result.left.message}`)
  return result.right
}

describe("over every fixture", () => {
  it.each(fixtures.map((one) => one.name))("%s derives without refusing", (name) => {
    expect(Either.isRight(deriveEffects(derivationOf(fixture(name))))).toBe(true)
  })

  it.each(fixtures.map((one) => one.name))("%s reports what the separate derivations report", (name) => {
    // One assembly, not a second implementation: if these ever disagree the
    // comparison is reading something the person is not shown.
    const derivation = derivationOf(fixture(name))
    const effects = effectsOf(name)
    expect(effects.certificates).toEqual(Either.getOrThrow(deriveCertificates(derivation)))
    expect(effects.withdrawals).toEqual(Either.getOrThrow(deriveWithdrawals(derivation)))
    expect(effects.mint).toEqual(Either.getOrThrow(deriveMint(derivation)))
    expect(effects.validity).toEqual(Either.getOrThrow(deriveValidity(derivation)))
    expect(effects.fee).toBe(derivation.transaction.body.fee)
  })

  it.each(fixtures.map((one) => one.name))("%s carries every output the body pays, in body order", (name) => {
    const { outputs } = derivationOf(fixture(name)).transaction.body
    const effects = effectsOf(name)
    expect(effects.outputs.map((output) => output.index)).toEqual(outputs.map((_, index) => index))
    expect(effects.outputs.map((output) => toHex(output.address))).toEqual(outputs.map((one) => toHex(one.address)))
    expect(effects.outputs.map((output) => output.value.coin)).toEqual(outputs.map((one) => one.value.coin))
  })

  it.each(fixtures.map((one) => one.name))("%s sizes every output at what the ledger charged it", (name) => {
    // A mainnet transaction that was accepted satisfies the ledger's minimum
    // ADA, so a size taken from the encoding has to clear it. An invented size
    // would fail here, and the fee ceiling rests on the same reading.
    for (const output of effectsOf(name).outputs) {
      expect(output.size).toBeGreaterThan(0)
      expect(minimumLovelace(output.size, mainnetParameters)).toBeLessThanOrEqual(output.value.coin)
    }
  })

  it.each(fixtures.map((one) => one.name))("%s sizes the transaction at the bytes it arrived as", (name) => {
    expect(effectsOf(name).size).toBe(fromHex(fixture(name).cbor).length)
  })
})

describe("ownership", () => {
  it("marks the outputs paying the signer, and only those", () => {
    const name = "payment-legacy-outputs"
    const owned = new Set(fixture(name).user.addresses)
    for (const output of effectsOf(name).outputs) {
      expect(output.mine).toBe(owned.has(toHex(output.address)))
    }
  })

  it("finds at least one output that is not the signer's, so the check is not vacuous", () => {
    expect(effectsOf("payment-legacy-outputs").outputs.some((output) => !output.mine)).toBe(true)
  })
})

describe("body members this version cannot describe", () => {
  const carries = (name: string, member: UnsupportedMember): void => {
    expect(effectsOf(name).unsupported).toContain(member)
  }

  it.each([
    ["collateral-and-reference-inputs", "reference-input"],
    ["collateral-and-reference-inputs", "collateral"],
    ["collateral-return-and-total", "collateral"],
    ["required-signers", "required-signer"],
    ["governance-vote", "vote"],
    ["proposal-treasury-withdrawals", "proposal"],
    ["both-output-forms-and-inline-datum", "datum"],
    ["legacy-output-with-datum-hash", "datum"]
  ] as ReadonlyArray<readonly [string, UnsupportedMember]>)("%s carries %s", (name, member) => {
    carries(name, member)
  })

  it("names nothing on an ordinary payment", () => {
    // The other half of the rule: a gate that reported an unsupported member on
    // an honest transaction would block every Slip there is.
    for (const name of ["payment-legacy-outputs", "payment-post-alonzo-outputs", "usdm-payment", "withdrawal"]) {
      expect(effectsOf(name).unsupported, name).toEqual([])
    }
  })
})
