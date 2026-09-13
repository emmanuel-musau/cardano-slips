import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { Intent } from "@cardano-slips/core"

import type { Verdict } from "../../src/compare.js"
import { compare } from "../../src/compare.js"
import { deriveAssets, deriveLovelace } from "../../src/derive.js"
import type { Slip } from "../support/attacks.js"
import { comparisonOf, derivationOf } from "../support/attacks.js"
import { attacks, honest, statedRefund } from "./certificates-and-withdrawals.js"

const verdictOf = (slip: Slip): Verdict => {
  const result = compare(comparisonOf(slip))
  if (Either.isLeft(result)) throw new Error(`it refused to compare: ${result.left.message}`)
  return result.right
}

const readIntent = Schema.decodeUnknownEither(Intent)

describe("the honest delegation every case here is one edit away from", () => {
  it("signs", () => {
    expect(verdictOf(honest)).toEqual({ _tag: "match" })
  })
})

describe("the refund a deregistration states", () => {
  it("signs even where it is not the current parameter", () => {
    // The asymmetry ADR-0013 settles. A stated deposit blocks on a difference;
    // a stated refund cannot, because the ledger returns what the credential was
    // registered under and no argument this engine is handed says what that was.
    expect(verdictOf(statedRefund)).toEqual({ _tag: "match" })
  })
})

describe("certificate and withdrawal lies", () => {
  it.each(attacks.map((attack) => [attack.name, attack] as const))("%s is blocked", (_, attack) => {
    expect(verdictOf(attack)).toEqual({ _tag: "mismatch", reasons: attack.blocked })
  })

  it.each(attacks.map((attack) => [attack.name, attack] as const))(
    "%s tells a lie an endpoint could really have sent",
    (_, attack) => {
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
  const named: ReadonlyArray<readonly [string, Slip]> = [
    ["honest", honest],
    ["stated-refund", statedRefund],
    ...attacks.map((attack) => [attack.name, attack] as const)
  ]

  it.each(named)("%s balances", (_, slip) => {
    // The certificates here lock deposits up and hand refunds back, and a
    // withdrawal brings rewards in: a case that did not balance would not be a
    // transaction anyone could submit.
    const derivation = derivationOf(slip)
    expect(Either.getOrThrow(deriveLovelace(derivation)).unaccounted).toBe(0n)
    expect(Either.getOrThrow(deriveAssets(derivation)).unaccounted).toEqual([])
  })
})
