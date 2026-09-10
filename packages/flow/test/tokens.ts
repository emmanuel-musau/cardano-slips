/**
 * Reads `tokens.css` the way a browser would — declarations per scope, `var()`
 * resolved through the scope that inherits — plus WCAG relative luminance, so
 * the sheet's contrast audit can be re-run against the values rather than
 * copied in as numbers nothing checks.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export type Scope = { readonly selector: string; readonly declarations: ReadonlyMap<string, string> }

const tokensPath = join(import.meta.dirname, "..", "src", "tokens.css")

export const tokensSource = (): string => readFileSync(tokensPath, "utf8")

/** Comments carry hex in prose; stripping them first keeps a parser out of the argument. */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")

export const parseScopes = (css: string): ReadonlyArray<Scope> => {
  const scopes: Array<Scope> = []
  for (const [, selector, body] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>()
    for (const line of (body ?? "").split(";")) {
      const at = line.indexOf(":")
      if (at === -1) continue
      declarations.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
    }
    scopes.push({ selector: (selector ?? "").trim(), declarations })
  }
  return scopes
}

/**
 * What a property resolves to inside `selector`. A scope that does not declare
 * a token inherits it from `.slip-root`, which is what the dark block relies on
 * — it rebinds the roles it changes and nothing else.
 */
export const resolve = (scopes: ReadonlyArray<Scope>, selector: string, property: string): string | undefined => {
  const inScope = scopes.find((scope) => scope.selector === selector)?.declarations.get(property)
  const declared = inScope ?? scopes.find((scope) => scope.selector === ".slip-root")?.declarations.get(property)
  if (declared === undefined) return undefined

  const reference = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/.exec(declared)
  return reference?.[1] === undefined ? declared : resolve(scopes, selector, reference[1])
}

export type Rgb = readonly [number, number, number]

export const parseColour = (value: string): Rgb | undefined => {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value.trim())
  if (hex?.[1] !== undefined) {
    const packed = Number.parseInt(hex[1], 16)
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
  }

  const rgba = /^rgba?\(\s*([0-9]+)[\s,]+([0-9]+)[\s,]+([0-9]+)/.exec(value.trim())
  if (rgba === null) return undefined
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])]
}

/** The alpha of an `rgba()`, or 1 where the colour is opaque. */
export const parseAlpha = (value: string): number => {
  const found = /^rgba\(\s*[0-9]+[\s,]+[0-9]+[\s,]+[0-9]+[\s,/]+([0-9.]+)\s*\)$/.exec(value.trim())
  return found?.[1] === undefined ? 1 : Number(found[1])
}

/** Source-over composite, so a translucent surface can be measured on the ground it sits on. */
export const over = (colour: Rgb, alpha: number, background: Rgb): Rgb => [
  Math.round(colour[0] * alpha + background[0] * (1 - alpha)),
  Math.round(colour[1] * alpha + background[1] * (1 - alpha)),
  Math.round(colour[2] * alpha + background[2] * (1 - alpha))
]

const channel = (value: number): number => {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
}

/** WCAG 2.2 relative luminance. */
export const luminance = ([red, green, blue]: Rgb): number =>
  0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)

export const contrast = (foreground: Rgb, background: Rgb): number => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA for body-sized text. */
export const AA = 4.5
