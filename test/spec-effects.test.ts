import { readFileSync } from "node:fs"
import { join } from "node:path"
// Named rather than default: ajv is CommonJS, and its default export only
// resolves to the class under `esModuleInterop`, which the base tsconfig does
// not enable. The named class is the same object and typechecks as one.
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

/**
 * Effects derivation and the mismatch gate (#19).
 *
 * This is the section the security model rests on, and it is the one section
 * whose subject a JSON Schema cannot reach. Every other shape in this
 * specification is a document that is either well formed or not; this one is a
 * comparison between two documents and a verdict about a signature. So the spec
 * publishes a table — a declared intent, the effects derived from the
 * transaction built out of it, and the verdict the pair MUST produce — and this
 * file runs that table against a reference comparator written from the numbered
 * rules in the text.
 *
 * The claim that makes is deliberately modest: it shows the table agrees with
 * an implementation of the written rules. `verifier`'s `compare.ts` runs the
 * same table, and the day the two disagree, one of them is wrong about the
 * specification rather than about itself.
 *
 * Three properties get the most attention, because each is load-bearing:
 *
 *   - Every derived effect is either declared or supplied. There is no third
 *     set, so an effect nobody thought to name is a block by default rather
 *     than by whether this file happened to test for it.
 *   - The comparison admits no tolerance. Both sides are integer base units,
 *     and the adjustments that look like tolerances — the raise to an output's
 *     minimum ADA, the fee ceiling — have exact computed values.
 *   - A mismatch has no way out. No retry, no rebuild, no override.
 */

const root = join(import.meta.dirname, "..")
const specPath = join(root, "spec", "CIP-XXXX", "README.md")
const schemas = join(root, "spec", "CIP-XXXX", "schemas")

const source = readFileSync(specPath, "utf8")
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

/** See the note in spec-get-discovery.test.ts for why strictRequired is off. */
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true })
const validateIntent: ValidateFunction = ajv.compile(
  readJson(join(schemas, "slip-partial-intent.schema.json")) as Record<string, unknown>
)

/** The section of the CIP under a heading, up to the next one. */
const slice = (heading: string, level: number): string => {
  const marker = `${"#".repeat(level)} ${heading}\n`
  const start = source.indexOf(marker)
  expect(start, `no "${marker.trim()}" section in the CIP`).toBeGreaterThan(-1)
  const rest = source.slice(start + marker.length)
  const end = rest.search(/^#{2,4} /m)
  return end === -1 ? rest : rest.slice(0, end)
}

/** Every markdown table in a chunk of text, as rows of trimmed cells. */
const tables = (text: string): Array<Array<Array<string>>> => {
  const found: Array<Array<Array<string>>> = []
  let current: Array<Array<string>> | undefined

  for (const line of text.split("\n")) {
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
      if (current === undefined) {
        current = []
        found.push(current)
      }
      if (!cells.every((cell) => /^-+$/.test(cell))) current.push(cells)
    } else {
      current = undefined
    }
  }
  return found
}

const unquote = (cell: string): string => cell.replaceAll("`", "")

type Asset = { readonly policyId: string; readonly assetName: string; readonly quantity: string }
type DeclaredOutput = { readonly address: string; readonly lovelace: string; readonly assets?: Array<Asset> }
type DerivedOutput = DeclaredOutput & { readonly mine: boolean }
type Certificate = { readonly type: string; readonly poolId?: string; readonly drep?: string }
type DerivedCertificate = Certificate & { readonly mine: boolean }

type Intent = {
  readonly outputs?: Array<DeclaredOutput>
  readonly certificates?: Array<Certificate>
  readonly withdrawRewards?: boolean
  readonly validUntil: string
}

/**
 * The derived effects, as the table renders them. They have no wire format —
 * nothing about them ever travels — so this shape exists only to make the
 * comparison testable, and carries exactly what the comparison reads. The net
 * ADA and asset deltas are absent for that reason: they are rendered to the
 * person, never compared against anything.
 */
