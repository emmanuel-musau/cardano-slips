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
    ["--accent-text", "#2f4bc4"],
    ["--accent-action", "#4361e8"],
    ["--accent-hover", "#2f4bc4"],
    ["--accent-deep", "#0c288d"],
    ["--on-accent", "#ffffff"],
    ["--focus", "#4361e8"],
    ["--pos", "#1f7a5c"],
    ["--warn", "#8c5a12"],
    ["--bad", "#b3261e"],
    ["--vault", "#222b3d"],
    ["--vault-ink", "#f5f7ff"],
    ["--vault-muted", "#c3cdec"],
    ["--vault-surface", "rgba(255, 255, 255, 0.09)"],
    ["--vault-border", "rgba(255, 255, 255, 0.16)"],
    ["--vault-pos", "#5fd1a6"],
    ["--vault-warn", "#e9b44c"],
    ["--vault-bad", "#ffa39b"]
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
  it.each(["--font-display", "--font-text", "--font-mono"])(
    "%s ends in a generic family, so a missing webfont degrades rather than disappears",
    (property) => {
      const stack = token(property)
        .split(",")
        .map((name) => name.trim())
      expect(["sans-serif", "serif", "monospace", "system-ui", "ui-monospace"]).toContain(stack.at(-1))
      expect(stack.length).toBeGreaterThan(1)
    }
  )

  it.each([
    ["--type-h1", "700 44px/48px var(--font-display)"],
    ["--type-card-title", "700 18px/24px var(--font-display)"],
    ["--type-numeral", "700 26px/32px var(--font-display)"],
    ["--type-body", "500 16px/24px var(--font-text)"],
    ["--type-button", "500 14px/20px var(--font-text)"],
    ["--type-label", "500 13px var(--font-text)"]
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
    ["accent text on a card", token("--accent-text"), token("--card"), 7.06],
    ["accent text on the page", token("--accent-text"), token("--page"), 6.2],
    ["accent deep on a card", token("--accent-deep"), token("--card"), 12.11],
    ["button text on the action colour", token("--on-accent"), token("--accent-action"), 5.1],
    ["positive on a card", token("--pos"), token("--card"), 5.16],
    ["warning on a card", token("--warn"), token("--card"), 5.75],
    ["blocked on a card", token("--bad"), token("--card"), 6.42],

    ["vault ink on the vault", token("--vault-ink"), token("--vault"), 13.26],
    ["vault muted on the vault", token("--vault-muted"), token("--vault"), 8.96],
    ["vault positive on the vault", token("--vault-pos"), token("--vault"), 7.53],
    ["vault warning on the vault", token("--vault-warn"), token("--vault"), 7.49],
    ["vault blocked on the vault", token("--vault-bad"), token("--vault"), 7.4],

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
    expect(manifest.scripts?.build).toContain("tokens.css")
  })
})
