import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The verifier's stated signature, and the four places that state it (#107).
 *
 * `verifier` is a pure function, and which arguments it takes is the whole of
 * hard invariant 1. Two of the terms were found after the fact: resolved inputs
 * by the CBOR decode proof (ADR-0010), and protocol parameters by the effects
 * section of the spec, which cannot bound a fee, check the raise of an output to
 * the ledger minimum, tell a deposit from a spend, or show an expiry as a time
 * without them. Both times the term was discovered in one document and left
 * stale in the others, which is exactly the drift this file exists to catch.
 *
 * The stakes are not documentation tidiness. A term that reaches an
 * implementation as "and whatever else you need" gets fetched at the moment it
 * is wanted — mid-derivation, over the network, from a service that can be
 * slow, absent or hostile — and the check that stands between a person and a
 * signature acquires a dependency that can make it fail open.
 *
 * This asserts the statements agree. The no-I/O test over the real code lands
 * with the package; a comment is not a guarantee, and neither is a sentence.
 */

const root = join(import.meta.dirname, "..")
const read = (...path: Array<string>): string => readFileSync(join(root, ...path), "utf8")

const claude = read("CLAUDE.md")
const architecture = read("docs", "ARCHITECTURE.md")
const requirements = read("docs", "REQUIREMENTS.md")
const spec = read("spec", "CIP-XXXX", "README.md")

/** Every term list written as `pure function of (a, b, c)`, as sets of terms. */
const signatures = (source: string): Array<Array<string>> =>
  [...source.matchAll(/pure function of \(([^)]+)\)/g)].map((match) =>
    match[1]
      .split(",")
      .map((term) => term.trim())
      .sort()
  )

const expected = ["declared metadata", "protocol parameters", "resolved inputs", "tx CBOR", "user addresses"]

describe("the signature the docs state", () => {
  it.each([
    { file: "CLAUDE.md", source: claude },
    { file: "docs/ARCHITECTURE.md", source: architecture }
  ])("$file names all five terms", ({ source }) => {
    const stated = signatures(source)
    expect(stated.length).toBeGreaterThan(0)
    for (const terms of stated) expect(terms).toEqual(expected)
  })

  it("says the same thing in both places", () => {
    // The failure this file exists for: one document corrected, the other not.
    expect(signatures(claude)).toEqual(signatures(architecture))
  })

  it("states in each that the terms are arguments rather than lookups", () => {
    // Purity is the claim; "takes five arguments" without it would be satisfied
    // by an engine that fetched all five itself.
    expect(claude).toMatch(/arrive as arguments, never as lookups/)
    expect(architecture).toMatch(/performs no I\/O/)
    expect(requirements).toMatch(/supplied as arguments and never fetched mid-derivation/)
  })
})

describe("what derivation itself takes", () => {
  // Four of the five: the declared metadata takes no part in the arithmetic,
  // only in the comparison that follows it. An implementation handed the
  // publisher's claims while deriving is one that can be tempted to use them.
  const derivation = [
    "the transaction bytes",
    "the value of every input the body spends",
    "the addresses the wallet controls",
    "the protocol parameters in force"
  ]

  it("is stated normatively in the spec, term by term", () => {
    expect(spec).toMatch(/The derivation takes four terms, and none of them is a lookup/)
    for (const term of derivation) expect(spec, `the spec does not name "${term}"`).toContain(term)
  })

  it("keeps the declared metadata out of the arithmetic", () => {
    expect(spec).toMatch(/nothing an endpoint said takes part in the arithmetic/)
    expect(architecture).toMatch(/the declared metadata is the comparison's business, not the arithmetic's/)
  })

  it("names the protocol parameters the effects section actually needs", () => {
    // Each one is load-bearing for a rule in the comparison: the fee ceiling,
    // the raise to an output's minimum, the deposit, and the expiry.
    for (const parameter of [
      /minimum-fee coefficients/,
      /per-byte cost/,
      /stake deposit and its\s+refund/,
      /slot-to-time mapping|slot to wall-clock time/
    ]) {
      expect(architecture).toMatch(parameter)
      expect(spec).toMatch(parameter)
    }
  })
})

describe("what the requirements say the client derives from", () => {
  it("no longer says the tx CBOR alone", () => {
    expect(requirements).toMatch(/the values of the inputs it spends and the protocol parameters in force/)
  })
})