type Derived = {
  readonly outputs: Array<DerivedOutput>
  readonly fee: string
  readonly certificates: Array<DerivedCertificate>
  readonly withdrawals: Array<{ readonly mine: boolean; readonly lovelace: string }>
  readonly mint: Array<Asset>
  readonly unsupported: Array<string>
  readonly validFrom: string | null
  readonly validUntil: string | null
}

/** The quantities only the protocol parameters can supply. */
type Parameters = {
  readonly minFee: string
  readonly minChangeLovelace: string
  /** The ledger minimum for each declared output, in the order they were declared. */
  readonly minLovelace: Array<string>
}

type Case = {
  readonly name: string
  readonly now: string
  readonly changeAddress: string
  readonly declared: Intent
  readonly parameters: Parameters
  readonly derived: Derived
  readonly verdict: "sign" | "block"
  readonly reasons: Array<string>
}

const cases = (readJson(join(root, "spec", "examples", "effects", "verdicts.json")) as { cases: Array<Case> }).cases

/**
 * The comparison as the CIP specifies it.
 *
 * Deliberately literal: it follows the rules in the order the text states them
 * rather than the order one would choose for an implementation. Anything
 * clever here would be testing the cleverness instead of the specification.
 */
const compare = (entry: Case): Array<string> => {
  const reasons = new Set<string>()
  const declaredOutputs = entry.declared.outputs ?? []

  // Each declared output has exactly one permitted lovelace amount: the
  // declared one, or the ledger's minimum where the declared one is below it.
  const permitted = declaredOutputs.map((output, index) => {
    const minimum = BigInt(entry.parameters.minLovelace[index] ?? "0")
    const asked = BigInt(output.lovelace)
    return asked < minimum ? minimum : asked
  })

  const key = (asset: Asset): string => `${asset.policyId}.${asset.assetName}`
  const totals = (outputs: ReadonlyArray<DeclaredOutput>): Map<string, bigint> => {
    const sums = new Map<string, bigint>()
    for (const output of outputs) {
      for (const asset of output.assets ?? []) {
        sums.set(key(asset), (sums.get(key(asset)) ?? 0n) + BigInt(asset.quantity))
      }
    }
    return sums
  }

  // Outputs, by address.
  const declaredAddresses = [...new Set(declaredOutputs.map((output) => output.address))]
  for (const address of declaredAddresses) {
    const here = declaredOutputs.map((output, index) => ({ output, index })).filter((e) => e.output.address === address)
    const paid = entry.derived.outputs.filter((output) => output.address === address)

    if (paid.length !== here.length) {
      // Where the counts differ the totals are not compared: one difference
      // explains the other.
      reasons.add(paid.length < here.length ? "output.missing" : "output.undeclared")
      continue
    }

    const asked = here.reduce((sum, e) => sum + permitted[e.index], 0n)
    if (paid.reduce((sum, output) => sum + BigInt(output.lovelace), 0n) !== asked) reasons.add("output.lovelace")

    const declaredAssets = totals(here.map((e) => e.output))
    const paidAssets = totals(paid)
    for (const name of new Set([...declaredAssets.keys(), ...paidAssets.keys()])) {
      if ((declaredAssets.get(name) ?? 0n) !== (paidAssets.get(name) ?? 0n)) reasons.add("output.assets")
    }
  }

  // Every output paying an address the intent does not declare must be change.
  for (const output of entry.derived.outputs) {
    if (!declaredAddresses.includes(output.address) && !output.mine) reasons.add("output.undeclared")
  }

  // Certificates: the first of the four rules that applies, and no more.
  const declaredCertificates = entry.declared.certificates ?? []
  const carried = entry.derived.certificates
  const target = (certificate: Certificate): string =>
    `${certificate.type}/${certificate.poolId ?? certificate.drep ?? ""}`

  if (carried.length !== declaredCertificates.length) {
    reasons.add(carried.length < declaredCertificates.length ? "certificate.missing" : "certificate.undeclared")
  } else if (declaredCertificates.every((certificate, index) => certificate.type === carried[index].type)) {
    if (declaredCertificates.some((certificate, index) => target(certificate) !== target(carried[index]))) {
      reasons.add("certificate.target")
    }
  } else if ([...declaredCertificates].map(target).sort().join() === [...carried].map(target).sort().join()) {
    reasons.add("certificate.order")
  } else {
    reasons.add("certificate.missing")
    reasons.add("certificate.undeclared")
  }

  for (const certificate of carried) if (!certificate.mine) reasons.add("certificate.credential")

  // The withdrawal.
  const withdrawals = entry.derived.withdrawals
  if (entry.declared.withdrawRewards === true) {
    if (withdrawals.length === 0) reasons.add("withdrawal.missing")
    if (withdrawals.length > 1) reasons.add("withdrawal.undeclared")
  } else if (withdrawals.length > 0) {
    reasons.add("withdrawal.undeclared")
  }
  for (const withdrawal of withdrawals) if (!withdrawal.mine) reasons.add("withdrawal.account")

  // Effects nothing in this version can declare.
  if (entry.derived.mint.length > 0) reasons.add("mint.undeclared")
  if (entry.derived.unsupported.length > 0) reasons.add("body.unsupported")

  // The fee, bounded by what the ledger required plus one change output.
  const ceiling = BigInt(entry.parameters.minFee) + BigInt(entry.parameters.minChangeLovelace)
  if (BigInt(entry.derived.fee) > ceiling) reasons.add("fee.excessive")

  // The validity interval, in wall-clock time.
  const at = (instant: string): number => Date.parse(instant)
  if (entry.derived.validUntil !== null && at(entry.derived.validUntil) > at(entry.declared.validUntil)) {
    reasons.add("interval.beyond-declared")
  }
  if (entry.derived.validFrom !== null && at(entry.derived.validFrom) > at(entry.now)) {
    reasons.add("interval.not-yet-valid")
  }

  return [...reasons].sort()
}

