import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { Intent } from "@cardano-slips/core"

import { deriveAssets, deriveLovelace } from "../../src/derive.js"
import type { Slip } from "../support/attacks.js"
import { comparisonOf, derivationOf } from "../support/attacks.js"
import { groups } from "../support/attack-groups.js"
import { verdictOf } from "../support/verdict.js"
import { statedRefund } from "./certificates-and-withdrawals.js"

const readIntent = Schema.decodeUnknownEither(Intent)

const verdictOfSlip = (slip: Slip, name: string) => verdictOf(comparisonOf(slip), name)

describe.each(groups)("$title", ({ attacks, honest }) => {
  const cases = attacks.map((attack) => [attack.name, attack] as const)

  it("signs the honest transaction every case is one edit away from", () => {
    // Without this the group would pass against a comparison that blocked everything.
    expect(verdictOfSlip(honest, "honest")).toEqual({ _tag: "match" })
  })

  it.each(cases)("%s is blocked", (name, attack) => {
    expect(verdictOfSlip(attack, name)).toEqual({ _tag: "mismatch", reasons: attack.blocked })
  })

  it.each(cases)("%s tells a lie an endpoint could really have sent", (_, attack) => {
    // A declaration no schema accepts is refused before the comparison runs, and proves nothing.
    expect(Either.isRight(readIntent(attack.declared))).toBe(true)
  })

  it("documents the lie each case tells, under a name no other case uses", () => {
    expect(attacks.every((attack) => attack.lie.length > 0)).toBe(true)
    expect(new Set(attacks.map((attack) => attack.name)).size).toBe(attacks.length)
  })

  it("gives at least one reason for every block", () => {
    expect(attacks.every((attack) => attack.blocked.length > 0)).toBe(true)
  })

  // A lying transaction nobody could submit is not evidence of anything.
  it.each([["honest", honest] as const, ...cases])("%s balances", (_, slip) => {
    const derivation = derivationOf(slip)
    expect(Either.getOrThrow(deriveLovelace(derivation)).unaccounted).toBe(0n)
    expect(Either.getOrThrow(deriveAssets(derivation)).unaccounted).toEqual([])
  })
})

describe("the refund a deregistration states", () => {
  it("signs even where it is not the current parameter", () => {
    // ADR-0013: the ledger returns what the credential was registered under, which no argument here says.
    expect(verdictOfSlip(statedRefund, "stated-refund")).toEqual({ _tag: "match" })
  })

  it("balances", () => {
    const derivation = derivationOf(statedRefund)
    expect(Either.getOrThrow(deriveLovelace(derivation)).unaccounted).toBe(0n)
    expect(Either.getOrThrow(deriveAssets(derivation)).unaccounted).toEqual([])
  })
})
