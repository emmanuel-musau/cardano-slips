import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { describe, expect, it } from "vitest"

import { findColours } from "./colours.js"

/**
 * `tokens.css` is the only place a colour is written (`docs/ARCHITECTURE.md`).
 * A component carrying its own hex is how two surfaces end up a shade apart and
 * how the contrast audit in the design sheet stops meaning anything.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

/** The one file allowed to say a colour out loud. */
const tokenFile = "tokens.css"

const scanned = [".ts", ".tsx", ".css"]

function sourceFiles(directory: string = sourceRoot): Array<string> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && scanned.includes(extname(entry.name)) ? [path] : []
  })
}

describe("the detector", () => {
  // Proved on samples first: a rule that catches nothing passes over a source
  // tree just as quietly as a rule that has nothing to catch.
  it.each([
    ["a three-digit hex", 'const ink = "#eee"'],
    ["a six-digit hex", ".card { border: 1px solid #1a1a1a; }"],
    ["a hex with alpha", 'const veil = "#1a1a1a80"'],
    ["rgb()", 'const ink = "rgb(16 16 16)"'],
    ["rgba()", ".card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }"],
    ["hsl()", 'const ink = "hsl(210 8% 12%)"'],
    ["oklch()", 'const ink = "oklch(0.2 0.01 250)"'],
    ["color-mix()", ".card { background: color-mix(in oklab, var(--a), var(--b)); }"],
    ["a named colour in a style object", 'const style = { color: "white" }'],
    ["a named colour in CSS", ".card { color: black; }"],
    ["a named colour unquoted in JSX", "<div style={{ borderColor: red }} />"]
  ])("finds %s", (_case, source) => {
    expect(findColours("sample.tsx", source).length).toBeGreaterThan(0)
  })

  it("finds a colour a stylesheet writes without naming it in a way the patterns catch", () => {
    // The property carries the rule, so a spelling the lists miss is still caught.
    expect(findColours("sample.css", ".card { color: ButtonText; }")).toHaveLength(1)
  })

  it.each([
    ["a token reference", ".card { color: var(--slip-ink); }"],
    ["a token reference with a fallback", ".card { color: var(--slip-ink, var(--slip-ink-strong)); }"],
    ["a keyword that carries no colour", ".card { background: transparent; border-color: currentColor; }"],
    ["a shadow built from tokens", ".card { box-shadow: 0 1px 2px var(--slip-shadow); }"],
    ["an identifier that begins with a colour name", 'const whiteSpace = "nowrap"'],
    ["a property that is not a colour", ".card { padding: 8px; font-size: 14px; }"],
    ["a value read from somewhere else", "const style = { color: theme.ink }"]
  ])("passes %s", (_case, source) => {
    expect(findColours(source.startsWith(".") ? "sample.css" : "sample.tsx", source)).toEqual([])
  })
})

describe("what the package ships", () => {
  it("writes no colour outside the token file", () => {
    const findings = sourceFiles()
      .filter((path) => relative(sourceRoot, path) !== tokenFile)
      .flatMap((path) => findColours(relative(packageRoot, path), readFileSync(path, "utf8")))

    expect(findings).toEqual([])
  })
})
