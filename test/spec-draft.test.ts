import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The assembled draft, and the shapes version 1 settles on.
 *
 * Everything before this wrote one section at a time. This asserts the
 * properties that only exist once the whole document does: that no section was
 * left as a stub, that the shapes it says it defines are exactly the shapes it
 * has schemas for, that the URI grammar matches the one CIP-158 shipped, and
 * that nothing in Path to Active waits on a wallet.
 *
 * The last of those is the criterion this project is most likely to break by
 * being ambitious. CIP-13 has been Proposed since 2020 because its acceptance
 * rested on adoption its authors could not perform; a criterion added here in
 * good faith — "two wallets handle `web+cardano://slip`" — would buy the same
 * six years. The test is cheap and the failure mode is not recoverable.
 */

const root = join(import.meta.dirname, "..")
const cip = join(root, "spec", "CIP-XXXX")
const source = readFileSync(join(cip, "README.md"), "utf8")
const schemaDir = join(cip, "schemas")

/** The text under a heading, up to the next heading at the same level or higher, subsections included. */
const slice = (heading: string, level: number): string => {
  const marker = `${"#".repeat(level)} ${heading}\n`
  const start = source.indexOf(marker)
  expect(start, `no "${marker.trim()}" section in the CIP`).toBeGreaterThan(-1)
  const rest = source.slice(start + marker.length)
  const end = rest.search(new RegExp(`^#{1,${level}} `, "m"))
  return end === -1 ? rest : rest.slice(0, end)
}

/** Rows of a markdown table, as trimmed cells, excluding the header and the rule. */
const rows = (text: string, header: string): Array<Array<string>> => {
  const start = text.indexOf(`| ${header} `)
  expect(start, `no table headed "${header}"`).toBeGreaterThan(-1)
  const found: Array<Array<string>> = []
  for (const line of text.slice(start).split("\n").slice(2)) {
    if (!line.startsWith("|")) break
    found.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
  }
  return found
}

/** Every list item of a bulleted or checkbox list in a chunk of text, joined across wrapped lines. */
const items = (text: string): Array<string> => {
  const found: Array<string> = []
  for (const line of text.split("\n")) {
    if (/^- /.test(line)) found.push(line.slice(2))
    else if (/^ {2,}\S/.test(line) && found.length > 0) found[found.length - 1] += ` ${line.trim()}`
    else if (line.trim() === "") continue
    else if (found.length > 0 && !line.startsWith("|")) break
  }
  return found
}

/** Every `enum` and `const` value in every schema, flattened. */
const enumerations = (): Array<Array<string>> => {
  const found: Array<Array<string>> = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node !== "object" || node === null) return
    for (const [key, value] of Object.entries(node)) {
      if (key === "enum" && Array.isArray(value)) found.push(value.map(String))
      walk(value)
    }
  }
  for (const file of readdirSync(schemaDir)) walk(JSON.parse(readFileSync(join(schemaDir, file), "utf8")))
  return found
}

const headings = [...source.matchAll(/^(#{2,4}) (.+)$/gm)].map((match) => ({
  level: match[1].length,
  text: match[2].trim()
}))

