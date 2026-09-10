import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { AA, contrast, over, parseAlpha, parseColour, parseScopes, resolve, type Rgb, tokensSource } from "./tokens.js"

/**
 * `tokens.css` against the design sheet's `1 · Tokens`. The values are the
 * sheet's; what this file adds is that they stay the sheet's, that the theme is
 * decided once rather than per component, and that the contrast audit is
 * recomputed here rather than trusted.
 */

const packageRoot = join(import.meta.dirname, "..")
const css = tokensSource()
const scopes = parseScopes(css)

const LIGHT = ".slip-root"
const DARK = '.slip-root[data-theme="dark"]'

const light = (property: string): string => resolve(scopes, LIGHT, property) ?? ""
const dark = (property: string): string => resolve(scopes, DARK, property) ?? ""

const declarations = (selector: string): ReadonlyMap<string, string> =>
  scopes.find((scope) => scope.selector === selector)?.declarations ?? new Map()

const colour = (value: string): Rgb => {
  const parsed = parseColour(value)
  if (parsed === undefined) throw new Error(`not a colour: ${value}`)
  return parsed
}

describe("the values", () => {
  it.each([
    ["--page", "#f6f8fe", "#121721"],
    ["--card", "#ffffff", "#1b2231"],
    ["--subtle", "rgba(114, 142, 243, 0.08)", "rgba(114, 142, 243, 0.16)"],
    ["--skeleton", "rgba(114, 142, 243, 0.14)", "rgba(114, 142, 243, 0.18)"],
    ["--border", "rgba(18, 23, 33, 0.12)", "rgba(255, 255, 255, 0.14)"],
    ["--divider", "rgba(18, 23, 33, 0.1)", "rgba(255, 255, 255, 0.1)"],
    ["--ink", "#121721", "#ffffff"],
    ["--muted", "#5c6a9c", "#ccd6ff"],
    ["--accent-fill", "#728ef3", "#728ef3"],
    ["--accent-text", "#2f4bc4", "#a8bcff"],
    ["--accent-action", "#4361e8", "#4361e8"],
    ["--accent-hover", "#2f4bc4", "#5c79ee"],
    ["--accent-deep", "#0c288d", "#a8bcff"],
    ["--focus", "#4361e8", "#a8bcff"],
    ["--pos", "#1f7a5c", "#5fd1a6"],
    ["--warn", "#8c5a12", "#e9b44c"],
    ["--bad", "#b3261e", "#ffa39b"],
    ["--vault", "#ffffff", "#080b12"],
    ["--vault-ink", "#121721", "#ffffff"],
    ["--vault-muted", "#5c6a9c", "#ccd6ff"],
    ["--vault-surface", "rgba(114, 142, 243, 0.08)", "rgba(255, 255, 255, 0.08)"],
    ["--vault-border", "rgba(18, 23, 33, 0.12)", "rgba(255, 255, 255, 0.14)"]
  ])("holds %s at the value the sheet settles, in both themes", (property, inLight, inDark) => {
    expect(light(property)).toBe(inLight)
    expect(dark(property)).toBe(inDark)
  })

  it.each([
    ["--radius-chip", "6px"],
    ["--radius-control", "8px"],
    ["--radius-card", "12px"]
  ])("holds %s", (property, value) => {
    expect(light(property)).toBe(value)
  })

  it("steps spacing on a 4px base and nowhere between", () => {
    const steps = [...declarations(LIGHT).entries()].filter(([property]) => property.startsWith("--space-"))

    expect(steps.map(([, value]) => value)).toEqual(["4px", "8px", "12px", "16px", "20px", "24px", "32px", "48px"])
    // The name is the value, so no one has to remember whether --space-3 is 12px.
    for (const [property, value] of steps) expect(`--space-${Number.parseInt(value, 10)}`).toBe(property)
  })
})

describe("the type roles", () => {
  it.each(["--font-display", "--font-text", "--font-mono"])(
    "%s ends in a generic family, so a missing webfont degrades rather than disappears",
    (property) => {
      const stack = light(property)
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
    expect(declarations(LIGHT).get(property)).toBe(value)
  })

  it("puts no type or spacing in the theme, because a theme changes colour and nothing else", () => {
    const shifted = [...declarations(DARK).keys()].filter(
      (property) => property.startsWith("--type-") || property.startsWith("--font-") || property.startsWith("--space-")
    )
    expect(shifted).toEqual([])
  })
})

