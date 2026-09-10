/**
 * Every example the block-rate claim is made over, assembled in one place: the
 * attack transactions, the honest transaction each one is an edit away from,
 * and the CIP's own published pairs. Counting them here rather than in each
 * file is what stops a case being asserted in one place and missed in another.
 */
import { Either } from "effect"

import type { ReasonCode, Verdict } from "../../src/compare.js"
import { compare } from "../../src/compare.js"
import * as certificates from "../attacks/certificates-and-withdrawals.js"
import * as mint from "../attacks/mint-and-validity.js"
import * as value from "../attacks/value-and-recipient.js"
import type { Slip } from "./attacks.js"
import { comparisonOf as comparisonOfSlip } from "./attacks.js"
import type { Case as TableCase } from "./verdicts.js"
import { cases as tableCases, comparisonOf as comparisonOfCase } from "./verdicts.js"

export type Expectation = "sign" | "block"

/**
 * `transaction` cases are bytes: encoded here, decoded by the package's own
 * decoder, derived by its own derivation. `table` cases state the effects
 * directly, so they prove the rule without proving the path a signature takes.
 * The two are counted apart because they are not the same kind of evidence.
 */
export type Kind = "transaction" | "table"

export type Outcome = {
  readonly name: string
  readonly group: string
  readonly kind: Kind
  readonly expected: Expectation
  readonly actual: Expectation
  /** What this one lies about, in the words a person would use. Empty where it tells the truth. */
  readonly lie: string
  readonly reasons: ReadonlyArray<ReasonCode>
}

const verdictOf = (comparison: Parameters<typeof compare>[0], name: string): Verdict => {
  const result = compare(comparison)
  // A declaration the comparison cannot read is neither a block nor a pass, so
  // it would leave a hole in the census rather than fill a row in it.
  if (Either.isLeft(result)) throw new Error(`${name} could not be compared: ${result.left.message}`)
  return result.right
}

const readingOf = (verdict: Verdict): { actual: Expectation; reasons: ReadonlyArray<ReasonCode> } =>
  verdict._tag === "match"
    ? { actual: "sign", reasons: [] }
    : { actual: "block", reasons: [...new Set(verdict.reasons.map((reason) => reason.code))].sort() }

const fromSlip = (group: string, name: string, expected: Expectation, lie: string, slip: Slip): Outcome => ({
  name,
  group,
  kind: "transaction",
  expected,
  lie,
  ...readingOf(verdictOf(comparisonOfSlip(slip), `${group}/${name}`))
})

const fromTable = (entry: TableCase): Outcome => ({
  name: entry.name,
  group: "published-verdicts",
  kind: "table",
  expected: entry.verdict,
  lie: "",
  ...readingOf(verdictOf(comparisonOfCase(entry), entry.name))
})

const groups = [
  { name: "value-and-recipient", ...value },
  { name: "certificates-and-withdrawals", ...certificates },
  { name: "mint-and-validity", ...mint }
]

export const outcomes: ReadonlyArray<Outcome> = [
  ...groups.flatMap(({ attacks, honest, name }) => [
    fromSlip(name, "honest", "sign", "", honest),
    ...attacks.map((attack) => fromSlip(name, attack.name, "block", attack.lie, attack))
  ]),
  ...tableCases.map(fromTable)
]

/** A transaction that lies and was not blocked. The only figure here that means someone could be robbed. */
export const falseNegativesIn = (of: ReadonlyArray<Outcome>): ReadonlyArray<Outcome> =>
  of.filter((outcome) => outcome.expected === "block" && outcome.actual === "sign")

/** An honest transaction the gate refused. Nobody loses money, and the protocol stops working. */
export const falsePositivesIn = (of: ReadonlyArray<Outcome>): ReadonlyArray<Outcome> =>
  of.filter((outcome) => outcome.expected === "sign" && outcome.actual === "block")

export const falseNegatives: ReadonlyArray<Outcome> = falseNegativesIn(outcomes)
export const falsePositives: ReadonlyArray<Outcome> = falsePositivesIn(outcomes)

const tally = (of: ReadonlyArray<Outcome>, expected: Expectation) => {
  const wanted = of.filter((outcome) => outcome.expected === expected)
  return { cases: wanted.length, correct: wanted.filter((outcome) => outcome.actual === expected).length }
}

/** Deterministic: no timestamp, no run id. Two runs over the same tree produce the same bytes. */
export const report = () => ({
  cases: outcomes.length,
  blocked: tally(outcomes, "block"),
  signed: tally(outcomes, "sign"),
  transactions: {
    blocked: tally(
      outcomes.filter((outcome) => outcome.kind === "transaction"),
      "block"
    ),
    signed: tally(
      outcomes.filter((outcome) => outcome.kind === "transaction"),
      "sign"
    )
  },
  falseNegatives: falseNegatives.map((outcome) => outcome.name),
  falsePositives: falsePositives.map((outcome) => outcome.name),
  results: outcomes
})