const reasonRows = tables(slice("Blocking", 3))[0] ?? []
const published = reasonRows.slice(1).map((row) => unquote(row[0] ?? ""))

describe("the published comparison table", () => {
  it.each(cases)("$name", (entry) => {
    const reasons = compare(entry)
    expect(reasons).toEqual([...entry.reasons].sort())
    expect(reasons.length === 0 ? "sign" : "block").toBe(entry.verdict)
  })

  it("declares only intents an endpoint could actually return", () => {
    // A case built on an intent no publisher may send would prove a behaviour
    // nothing can reach.
    const invalid = cases
      .map((entry) => ({
        name: entry.name,
        ok: validateIntent({ type: "partial", version: "1", intent: entry.declared })
      }))
      .filter(({ ok }) => !ok)
      .map(({ name }) => name)
    expect(invalid).toEqual([])
  })

  it("supplies a ledger minimum for every declared output", () => {
    // The raise is the one adjustment that changes an amount, and it is only
    // exact if the minimum comes from the protocol parameters rather than from
    // whatever the comparator felt like assuming.
    const short = cases
      .filter((entry) => entry.parameters.minLovelace.length !== (entry.declared.outputs ?? []).length)
      .map((entry) => entry.name)
    expect(short).toEqual([])
  })

  it("covers both verdicts, and every reason the CIP defines", () => {
    expect(cases.some((entry) => entry.verdict === "sign")).toBe(true)
    const used = new Set(cases.flatMap((entry) => entry.reasons))
    expect(published.length).toBeGreaterThan(0)
    expect(published.filter((reason) => !used.has(reason))).toEqual([])
    expect([...used].filter((reason) => !published.includes(reason))).toEqual([])
  })

  it("covers the cases that separate this from a comparator that only checks amounts", () => {
    // Each of these is a place an implementation written from the text alone
    // would plausibly differ, so each has to be in the published table rather
    // than only in someone's head.
    const names = cases.map((entry) => entry.name)
    for (const required of [
      "a token payment whose lovelace the client raised to the ledger minimum",
      "an asset-carrying output raised past the ledger minimum",
      "the declared amount split into two outputs at the declared address",
      "change split across two addresses the wallet controls",
      "change returned to an address the intent declares",
      "a fee that absorbs a remainder too small to return as change",
      "the declared certificates, in an order that changes what they do",
      "a certificate acting on a stake credential the wallet does not control",
      "more than the declared amount, which is not the client's to give away",
      "a body member this version has no way to describe to a person"
    ]) {
      expect(names, `the table has no case for "${required}"`).toContain(required)
    }
  })

  it("never blocks a transaction that does exactly what was declared", () => {
    // The failure mode nobody reports: a gate so strict that the honest path
    // never opens. Every signing case here is an ordinary Slip.
    const signed = cases.filter((entry) => entry.verdict === "sign")
    expect(signed.length).toBeGreaterThanOrEqual(8)
    for (const entry of signed) expect(compare(entry)).toEqual([])
  })
})

