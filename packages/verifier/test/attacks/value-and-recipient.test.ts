import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { Intent } from "@cardano-slips/core"

import type { Verdict } from "../../src/compare.js"
import { compare } from "../../src/compare.js"
import { deriveAssets, deriveLovelace } from "../../src/derive.js"
import type { Slip } from "../support/attacks.js"
import { comparisonOf, derivationOf } from "../support/attacks.js"
import { attacks, honest } from "./value-and-recipient.js"

const verdictOf = (slip: Slip): Verdict => {
  const result = compare(comparisonOf(slip))
  if (Either.isLeft(result)) throw new Error(`it refused to compare: ${result.left.message}`)
  return result.right
}

const readIntent = Schema.decodeUnknownEither(Intent)

describe("the honest tip every case here is one edit away from", () => {
  it("signs", () => {
    // Without this the whole file would pass against a comparison that blocked
    // everything, which is not a security property.
    expect(verdictOf(honest)).toEqual({ _tag: "match" })
  })
})

describe("value and recipient lies", () => {
  it.each(attacks.map((attack) => [attack.name, attack] as const))("%s is blocked", (_, attack) => {
    expect(verdictOf(attack)).toEqual({ _tag: "mismatch", reasons: attack.blocked })
  })

  it.each(attacks.map((attack) => [attack.name, attack] as const))(
    "%s tells a lie an endpoint could really have sent",
    (_, attack) => {
      // A declaration no schema accepts would have been refused before the
      // comparison ran, and a case blocked for that reason proves nothing.
      expect(Either.isRight(readIntent(attack.declared))).toBe(true)
    }
  )

  it("documents the lie each case tells, under a name no other case uses", () => {
    expect(attacks.every((attack) => attack.lie.length > 0)).toBe(true)
    expect(new Set(attacks.map((attack) => attack.name)).size).toBe(attacks.length)
  })

  it("gives at least one reason for every block", () => {
    expect(attacks.every((attack) => attack.blocked.length > 0)).toBe(true)
  })
})

describe("every case is a transaction the ledger would take", () => {
  // A lying transaction nobody could submit is not evidence of anything, so
  // each one balances: what it consumes equals what it produces.
  const named: ReadonlyArray<readonly [string, Slip]> = [
    ["honest", honest],
    ...attacks.map((attack) => [attack.name, attack] as const)
  ]

  it.each(named)("%s balances", (_, slip) => {
    const derivation = derivationOf(slip)
    expect(Either.getOrThrow(deriveLovelace(derivation)).unaccounted).toBe(0n)
    expect(Either.getOrThrow(deriveAssets(derivation)).unaccounted).toEqual([])
  })
})
