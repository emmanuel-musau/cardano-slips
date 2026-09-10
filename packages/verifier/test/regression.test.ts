/**
 * The proof, as one run: every transaction that lies is blocked, and every
 * transaction that tells the truth still signs. The per-file suites check that
 * each case blocks for the right reasons; this one checks that the set is whole
 * and that neither number has moved.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import * as certificates from "./attacks/certificates-and-withdrawals.js"
import * as mint from "./attacks/mint-and-validity.js"
import * as value from "./attacks/value-and-recipient.js"
import type { Outcome } from "./support/census.js"
import {
  falseNegatives,
  falseNegativesIn,
  falsePositives,
  falsePositivesIn,
  outcomes,
  report
} from "./support/census.js"

const attacks = [...value.attacks, ...certificates.attacks, ...mint.attacks]

const reportPath = join(import.meta.dirname, "..", "build", "reports", "attack-examples.json")

describe("the block rate", () => {
  it("blocks every transaction whose declared metadata lies", () => {
    // The one that matters. A name here is a transaction a person would have
    // been asked to sign, believing something the transaction contradicts.
    expect(falseNegatives.map((outcome) => `${outcome.group}/${outcome.name}`)).toEqual([])
  })

  it("signs every transaction that does what it declared", () => {
    // The failure nobody reports, because nothing is stolen: a gate so strict
    // the honest path never opens satisfies every assertion above.
    expect(falsePositives.map((outcome) => `${outcome.group}/${outcome.name}`)).toEqual([])
  })
})

describe("what the rate is counted over", () => {
  it("runs every attack example that exists", () => {
    // Guards the two assertions above from passing over a census that quietly
    // stopped collecting a file.
    const counted = outcomes.filter((outcome) => outcome.expected === "block" && outcome.kind === "transaction")
    expect(counted.length).toBe(attacks.length)
    expect(new Set(counted.map((outcome) => outcome.name))).toEqual(new Set(attacks.map((attack) => attack.name)))
  })

  it("runs an honest transaction alongside every group of attacks", () => {
    const honest = outcomes.filter((outcome) => outcome.expected === "sign" && outcome.kind === "transaction")
    expect(honest.map((outcome) => outcome.group).sort()).toEqual([
      "certificates-and-withdrawals",
      "mint-and-validity",
      "value-and-recipient"
    ])
  })

  it("counts the published verdicts too, and keeps them apart from the transactions", () => {
    // They state effects rather than encode bytes, so they prove the rule
    // without proving the path a real signature takes. Same suite, own column.
    const table = outcomes.filter((outcome) => outcome.kind === "table")
    expect(table.length).toBeGreaterThanOrEqual(34)
    expect(table.every((outcome) => outcome.group === "published-verdicts")).toBe(true)
  })

  it("names every case once", () => {
    const names = outcomes.map((outcome) => `${outcome.group}/${outcome.name}`)
    expect(new Set(names).size).toBe(names.length)
  })

  it("gives a reason for every block and none for anything it signs", () => {
    for (const outcome of outcomes) {
      expect(outcome.reasons.length > 0).toBe(outcome.actual === "block")
    }
  })

  it("says what each blocked transaction lies about", () => {
    // A case with no stated lie is one nobody can review, and this set is
    // published for exactly that.
    const lying = outcomes.filter((outcome) => outcome.expected === "block" && outcome.kind === "transaction")
    expect(lying.every((outcome) => outcome.lie.length > 0)).toBe(true)
  })
})

describe("the counting itself", () => {
  // Both assertions at the top of this file read an empty list when the gate
  // holds, and an empty list is also what a census that notices nothing
  // returns. These say which of the two is happening.
  const outcome = (expected: Outcome["expected"], actual: Outcome["actual"]): Outcome => ({
    name: "made-up",
    group: "made-up",
    kind: "transaction",
    expected,
    actual,
    lie: "none: this case exists to be counted, not to be signed",
    reasons: actual === "block" ? ["output.lovelace"] : []
  })

  it("counts a lying transaction that signed as a false negative", () => {
    expect(falseNegativesIn([outcome("block", "sign")])).toHaveLength(1)
    expect(falseNegativesIn([outcome("block", "block")])).toEqual([])
  })

  it("counts an honest transaction that was blocked as a false positive", () => {
    expect(falsePositivesIn([outcome("sign", "block")])).toHaveLength(1)
    expect(falsePositivesIn([outcome("sign", "sign")])).toEqual([])
  })
})

describe("the report", () => {
  it("states the rate the project publishes", () => {
    const { blocked, signed, transactions } = report()
    expect(blocked.correct).toBe(blocked.cases)
    expect(signed.correct).toBe(signed.cases)
    expect(transactions.blocked.cases).toBe(attacks.length)
  })

  it("is the same bytes on every run over the same tree", () => {
    // Machine-readable output that carries a timestamp is output nothing can
    // diff, and the evidence report reads this file across runs.
    expect(JSON.stringify(report())).toBe(JSON.stringify(report()))
  })
})

afterAll(() => {
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report(), null, 2)}\n`)
})