describe("the assembled draft", () => {
  it("leaves no section as a stub", () => {
    // The draft was written across seven issues, each leaving the next one's
    // heading in place with a note under it. A heading with nothing under it
    // reaches a reviewer as a section its author forgot.
    const thin = headings
      .map(({ level, text }) => ({ text, length: slice(text, level).trim().length }))
      .filter(({ length }) => length < 200)
    expect(thin).toEqual([])
  })

  it("carries no note to ourselves", () => {
    // Every stub carried an HTML comment naming the issue that would fill it.
    // They are invisible in a rendered file and perfectly visible in the diff a
    // CIP editor reads.
    expect(source).not.toContain("<!--")
    expect(source).not.toMatch(/#\d\d\b/)
  })

  it("titles itself by what it does, not by what we call it", () => {
    // ADR-0008, following CIP-45: the library carries the brand and the CIP
    // title describes the mechanism. The product name belongs in the Abstract.
    const title = /^Title: (.+)$/m.exec(source)?.[1] ?? ""
    expect(title.length).toBeGreaterThan(0)
    expect(title).not.toMatch(/slip/i)
    expect(slice("Abstract", 2)).toContain("Cardano Slips")
  })
})

describe("the shapes version 1 defines", () => {
  const table = rows(slice("Protocol versioning", 3), "Shape")
  const declared = table.map((row) => /\.\/schemas\/([\w.-]+\.json)/.exec(row[2])?.[1] ?? row[2])

  it("defines one shape for every schema, and schemas nothing it has not defined", () => {
    expect([...declared].sort()).toEqual(readdirSync(schemaDir).sort())
  })

  it("sends a reader from each shape to the section that specifies it", () => {
    const present = new Set(headings.map(({ text }) => text.replaceAll("`", "")))
    const dangling = table
      .map((row) => /\[([^\]]+)\]\(#/.exec(row[1])?.[1] ?? row[1])
      .filter((section) => !present.has(section))
    expect(dangling).toEqual([])
  })

  it("closes its vocabularies as enumerations rather than as sentences", () => {
    // The section names six vocabularies. Four are enumerated in the schemas,
    // and a vocabulary that is closed in the text and open in the schema is
    // closed nowhere — the schemas are normative where the two disagree.
    const enumerated = enumerations().map((values) => values.join(","))
    const closed = {
      networks: ["mainnet", "preprod", "preview"],
      "parameter types": ["text", "number", "select"],
      "certificate types": ["stakeRegistration", "stakeDeregistration", "stakeDelegation", "voteDelegation"],
      "build modes": ["local", "server"]
    }
    const open = Object.entries(closed)
      .filter(([, values]) => !enumerated.includes(values.join(",")))
      .map(([name]) => name)
    expect(open).toEqual([])

    // The other two are enumerated in the CIP's own tables, and each has its
    // own test: the failure codes in spec-error-codes, the block reasons in
    // spec-effects. Here we only assert the section names all six.
    const versioning = slice("Protocol versioning", 3)
    for (const name of [...Object.keys(closed), "failure codes", "reasons a client reports a block"]) {
      expect(versioning).toContain(name)
    }
  })

  it("prices a change to any of them at a major version", () => {
    const versioning = slice("Protocol versioning", 3)
    expect(versioning).toMatch(/These are the shapes version 1 defines, and there are no others/)
    expect(versioning).toMatch(/is version 2/)
  })
})

describe("the //slip authority", () => {
  const authority = slice("The `//slip` URI authority", 3)
  const grammar = [...authority.matchAll(/^web\+cardano:\/\/.+$/gm)].map((match) => match[0])

  it("publishes a grammar and an example of it", () => {
    expect(grammar.length).toBe(2)
  })

  it("puts a fixed token after the slashes, never a variable", () => {
    // RFC 3986 reads what follows // as the authority. One wallet shipped
    // `web+cardano:<address>` and another `web+cardano://<address>`, and
    // payment links did not work across both for a year.
    for (const line of grammar) {
      expect(line).toMatch(/^web\+cardano:\/\/slip\//)
      expect(/^web\+cardano:\/\/([^/?#]+)/.exec(line)?.[1]).toBe("slip")
    }
  })

  it("carries the major version in the path, and the same one the shapes declare", () => {
    for (const line of grammar) expect(line).toMatch(/^web\+cardano:\/\/slip\/v1\?/)
    expect(source).toContain('"version": "1"')
  })

  it("follows the grammar CIP-158 shipped, and says whose it is", () => {
    // Fixed token, /v1 segment, percent-encoded query payload. Citing the
    // Active CIP that already does this makes the registration a conformance
    // argument rather than a proposal.
    expect(authority).toContain("[CIP-158]")
    for (const line of grammar) expect(line).toMatch(/^web\+cardano:\/\/slip\/v1\?uri=/)
  })

  it("percent-encodes the link it carries, so it survives as one query value", () => {
    const example = grammar.find((line) => !line.includes("<"))
    expect(example).toBeDefined()
    const value = /\?uri=(.+)$/.exec(example ?? "")?.[1] ?? ""
    expect(value).not.toMatch(/[/:?#&]/)
    expect(decodeURIComponent(value)).toMatch(/^https:\/\//)
  })

  it("defines one query parameter and refuses any other", () => {
    expect(authority).toMatch(/`uri` is REQUIRED, and this version defines no other query parameter/)
  })

  it("confers nothing on the link it carries", () => {
    // The URI is the one part of this protocol an attacker writes in full,
    // onto a poster. A handler that treated it as pre-approved would have
    // inverted the whole thing.
    expect(authority).toMatch(/comparison still blocks the signature/)
    expect(authority).toMatch(/MUST render the\s+resolved origin/)
  })

  it("states that nothing in the document depends on it", () => {
    expect(authority).toMatch(/No requirement in\s+this document depends on the authority/)
  })
})

describe("Path to Active", () => {
  const criteria = items(slice("Acceptance Criteria", 3))
  const plan = items(slice("Implementation Plan", 3))

  it("states criteria a reviewer can check off", () => {
    expect(criteria.length).toBeGreaterThanOrEqual(5)
    expect(criteria.filter((criterion) => !criterion.startsWith("[ ] "))).toEqual([])
  })

  it("asks no wallet to implement a URI authority", () => {
    // The hard constraint on this section. A criterion resting on wallet
    // adoption of `//slip` is the one that cannot be met by anyone who has a
    // reason to meet it, and it is what has held CIP-13 for six years.
    const onTheAuthority = criteria.filter((criterion) => criterion.includes("//slip"))
    expect(onTheAuthority.length).toBe(1)
    expect(onTheAuthority[0]).toContain("not an implementation")
    expect(slice("Acceptance Criteria", 3)).toMatch(
      /No criterion above asks a wallet to implement a URI authority, and none may\s+be added that does/
    )
  })

  it("asks wallets only for the interface they already expose", () => {
    const onWallets = criteria.filter((criterion) => /wallet/i.test(criterion))
    expect(onWallets.length).toBeGreaterThan(0)
    for (const criterion of onWallets) expect(criterion).toMatch(/CIP-30|requiring no change/)
  })

  it("keeps the one ingredient we cannot supply out of the criteria", () => {
    // A wallet co-author is what CIP-99 had and every stalled URI proposal
    // lacked, and no amount of our own work guarantees one. It belongs in the
    // plan, where it is an intention, not in the criteria, where it is a gate.
    expect(plan.join(" ")).toContain("co-author")
    expect(criteria.join(" ")).not.toContain("co-author")
  })

  it("plans to submit against an implementation that already runs", () => {
    expect(plan.length).toBeGreaterThanOrEqual(4)
    expect(plan.join(" ")).toMatch(/submitted after the implementation runs on mainnet/)
  })
})

describe("future work", () => {
  const future = slice("Future work", 3)

  it("sits under Rationale rather than becoming a section of its own", () => {
    // CIP-0001 fixes the H2 set, and Open Questions is a CPS section. An
    // unresolved question in a CIP belongs under Rationale.
    expect(source).not.toMatch(/^## (Future work|Open Questions)$/m)
    const rationale = slice("Rationale: How does this CIP achieve its goals?", 2)
    expect(rationale).toContain("### Future work")
  })

  it("accounts for everything the specification reserves without defining", () => {
    // Each of these is named in the Specification as deliberately absent. A
    // reader's fair question is whether it was missed or refused, and this is
    // the one place that answers it.
    for (const reserved of [
      'build: "server"',
      "Publisher identity",
      "required signers",
      "Mint and burn",
      "decimals",
      "CIP-186"
    ]) {
      expect(future).toContain(reserved)
    }
  })
})
