import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ADR-0008 renamed the protocol and left earlier records alone, since an ADR
 * says what was decided on the day. It carries a mapping from the old names
 * instead, and these tests keep that mapping complete.
 */

const root = join(import.meta.dirname, "..")
const decisions = join(root, "docs", "DECISIONS")

const read = (path: string): string => readFileSync(path, "utf8")
const records = readdirSync(decisions).filter((file) => file.endsWith(".md"))
const rename = read(join(decisions, "0008-rename-to-slips.md"))

/** Names the rename left behind, and where each one is still written down. */
const stale = ["//action", '"type": "action"', "@cardano-actions", "cardano-actions.json"]

describe("the rename record", () => {
  it("keeps earlier records unedited, and says so", () => {
    expect(rename).toMatch(/Earlier ADRs are not edited/)
  })

  it("reads every stale name it left behind", () => {
    // The table is the whole compensation for not editing the earlier records.
    const table = rename.slice(rename.indexOf("| Written in an earlier ADR |"))
    expect(table.length).toBeGreaterThan(0)
    const missing = stale.filter((name) => !table.includes(name))
    expect(missing).toEqual([])
  })

  it("says which document settles a name today", () => {
    expect(rename).toMatch(/the current\s+document is right and the ADR is not wrong — it is dated/)
    expect(rename).toContain("docs/REQUIREMENTS.md")
  })
})

describe("the documents that are not records", () => {
  /** Everything a reader treats as current: the docs, the spec, the root files. */
  const current = [
    join(root, "AGENTS.md"),
    join(root, "CLAUDE.md"),
    join(root, "README.md"),
    ...["REQUIREMENTS.md", "ARCHITECTURE.md", "WORKFLOW.md", "ECOSYSTEM.md", "GLOSSARY.md"].map((file) =>
      join(root, "docs", file)
    ),
    join(root, "spec", "CIP-XXXX", "README.md"),
    join(root, "spec", "examples", "README.md")
  ]

  it("carries no name the rename replaced", () => {
    const found = current
      .flatMap((path) => stale.map((name) => ({ path, name })))
      .filter(({ path, name }) => read(path).includes(name))
      .map(({ path, name }) => `${path.slice(root.length + 1)}: ${name}`)
    expect(found).toEqual([])
  })

  it("spells the publisher manifest the same way everywhere it is named", () => {
    // A filename drifting between them is the ADR-0006 defect happening again,
    // in the documents people actually read.
    const naming = current.filter((path) => /well-known\/[a-z0-9-]+\.json/.test(read(path)))
    expect(naming.length).toBeGreaterThan(1)
    const wrong = naming
      .flatMap((path) => [...read(path).matchAll(/well-known\/([a-z0-9-]+\.json)/g)].map((m) => ({ path, m })))
      .filter(({ m }) => !["cardano-slips.json", "cip30dl-attestation.json"].includes(m[1]))
      .map(({ path, m }) => `${path.slice(root.length + 1)}: ${m[1]}`)
    expect(wrong).toEqual([])
  })
})

describe("every decision record", () => {
  const index = read(join(decisions, "README.md"))
  const numbered = records.filter((file) => file !== "README.md" && file !== "0000-template.md")

  /** `**Status:** Superseded by [ADR-0008](…)` reduces to `Superseded`. */
  const statusOf = (file: string): string | undefined =>
    /\*\*Status:\*\* (Accepted|Proposed|Superseded|Rejected)/.exec(read(join(decisions, file)))?.[1]

  /** The index row for a record: `| [0014](file.md) | Title | Status |`. */
  const rowFor = (file: string): RegExpExecArray | null =>
    new RegExp(`^\\| \\[\\d{4}\\]\\(${file.replace(".", "\\.")}\\) \\| .+ \\| (.+) \\|$`, "m").exec(index)

  it("declares a status the index recognises", () => {
    const undeclared = numbered.filter((file) => statusOf(file) === undefined)
    expect(undeclared).toEqual([])
    expect(index).toContain("Superseded by ADR-0008")
  })

  it("is listed in the index", () => {
    // An unlisted record is one nobody finds, so the decision stops being settled.
    const missing = numbered.filter((file) => rowFor(file) === null)
    expect(missing).toEqual([])
  })

  it("is listed with the status it declares", () => {
    const drifted = numbered
      .map((file) => ({ file, declared: statusOf(file), listed: rowFor(file)?.[1] }))
      .filter(({ declared, listed }) => listed !== undefined && !listed!.startsWith(declared!))
      .map(({ file, declared, listed }) => `${file}: declares ${declared}, index says ${listed}`)
    expect(drifted).toEqual([])
  })
})