describe("what the client derives", () => {
  const deriving = slice("Deriving the effects", 3)

  it("derives from the transaction and from nothing the endpoint said", () => {
    expect(deriving).toMatch(/MUST derive/)
    expect(deriving).toMatch(/before every signature\s+request/)
    expect(deriving).toMatch(/nothing an endpoint said takes part in the arithmetic/)
  })

  it("publishes the derived set as a table", () => {
    const rows = (tables(deriving)[0] ?? []).slice(1).map((row) => unquote(row[0] ?? ""))
    // REQUIREMENTS §4 names each of these. A derived set that quietly loses one
    // is an effect a person never sees.
    for (const derived of ["ada", "assets", "fee", "outputs", "certificates", "withdrawals", "mint"]) {
      expect(rows, `the derived set does not include ${derived}`).toContain(derived)
    }
    expect(rows.some((row) => row.includes("validUntil"))).toBe(true)
  })

  it("takes the protocol parameters and the resolved inputs as arguments, never as lookups", () => {
    // The whole purity claim. An engine that fetches while deriving can be made
    // slow, made to fail, or made to answer wrongly by whoever answers.
    expect(deriving).toMatch(/MUST NOT fetch any of them while deriving/)
    expect(deriving).toMatch(/protocol parameters in force/)
    expect(deriving).toMatch(/minimum-fee coefficients/)
    expect(deriving).toMatch(/slot to wall-clock time/)
    expect(deriving).toMatch(/the value of every input the body spends/i)
    expect(deriving).toMatch(/the addresses the wallet controls/)
  })

  it("resolves an unconfirmable address against the person's interest", () => {
    expect(deriving).toMatch(
      /MUST treat an\s+address it cannot confirm as the wallet's as though it belonged to someone else/
    )
  })

  it("shows the person the arithmetic rather than the publisher's words", () => {
    expect(deriving).toMatch(
      /MUST render the derived effects, and MUST NOT render the endpoint's\s+words in their place/
    )
    expect(deriving).toMatch(/deposit is not a cost/)
  })
})

