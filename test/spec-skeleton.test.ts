import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { describe, expect, it } from "vitest"

/**
 * Structural invariants for the CIP draft. Everything here is something that
 * gets a submission bounced against CIP-0001 before a word of it is read.
 */

const root = join(import.meta.dirname, "..")
const source = readFileSync(join(root, "spec", "CIP-XXXX", "README.md"), "utf8")

/** CIP-0001 preamble fields that every CIP must carry. */
const requiredFields = [
  "CIP",
  "Title",
  "Category",
  "Status",
  "Authors",
  "Implementors",
  "Discussions",
  "Created",
  "License"
] as const

/** The categories CIP-0001 defines. Anything else is rejected at review. */
const categories = ["Meta", "Wallets", "Tokens", "Metadata", "Tools", "Plutus", "Ledger", "Consensus", "Network"]

/** Mandatory H2s, in the order CIP-0001 fixes them. */
const requiredHeadings = [
  "Abstract",
  "Motivation: Why is this CIP necessary?",
  "Specification",
  "Rationale: How does this CIP achieve its goals?",
  "Path to Active",
  "Copyright"
]

/** Permitted only between 'Path to Active' and 'Copyright'. 'Open Questions' is CPS-only. */
const optionalHeadings = ["Versioning", "References", "Appendices", "Acknowledgements"]

type Preamble = {
  Title?: string
  Category?: string
  Status?: string
  Authors?: string[]
  Implementors?: unknown[]
  License?: string
  "Solution To"?: unknown[]
}

function readPreamble(): Preamble {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
  if (match === null) throw new Error("no YAML preamble delimited by --- at the top of the file")
  return parse(match[1]) as Preamble
}

const headings = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim())
const subHeadings = [...source.matchAll(/^### (.+)$/gm)].map((match) => match[1].trim())

describe("the CIP preamble", () => {
  const preamble = readPreamble()

  it("carries every field CIP-0001 requires", () => {
    const missing = requiredFields.filter((field) => !(field in preamble))
    expect(missing).toEqual([])
  })

  it("declares a category and status the editors recognise", () => {
    expect(categories).toContain(preamble.Category)
    // Drafts are Proposed. Active is earned via Path to Active, never claimed.
    expect(preamble.Status).toBe("Proposed")
  })

  it("licenses the text under terms the CIP repository accepts", () => {
    // The repository is MIT, but CIP text may only be CC-BY-4.0 or Apache-2.0.
    expect(["CC-BY-4.0", "Apache-2.0"]).toContain(preamble.License)
  })

  it("states the same licence in the preamble and the Copyright section", () => {
    expect(source).toContain(`This CIP is licensed under [${preamble.License}]`)
  })

  it("names an author with a contact address", () => {
    expect(preamble.Authors?.length ?? 0).toBeGreaterThan(0)
    const withoutEmail = (preamble.Authors ?? []).filter((author) => !/<[^>]+@[^>]+>/.test(author))
    expect(withoutEmail).toEqual([])
  })

  it("declares itself a solution to CPS-0016", () => {
    // ADR-0007: the CIP answers CPS-16's third open question, and says so in
    // the preamble the way CIP-99 does rather than only in the text.
    const solutionTo = JSON.stringify(preamble["Solution To"] ?? [])
    expect(solutionTo).toContain("CPS-0016")
  })

  it("has no implementors until one exists", () => {
    // An implementor listed before they have implemented is the fastest way to
    // lose an editor's trust. This flips when a wallet or dApp actually ships.
    expect(preamble.Implementors).toEqual([])
  })
})

describe("the CIP structure", () => {
  it("carries every mandatory section, in the order CIP-0001 fixes", () => {
    expect(headings.filter((heading) => requiredHeadings.includes(heading))).toEqual(requiredHeadings)
  })

  it("invents no top-level section of its own", () => {
    const unknown = headings.filter(
      (heading) => !requiredHeadings.includes(heading) && !optionalHeadings.includes(heading)
    )
    expect(unknown).toEqual([])
  })

  it("places any optional section between Path to Active and Copyright", () => {
    const pathToActive = headings.indexOf("Path to Active")
    const copyright = headings.indexOf("Copyright")
    const misplaced = headings
      .map((heading, index) => ({ heading, index }))
      .filter(({ heading }) => optionalHeadings.includes(heading))
      .filter(({ index }) => index < pathToActive || index > copyright)
      .map(({ heading }) => heading)
    expect(misplaced).toEqual([])
  })

  it("breaks Path to Active into its two required subsections", () => {
    expect(subHeadings).toContain("Acceptance Criteria")
    expect(subHeadings).toContain("Implementation Plan")
  })
})

describe("the CIP draft", () => {
  it("carries no template boilerplate", () => {
    // `CIP: "?"` and the `pull/?` link are excluded: the editors resolve both when the PR is filed (#71).
    const leftovers = ["John Doe", "john.doe@email.domain", "YYYY-MM-DD"].filter((placeholder) =>
      source.includes(placeholder)
    )
    expect(leftovers).toEqual([])
  })

  it("drafts the sections this issue owns", () => {
    // #14 delivers Abstract and Motivation as written sections. The rest are stubs until
    // #15–#21, so this asserts content only for the two that are due.
    const drafted = (heading: string): string => {
      const start = source.indexOf(`## ${heading}`)
      const rest = source.slice(start + heading.length + 3)
      const end = rest.indexOf("\n## ")
      return (end === -1 ? rest : rest.slice(0, end)).replace(/<!--[\s\S]*?-->/g, "").trim()
    }
    expect(drafted("Abstract").length).toBeGreaterThan(200)
    expect(drafted("Motivation: Why is this CIP necessary?").length).toBeGreaterThan(200)
  })
})
