import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  AA,
  contrast,
  over,
  parseAlpha,
  parseColour,
  parseScopes,
  resolve,
  type Rgb,
  tokensSource,
  withoutComments
} from "./tokens.js"

/**
 * `tokens.css` against the design sheet's `1 · Tokens`. The values are the
 * sheet's; what this file adds is that they stay the sheet's, that there is one
 * theme rather than a choice a component could make, and that the contrast
 * audit is recomputed here rather than copied off the sheet — the sheet's
 * printed ratios are stale against its own hexes, and these are the real ones.
 */

const packageRoot = join(import.meta.dirname, "..")
const css = tokensSource()
const scopes = parseScopes(css)
const rules = withoutComments(css)

const ROOT = ".slip-root"

const token = (property: string): string => resolve(scopes, ROOT, property) ?? ""

const declarations = (selector: string): ReadonlyMap<string, string> =>
  scopes.find((scope) => scope.selector === selector)?.declarations ?? new Map()

const colour = (value: string): Rgb => {
  const parsed = parseColour(value)
  if (parsed === undefined) throw new Error(`not a colour: ${value}`)
  return parsed
}

describe("the values", () => {
  it.each([
    ["--page", "#ebeef8"],
    ["--card", "#fcfdff"],
    ["--subtle", "rgba(90, 110, 205, 0.09)"],
    ["--skeleton", "rgba(90, 110, 205, 0.14)"],
    ["--border", "rgba(20, 26, 40, 0.13)"],
    ["--divider", "rgba(20, 26, 40, 0.1)"],
    ["--ink", "#141a26"],
    ["--muted", "#56628a"],
    ["--accent-fill", "#728ef3"],
    ["--accent-text", "#123cd3"],
    ["--accent-action", "#123cd3"],
    ["--accent-hover", "#0e2fa6"],
    ["--accent-deep", "#0c288d"],
    ["--accent-on-slate", "#8fa9ff"],
    ["--on-accent", "#ffffff"],
    ["--focus", "#123cd3"],
    ["--pos", "#065708"],
    ["--warn", "#7a5200"],
    ["--warn-fill", "#fece52"],
    ["--bad", "#d20a19"],
    ["--vault", "#222b3d"],
    ["--vault-ink", "#f5f7ff"],
    ["--vault-muted", "#c3cdec"],
    ["--vault-surface", "rgba(255, 255, 255, 0.09)"],
    ["--vault-border", "rgba(255, 255, 255, 0.16)"],
    ["--vault-pos", "#6fcb72"],
    ["--vault-warn", "#fece52"],
    ["--vault-bad", "#ff5a50"]
  ])("holds %s at the value the sheet settles", (property, value) => {
    expect(token(property)).toBe(value)
  })

  it.each([
    ["--radius-chip", "6px"],
    ["--radius-control", "8px"],
    ["--radius-card", "12px"]
  ])("holds %s", (property, value) => {
    expect(token(property)).toBe(value)
  })

  it("steps spacing on a 4px base and nowhere between", () => {
    const steps = [...declarations(ROOT).entries()].filter(([property]) => property.startsWith("--space-"))

    expect(steps.map(([, value]) => value)).toEqual(["4px", "8px", "12px", "16px", "20px", "24px", "32px", "48px"])
    // The name is the value, so no one has to remember whether --space-3 is 12px.
    for (const [property, value] of steps) expect(`--space-${Number.parseInt(value, 10)}`).toBe(property)
  })
})