describe("the comparison", () => {
  const comparison = slice("The comparison", 3)

  it("admits exactly two sets, and blocks anything outside them", () => {
    expect(comparison).toMatch(/There is no third set/)
    expect(comparison).toMatch(/whether or not this document has a name for it/)
  })

  it("states that there is no tolerance anywhere in it", () => {
    // The criterion #19 asks for, answered by naming the adjustments instead:
    // each has a stated cause and an exact computed value.
    expect(comparison).toMatch(/admits no tolerance anywhere/)
  })

  it("bounds the fee by something derivable rather than by a number someone chose", () => {
    const fees = slice("The fee and the client's own adjustments", 4)
    expect(fees).toMatch(/fee\.excessive/)
    expect(fees).toMatch(/minimum fee the protocol parameters require/)
    expect(fees).toMatch(/plus the minimum ADA an output to `changeAddress` would require/)
    expect(fees).toMatch(/too small to make a change output/)
  })

  it("keeps the raise to an output's minimum from widening what is accepted", () => {
    const outputs = slice("Matching the outputs", 4)
    expect(outputs).toMatch(/exactly one permitted lovelace amount/)
    expect(outputs).toMatch(/MUST pay an\s+address the wallet controls/)
    expect(outputs).toMatch(/MUST NOT return change to an address the intent declares/)
  })

  it("holds every certificate to the wallet's own credential", () => {
    const certificates = slice("Matching the certificates", 4)
    expect(certificates).toMatch(/MUST act on a stake credential the connected wallet\s+controls/)
    expect(certificates).toMatch(/in the same order/)
  })

  it("allows exactly one withdrawal, and only of the wallet's own rewards", () => {
    const rewards = slice("Matching the withdrawal", 4)
    expect(rewards).toMatch(/exactly\s+one withdrawal/)
    expect(rewards).toMatch(/MUST carry none/)
    expect(rewards).toMatch(/amount is not compared/)
  })

  it("blocks on anything this version cannot describe, including a mint", () => {
    const undeclarable = slice("Effects nothing can declare", 4)
    expect(undeclarable).toMatch(/mint\.undeclared/)
    expect(undeclarable).toMatch(/body\.unsupported/)
    // Without this the decoder decides the security model by accident.
    expect(undeclarable).toMatch(/MUST refuse to derive effects from a transaction it cannot read\s+completely/)
    expect(undeclarable).toMatch(/not a member it may skip/)
  })

  it("caps the interval by the intent's own deadline, in wall-clock time", () => {
    const interval = slice("The validity interval", 4)
    expect(interval).toMatch(/interval\.beyond-declared/)
    expect(interval).toMatch(/interval\.not-yet-valid/)
    expect(interval).toMatch(/slot-to-time mapping/)
  })
})

describe("blocking", () => {
  const blocking = slice("Blocking", 3)

  it("fails with a code of its own and asks for no signature", () => {
    expect(blocking).toMatch(/MUST fail with `EFFECTS_MISMATCH`/)
    expect(blocking).toMatch(/MUST NOT\s+ask the wallet for a signature/)
  })

  it("puts the code in the failure table as terminal, client-raised, and unsendable", () => {
    const rows = tables(slice("Failure responses", 3))[1] ?? []
    const row = rows.find((cells) => unquote(cells[0] ?? "") === "EFFECTS_MISMATCH")
    expect(row, "EFFECTS_MISMATCH is not in the code table").toBeDefined()
    expect(row?.[1]).toBe("terminal")
    expect(unquote(row?.[2] ?? "")).toBe("—")
    expect(row?.[3]).toBe("client")
  })

  it("closes the retry path a client would otherwise reach for", () => {
    // The rebuild exists for an expired interval. Pointed at a mismatch it
    // becomes a loop that ends in a signature.
    expect(blocking).toMatch(/MUST NOT be used in answer to a mismatch/)
    expect(blocking).toMatch(/Rebuilding until the gate passes is\s+the same thing as not having a gate/)
  })

  it("forbids an override in the specification rather than leaving it to implementations", () => {
    // Hard invariant 3 in CLAUDE.md, and the one an implementation under
    // commercial pressure is asked to soften first.
    expect(blocking).toMatch(/There is no override/)
    expect(blocking).toMatch(/No allowlist of publishers/)
    expect(blocking).toMatch(/no verified badge that\s+relaxes the rule/)
  })

  it("requires the person to be shown the difference, not the rule that fired", () => {
    expect(blocking).toMatch(/MUST show what was declared, what the transaction does/)
    expect(blocking).toMatch(/MUST NOT show the\s+endpoint's `message` as an alternative account/)
  })

  it("names every reason once", () => {
    expect(new Set(published).size).toBe(published.length)
    const malformed = published.filter((reason) => !/^[a-z]+\.[a-z-]+$/.test(reason))
    expect(malformed).toEqual([])
  })
})
