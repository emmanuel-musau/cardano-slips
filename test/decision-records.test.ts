import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ADR-0008 renamed the protocol and left earlier records alone: an ADR says what
 * was decided on the day it was decided. The cost is that a reader meets the old
 * names with nothing to tell them they moved, so ADR-0008 carries a mapping and
 * these tests keep it complete.
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
  it("declares a status the index recognises", () => {
    const index = read(join(decisions, "README.md"))
    const statuses = ["Accepted", "Proposed", "Superseded", "Rejected"]
    const undeclared = records
      .filter((file) => file !== "README.md" && file !== "0000-template.md")
      .filter((file) => !statuses.some((status) => read(join(decisions, file)).includes(`**Status:** ${status}`)))
    expect(undeclared).toEqual([])
    expect(index).toContain("Superseded by ADR-0008")
  })
})