describe("the type roles", () => {
  it("names one family and offers no second one to reach for", () => {
    // Display, text and mono were three names for what is now one face. A
    // component that can pick a family is a component that will pick a
    // different one from the next component.
    const families = [...declarations(ROOT).keys()].filter((property) => property.startsWith("--font"))

    expect(families).toEqual(["--font"])
  })

  it("ends the stack in a generic family, so a missing webfont degrades rather than disappears", () => {
    const stack = token("--font")
      .split(",")
      .map((name) => name.trim())

    expect(["sans-serif", "serif", "monospace", "system-ui"]).toContain(stack.at(-1))
    expect(stack.length).toBeGreaterThan(1)
  })

  it.each([
    ["--type-h1", "700 44px/48px var(--font)"],
    ["--type-card-title", "700 18px/24px var(--font)"],
    ["--type-numeral", "700 26px/32px var(--font)"],
    ["--type-body", "400 16px/24px var(--font)"],
    ["--type-button", "500 14px/20px var(--font)"],
    ["--type-label", "500 13px var(--font)"],
    ["--type-technical", "400 12px/20px var(--font)"]
  ])("carries %s as one whole role", (property, value) => {
    // A component that can apply the size without the family is a component
    // that will, and the sheet's type is a pairing rather than a size.
    expect(declarations(ROOT).get(property)).toBe(value)
  })
})

describe("the one theme", () => {
  it("offers no theme to choose: there is a single scope and no data-theme anywhere", () => {
    // The sheet collapsed light and dark into one ground. A component that can
    // ask which theme it is in is a component that will answer differently
    // from the next one.
    expect(scopes.map((scope) => scope.selector)).toEqual([ROOT])
    expect(rules).not.toMatch(/data-theme/)
  })

  it("declares the colour scheme, so a native control follows the ground", () => {
    expect(declarations(ROOT).get("color-scheme")).toBe("light")
  })

  it("keeps the fixed dark palette a separate family rather than a second theme", () => {
    // Code blocks and the Open Graph card land on a ground we do not control,
    // so they carry their own and follow nothing.
    expect(token("--dark-bg")).toBe("#121721")
    expect(token("--dark-surface")).toBe("rgba(255, 255, 255, 0.08)")
    expect(token("--dark-text")).toBe("#ffffff")
    expect(token("--dark-muted")).toBe("#ccd6ff")
  })

  it("leaves nothing to a component's judgement: every colour role resolves to a colour", () => {
    const colours = [...declarations(ROOT).entries()]
      .filter(([, value]) => parseColour(value) !== undefined)
      .map(([property]) => property)

    expect(colours.length).toBeGreaterThan(30)
    for (const property of colours) expect(parseColour(token(property))).toBeDefined()
  })
})

