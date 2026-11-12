/**
 * Every example the block-rate claim is made over, assembled in one place: the
 * attack transactions, the honest transaction each one is an edit away from,
 * and the CIP's own published pairs. Counting them here rather than in each
 * file is what stops a case being asserted in one place and missed in another.
 */
import type { ReasonCode, Verdict } from "../../src/compare.js"
import { groups } from "./attack-groups.js"
import type { Slip } from "./attacks.js"
import { comparisonOf as comparisonOfSlip } from "./attacks.js"
import { verdictOf } from "./verdict.js"
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

const tallies = (kind: Kind) => {
  const of = outcomes.filter((outcome) => outcome.kind === kind)
  return { blocked: tally(of, "block"), signed: tally(of, "sign") }
}

/** Deterministic: no timestamp, no run id. Two runs over the same tree produce the same bytes. */
export const report = () => ({
  cases: outcomes.length,
  blocked: tally(outcomes, "block"),
  signed: tally(outcomes, "sign"),
  transactions: tallies("transaction"),
  table: tallies("table"),
  falseNegatives: falseNegatives.map((outcome) => outcome.name),
  falsePositives: falsePositives.map((outcome) => outcome.name),
  results: outcomes
})

/** Escapes a value for one Markdown table cell, outside a code span. */
export const cell = (text: string): string =>
  text.replace(/\s*\n\s*/g, " ").replace(/[\\`|*_]/g, (character) => `\\${character}`)

const reasonsOf = (outcome: Outcome): string =>
  outcome.reasons.length === 0 ? "—" : outcome.reasons.map((code) => `\`${code}\``).join(", ")

const verdictCell = (outcome: Outcome): string => {
  const word = outcome.actual === "block" ? "blocked" : "signed"
  return outcome.actual === outcome.expected
    ? word
    : `**${word}, should have been ${outcome.expected === "block" ? "blocked" : "signed"}**`
}

/** The report as a page a person reads, written from the same run as `report`. */
export const page = (of: ReturnType<typeof report>): string => {
  const table = of.results.filter((outcome) => outcome.kind === "table")
  const transactions = of.results.filter((outcome) => outcome.kind === "transaction")

  const groupSections = groups.flatMap(({ name: group, title }) => [
    `## ${title}`,
    "",
    `\`${group}.ts\``,
    "",
    "| Case | Verdict | What it lies about | Reasons |",
    "| --- | --- | --- | --- |",
    ...transactions
      .filter((outcome) => outcome.group === group)
      .map(
        (outcome) =>
          `| \`${outcome.name}\` | ${verdictCell(outcome)} | ${outcome.expected === "sign" ? "nothing: every case below is one edit away from this transaction" : cell(outcome.lie)} | ${reasonsOf(outcome)} |`
      ),
    ""
  ])

  return [
    "# Attack examples: the block-rate report",
    "",
    "Written by `test/regression.test.ts` from its own run. CI fails when this file",
    "differs from what the run produces, so it cannot describe a run that no longer",
    "happens. Rewrite it with `pnpm attack-examples -u`, never by hand.",
    "",
    "| | Cases | Correct |",
    "| --- | ---: | ---: |",
    `| Transactions that lie, blocked | ${of.transactions.blocked.cases} | ${of.transactions.blocked.correct} |`,
    `| Honest transactions, signed | ${of.transactions.signed.cases} | ${of.transactions.signed.correct} |`,
    `| Verdict-table cases that must block, blocked | ${of.table.blocked.cases} | ${of.table.blocked.correct} |`,
    `| Verdict-table cases that must sign, signed | ${of.table.signed.cases} | ${of.table.signed.correct} |`,
    "",
    `Lying transactions that would have been signed: **${of.falseNegatives.length}**.`,
    `Honest transactions refused: **${of.falsePositives.length}**.`,
    "",
    ...groupSections,
    "## The spec's table of verdicts",
    "",
    "[`spec/examples/effects/verdicts.json`](../../../../spec/examples/effects/verdicts.json).",
    "These state effects rather than encode bytes, so they prove each rule without",
    "proving the path a real signature takes, and are counted apart from the",
    "transactions above.",
    "",
    "| Case | Verdict | Reasons |",
    "| --- | --- | --- |",
    ...table.map((outcome) => `| \`${outcome.name}\` | ${verdictCell(outcome)} | ${reasonsOf(outcome)} |`),
    ""
  ].join("\n")
}
