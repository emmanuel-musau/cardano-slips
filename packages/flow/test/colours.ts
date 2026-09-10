/**
 * Finds a colour written anywhere but `tokens.css`. `docs/ARCHITECTURE.md`
 * makes the token file the only place a colour is defined; this is what turns
 * that from a sentence into a rule, and it is exercised on samples of its own
 * so a gap in the detector shows up as a failing test rather than as silence.
 */

export type ColourFinding = {
  readonly file: string
  readonly line: number
  /** The colour as written, so a failure names the thing to replace. */
  readonly text: string
}

/** `#abc`, `#abcd`, `#aabbcc`, `#aabbccdd` — and nothing else that starts with a `#`. */
const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

/** Every CSS function that produces a colour, including the ones that mix two. */
const colourFunction = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/g

/**
 * The CSS named colours (Color Module Level 4). `transparent` and
 * `currentColor` are deliberately absent: they carry no colour of their own,
 * so they cannot contradict a token.
 */
const namedColours = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen"
] as const

/**
 * A name only counts in a value position — after a `:` or an `=`, optionally
 * quoted. Otherwise `whiteSpace`, a person called Violet, and the word "red" in
 * a sentence all read as colours.
 */
const namedColourInValue = new RegExp(`[:=]\\s*["'\`]?(${namedColours.join("|")})\\b`, "gi")

/** Properties whose value is a colour. Kebab-case only: this list is read against stylesheets. */
const colourProperties = [
  "color",
  "background",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "column-rule-color",
  "caret-color",
  "accent-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow"
]

const declaration = new RegExp(`(?:^|[\\s{;])(${colourProperties.join("|")})\\s*:\\s*([^;}]+)`, "gi")

/** One `var()` with no `var()` inside it. Applied until nothing changes, so a fallback chain unwinds. */
const varCall = /var\(\s*--[a-zA-Z0-9_-]+\s*(?:,[^()]*)?\)/gi

const withoutTokens = (value: string): string => {
  let previous = ""
  let current = value
  while (current !== previous) {
    previous = current
    current = current.replace(varCall, " ")
  }
  return current
}

/** What is left of a colour-carrying value once every token reference is gone. */
const allowedInValue =
  /\b(?:inherit|initial|unset|revert|none|transparent|currentColor|auto|inset)\b|[-+]?[0-9.]+[a-z%]*|[\s,/]/gi

const match = (line: string, pattern: RegExp): ReadonlyArray<string> =>
  [...line.matchAll(pattern)].map(([found]) => found)

/**
 * A declaration is a finding when something is left over after every `var()`,
 * keyword and length is removed — that leftover is a colour written by hand.
 * Applied to stylesheets only: in TypeScript the same value position holds
 * ordinary identifiers, and `color: theme.ink` is not a hard-coded colour.
 */
const literalDeclarations = (line: string): ReadonlyArray<string> =>
  [...line.matchAll(declaration)]
    .filter(
      ([, , value]) =>
        withoutTokens(value ?? "")
          .replace(allowedInValue, "")
          .trim() !== ""
    )
    .map(([found]) => found.trim())

export const findColours = (file: string, source: string): ReadonlyArray<ColourFinding> => {
  const isStylesheet = file.endsWith(".css")

  return source.split("\n").flatMap((line, index) => {
    const found = [
      ...match(line, hex),
      ...match(line, colourFunction),
      ...match(line, namedColourInValue),
      ...(isStylesheet ? literalDeclarations(line) : [])
    ]

    return found.map((text) => ({ file, line: index + 1, text: text.trim() }))
  })
}