describe("the contrast audit", () => {
  const audit: ReadonlyArray<readonly [string, string, string, number]> = [
    ["ink on the page", token("--ink"), token("--page"), 15.03],
    ["ink on a card", token("--ink"), token("--card"), 17.12],
    ["muted on the page", token("--muted"), token("--page"), 5.16],
    ["muted on a card", token("--muted"), token("--card"), 5.88],
    ["accent text on a card", token("--accent-text"), token("--card"), 7.9],
    ["accent text on the page", token("--accent-text"), token("--page"), 6.93],
    ["accent deep on a card", token("--accent-deep"), token("--card"), 12.11],
    // The button is outlined now, so its label is measured against the card it
    // sits on rather than against a fill it no longer has.
    ["a button's label and outline on a card", token("--accent-action"), token("--card"), 7.9],
    ["a button under the pointer", token("--accent-hover"), token("--card"), 10.44],
    ["white on a filled accent", token("--on-accent"), token("--accent-action"), 8.04],
    ["positive on a card", token("--pos"), token("--card"), 8.69],
    ["warning on a card", token("--warn"), token("--card"), 6.8],
    ["blocked on a card", token("--bad"), token("--card"), 5.43],

    ["vault ink on the vault", token("--vault-ink"), token("--vault"), 13.26],
    ["vault muted on the vault", token("--vault-muted"), token("--vault"), 8.96],
    ["the accent on slate", token("--accent-on-slate"), token("--vault"), 6.27],
    ["vault positive on the vault", token("--vault-pos"), token("--vault"), 7.06],
    ["vault warning on the vault", token("--vault-warn"), token("--vault"), 9.56],
    ["vault blocked on the vault", token("--vault-bad"), token("--vault"), 4.61],

    ["docs text on the dark palette", token("--dark-text"), token("--dark-bg"), 17.95],
    ["docs muted on the dark palette", token("--dark-muted"), token("--dark-bg"), 12.5]
  ]

  it.each(audit)("clears AA for %s", (_pairing, foreground, background, expected) => {
    const ratio = contrast(colour(foreground), colour(background))
    expect(ratio).toBeGreaterThanOrEqual(AA)
    expect(ratio).toBeCloseTo(expected, 1)
  })

  it("keeps the split rule load-bearing: the accent fill does not clear AA on a card", () => {
    // If this ever passes, the reason --accent-text exists has gone away
    // silently, and a component is free to set 14px type in --accent-fill.
    expect(contrast(colour(token("--accent-fill")), colour(token("--card")))).toBeLessThan(AA)
  })

  it("holds the accent fill to fills on the vault, where the ratio alone would not", () => {
    // 4.6:1 on slate, and the sheet still calls it a fill, because the rule is
    // about what the colour is for. Recorded so that nobody reads the ratio off
    // a checker and promotes it to text.
    expect(contrast(colour(token("--accent-fill")), colour(token("--vault")))).toBeGreaterThanOrEqual(AA)
  })

  it("keeps the blocked colour on slate above AA, which is where it left the sheet", () => {
    // The sheet draws #ff5247 and prints 4.43 in a row it labels a pass. This
    // colour carries the mismatch block, so the file lightens it instead. If
    // anyone syncs the sheet's value back, this is the test that says why not.
    expect(token("--vault-bad")).not.toBe("#ff5247")
    expect(contrast(colour("#ff5247"), colour(token("--vault")))).toBeLessThan(AA)
    expect(contrast(colour(token("--vault-bad")), colour(token("--vault")))).toBeGreaterThanOrEqual(AA)
  })

  it("measures a raised surface on the ground it sits on", () => {
    const raised = over(
      colour(token("--vault-surface")),
      parseAlpha(token("--vault-surface")),
      colour(token("--vault"))
    )
    expect(contrast(colour(token("--vault-ink")), raised)).toBeGreaterThanOrEqual(AA)
    expect(contrast(colour(token("--vault-muted")), raised)).toBeGreaterThanOrEqual(AA)
  })
})

describe("the stylesheet itself", () => {
  it("declares nothing but custom properties and the colour scheme", () => {
    // A package that ships a rule affecting an element it did not draw is a
    // package that changes a page it was only invited into. `color-scheme` is
    // the one ordinary property, and it is what makes a native control follow.
    const ordinary = scopes.flatMap((scope) =>
      [...scope.declarations.keys()].filter((property) => !property.startsWith("--") && property !== "color-scheme")
    )
    expect(ordinary).toEqual([])
  })

  it("scopes its one rule to a class of ours, never to the document", () => {
    expect(scopes.map((scope) => scope.selector)).toEqual([ROOT])
  })

  it("carries no reset and selects no element", () => {
    expect(rules).not.toMatch(/(^|[\s,{])(\*|html|body|:root|a|p|div|button|input)\s*[,{]/m)
  })
})

describe("what a consumer imports", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>
    scripts?: Record<string, string>
  }

  it("resolves the same file for the hosted page and for a third party", () => {
    // Both reach it through the exports map, so neither can end up on a
    // private copy that drifted.
    expect(manifest.exports?.["./tokens.css"]).toBe("./dist/tokens.css")
  })

  it("is put there by the build", () => {
    // The build copies the stylesheets wholesale, so what puts this one in
    // `dist` is that it is one of them.
    expect(manifest.scripts?.build).toMatch(/cp\s+src\/\*\.css\s+dist\//)
  })
})
