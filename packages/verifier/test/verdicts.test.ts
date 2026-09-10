import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { compare } from "../src/compare.js"
import { minimumChangeLovelace, minimumFee, minimumLovelace } from "../src/minimums.js"
import { cases, comparisonOf } from "./support/verdicts.js"
import { mainnetParameters } from "./support/derivation.js"
import { decodeBech32 } from "../src/bech32.js"

/**
 * The CIP publishes its comparison as behaviour: a table of declared intent,
 * derived effects and the verdict each pair MUST produce. `test/spec-effects.test.ts`
 * at the repo root runs it against a reference comparator written from the
 * text; this runs the same table against the code that will block a real
 * signature, which is the only version of it that protects anyone.
 */

const codes = (entry: (typeof cases)[number]): Array<string> => {
  const verdict = compare(comparisonOf(entry))
  if (Either.isLeft(verdict)) throw new Error(`${entry.name} could not be compared: ${verdict.left.message}`)
  if (verdict.right._tag === "match") return []
  return [...new Set(verdict.right.reasons.map((reason) => reason.code))].sort()
}

describe("the published table of verdicts", () => {
  it.each(cases)("$name", (entry) => {
    const reported = codes(entry)
    expect(reported).toEqual([...entry.reasons].sort())
    expect(reported.length === 0 ? "sign" : "block").toBe(entry.verdict)
  })

  it("has cases to run", () => {
    // Guards every assertion above from passing over an empty table.
    expect(cases.length).toBeGreaterThanOrEqual(34)
  })

  it("never blocks a transaction that does exactly what was declared", () => {
    // The failure mode nobody reports: a gate so strict the honest path never
    // opens. Blocking everything would satisfy every other test here.
    const signing = cases.filter((entry) => entry.verdict === "sign")
    expect(signing.length).toBeGreaterThanOrEqual(8)
    for (const entry of signing) expect(codes(entry)).toEqual([])
  })

  it("reaches every reason the table asks for", () => {
    const reported = new Set(cases.flatMap(codes))
    const asked = new Set(cases.flatMap((entry) => entry.reasons))
    expect([...asked].filter((reason) => !reported.has(reason))).toEqual([])
  })
})

describe("the bounds the table states as parameters", () => {
  // The table hands each case a minimum fee, a change minimum and a minimum per
  // declared output. The engine computes all three instead, so these prove the
  // arithmetic lands on the published figures rather than near them.

  it("computes the change minimum the table states, from the change address alone", () => {
    for (const entry of cases) {
      const address = decodeBech32(entry.changeAddress)
      if (Either.isLeft(address)) throw new Error(entry.changeAddress)
      expect(minimumChangeLovelace(address.right.bytes, mainnetParameters)).toBe(
        BigInt(entry.parameters.minChangeLovelace)
      )
    }
  })

  it("computes each stated minimum fee from a transaction size", () => {
    for (const entry of cases) {
      const size = comparisonOf(entry).effects.size
      expect(minimumFee(size, mainnetParameters)).toBe(BigInt(entry.parameters.minFee))
    }
  })

  it("computes each stated output minimum from the output's encoded size", () => {
    for (const entry of cases) {
      const { effects } = comparisonOf(entry)
      const declared = entry.declared.outputs ?? []
      const seen = new Map<string, number>()
      for (const [index, output] of entry.derived.outputs.entries()) {
        const position = seen.get(output.address) ?? 0
        seen.set(output.address, position + 1)
        const at = declared.map((one, where) => ({ one, where })).filter(({ one }) => one.address === output.address)[
          position
        ]
        if (at === undefined) continue
        expect(minimumLovelace(effects.outputs[index].size, mainnetParameters)).toBe(
          BigInt(entry.parameters.minLovelace[at.where])
        )
      }
    }
  })
})