describe("the theme", () => {
  it("rebinds a role rather than adding a second name for it", () => {
    // Everything the dark scope declares is already a role, so a component
    // never has to know which theme it is in to name the token it wants.
    const rebound = [...declarations(DARK).keys()]
    const roles = [...declarations(LIGHT).keys()]
    expect(roles).toEqual(expect.arrayContaining(rebound))
  })

  it("leaves nothing to a component's judgement: every colour role resolves in both themes", () => {
    const colours = [...declarations(LIGHT).entries()]
      .filter(([, value]) => parseColour(value) !== undefined)
      .map(([property]) => property)

    expect(colours.length).toBeGreaterThan(20)
    for (const property of colours) {
      expect(parseColour(light(property))).toBeDefined()
      expect(parseColour(dark(property))).toBeDefined()
    }
  })

  it("keeps the fixed dark palette out of the theme", () => {
    // Code blocks and the Open Graph card are dark in both themes. A value
    // that is fixed cannot also follow.
    for (const property of ["--dark-bg", "--dark-surface", "--dark-text", "--dark-muted"]) {
      expect(declarations(DARK).has(property)).toBe(false)
      expect(light(property)).toBe(dark(property))
    }
    expect(light("--dark-bg")).toBe("#121721")
    expect(light("--dark-text")).toBe("#ffffff")
    expect(light("--dark-muted")).toBe("#ccd6ff")
  })

  it("declares the colour scheme with the theme, so a native control follows", () => {
    expect(declarations(LIGHT).get("color-scheme")).toBe("light")
    expect(declarations(DARK).get("color-scheme")).toBe("dark")
  })
})

describe("the contrast audit", () => {
  const audit: ReadonlyArray<readonly [string, string, string, number]> = [
    ["ink on the page", light("--ink"), light("--page"), 16.9],
    ["muted on the page", light("--muted"), light("--page"), 4.95],
    ["muted on a card", light("--muted"), light("--card"), 5.25],
    ["accent text on a card", light("--accent-text"), light("--card"), 7.18],
    ["button text on the action colour", light("--on-accent"), light("--accent-action"), 5.1],
    ["positive on a card", light("--pos"), light("--card"), 5.25],
    ["warning on a card", light("--warn"), light("--card"), 5.86],
    ["blocked on a card", light("--bad"), light("--card"), 6.54],
    ["vault ink on the vault", light("--vault-ink"), light("--vault"), 17.95],
    ["vault muted on the vault", light("--vault-muted"), light("--vault"), 5.25],

    ["ink on a card, dark", dark("--ink"), dark("--card"), 15.91],
    ["muted on a card, dark", dark("--muted"), dark("--card"), 11.09],
    ["accent text on a card, dark", dark("--accent-text"), dark("--card"), 8.56],
    ["ink on the page, dark", dark("--ink"), dark("--page"), 17.95],
    ["muted on the page, dark", dark("--muted"), dark("--page"), 12.5],
    ["positive on a card, dark", dark("--pos"), dark("--card"), 8.45],
    ["warning on a card, dark", dark("--warn"), dark("--card"), 8.41],
    ["blocked on a card, dark", dark("--bad"), dark("--card"), 8.31],
    ["vault ink on the vault, dark", dark("--vault-ink"), dark("--vault"), 19.68],
    ["vault muted on the vault, dark", dark("--vault-muted"), dark("--vault"), 13.71],

    ["docs text on the dark palette", light("--dark-text"), light("--dark-bg"), 17.95],
    ["docs muted on the dark palette", light("--dark-muted"), light("--dark-bg"), 12.5]
  ]

  it.each(audit)("clears AA for %s", (_pairing, foreground, background, expected) => {
    const ratio = contrast(colour(foreground), colour(background))
    expect(ratio).toBeGreaterThanOrEqual(AA)
    expect(ratio).toBeCloseTo(expected, 1)
  })

  it("keeps the split rule load-bearing: the accent fill does not clear AA on a card", () => {
    // If this ever passes, the reason --accent-text exists has gone away
    // silently, and a component is free to set 14px type in --accent-fill.
    expect(contrast(colour(light("--accent-fill")), colour(light("--card")))).toBeLessThan(AA)
  })

  it("holds the accent fill to fills in the dark theme, where the ratio alone would not", () => {
    // 5.2:1 on the dark card, and the sheet still calls it a fill, because the
    // rule is about what the colour is for. Recorded so that nobody reads the
    // ratio off a checker and promotes it to text.
    expect(contrast(colour(dark("--accent-fill")), colour(dark("--card")))).toBeGreaterThanOrEqual(AA)
  })

  it("measures a raised surface on the ground it sits on", () => {
    const raised = over(colour(dark("--vault-surface")), parseAlpha(dark("--vault-surface")), colour(dark("--vault")))
    expect(contrast(colour(dark("--vault-ink")), raised)).toBeGreaterThanOrEqual(AA)
    expect(contrast(colour(dark("--vault-muted")), raised)).toBeGreaterThanOrEqual(AA)
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

  it("scopes every rule to a class of ours, never to the document", () => {
    expect(scopes.map((scope) => scope.selector)).toEqual([LIGHT, DARK])
  })

  it("carries no reset and selects no element", () => {
    expect(css).not.toMatch(/(^|[\s,{])(\*|html|body|:root|a|p|div|button|input)\s*[,{]/m)
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
