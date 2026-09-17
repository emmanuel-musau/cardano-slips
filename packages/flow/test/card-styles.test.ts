import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { describe, expect, it } from "vitest"

import { parseScopes, tokensSource, withoutComments } from "./tokens.js"

/**
 * What `card.css` may do. A stylesheet referencing a token nobody declared
 * fails silently — the property is simply unset — so the reference is checked
 * rather than trusted, and every rule has to stay anchored to a class of ours.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

const cardCss = readFileSync(join(sourceRoot, "card.css"), "utf8")

const declared = new Set(
  parseScopes(tokensSource()).flatMap((scope) => [...scope.declarations.keys()].filter((name) => name.startsWith("--")))
)

function sourceFiles(directory: string = sourceRoot): Array<string> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && [".ts", ".tsx", ".css"].includes(extname(entry.name)) ? [path] : []
  })
}

/** Every `var(--x)` reference, wherever it is written. */
const referencesIn = (source: string): ReadonlyArray<string> =>
  [...source.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)].map(([, name]) => name)

/** One selector per rule, comma-split, at-rules and keyframe steps included as written. */
const selectorsIn = (css: string): ReadonlyArray<string> =>
  [...withoutComments(css).matchAll(/([^{}]*)\{/g)]
    .flatMap(([, group]) => (group ?? "").split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "")

describe("the tokens a stylesheet reaches for", () => {
  it("are all declared in tokens.css", () => {
    const unknown = sourceFiles()
      .filter((path) => relative(sourceRoot, path) !== "tokens.css")
      .flatMap((path) =>
        referencesIn(readFileSync(path, "utf8"))
          .filter((name) => !declared.has(name))
          .map((name) => `${relative(packageRoot, path)}: ${name}`)
      )

    expect(unknown).toEqual([])
  })

  it("are enough of them that the check is doing something", () => {
    expect(new Set(referencesIn(cardCss)).size).toBeGreaterThan(20)
  })

  it("would be caught if one were not", () => {
    // Proved on a sample: a check that catches nothing passes over a clean
    // source tree just as quietly as one that has nothing to catch.
    expect(referencesIn(".x { color: var(--not-a-token) }").filter((name) => !declared.has(name))).toEqual([
      "--not-a-token"
    ])
  })
})

describe("what card.css is allowed to select", () => {
  it("anchors every rule to a class of ours, so nothing reaches an element the card did not draw", () => {
    const loose = selectorsIn(cardCss).filter(
      (selector) => !(selector.startsWith(".slip-") || selector.startsWith("@") || /^(?:\d+%|from|to)$/.test(selector))
    )

    expect(loose).toEqual([])
  })

  it("would be caught if one were not", () => {
    expect(selectorsIn("body { margin: 0 } .slip-card { gap: 0 }").filter((s) => !s.startsWith(".slip-"))).toEqual([
      "body"
    ])
  })

  it("writes no colour of its own", () => {
    // Proved again from this side: `tokens.css` is the only file that may.
    expect(withoutComments(cardCss).replace(/var\([^()]*\)/g, "")).not.toMatch(/#[0-9a-fA-F]{3}|rgba?\(|hsla?\(/)
  })

  it("holds the motion rule the sheet states, so a pulse is not forced on anyone", () => {
    expect(cardCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})
