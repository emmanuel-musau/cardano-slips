import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
// Named rather than default: ajv is CommonJS, and its default export only
// resolves to the class under `esModuleInterop`, which the base tsconfig does
// not enable. The named class is the same object and typechecks as one.
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

/**
 * The `slips.json` domain mapping (#16).
 *
 * This is the one mechanism in the protocol that lets one URL stand for
 * another, which is the hijack CIP-13's own security considerations name. The
 * spec already forbids a cross-origin `href` on a linked action and points here
 * as the sanctioned indirection; the tests below are what make that sentence
 * true rather than merely written.
 *
 * The safety property is structural, not procedural: `apiPath` is a
 * path-absolute reference, so another host is unrepresentable rather than
 * forbidden. There is no origin comparison for an implementation to skip.
 *
 * A shape test proves very little about a rewriting algorithm, so the spec
 * also publishes a resolution table — rule sets, input paths, expected results
 * — and this file runs it against a reference resolver of the specified
 * algorithm. That is a weaker claim than the schema tests make: it shows the
 * table agrees with an implementation of the spec rather than with the spec
 * itself. `core`'s `slips-json.ts` runs the same table, and the day the two
 * disagree is the day one of them is wrong in a way a reader can check.
 */

const root = join(import.meta.dirname, "..")
const specPath = join(root, "spec", "CIP-XXXX", "README.md")
const schemaPath = join(root, "spec", "CIP-XXXX", "schemas", "slips-json.schema.json")
const examples = join(root, "spec", "examples", "slips-json")

const source = readFileSync(specPath, "utf8")
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))
const fixtures = (dir: string): Array<string> => readdirSync(join(examples, dir)).filter((f) => f.endsWith(".json"))
const fixture = (dir: string, file: string): unknown => readJson(join(examples, dir, file))

/** See the note in spec-get-discovery.test.ts for why strictRequired is off. */
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true })
const validate: ValidateFunction = ajv.compile(schema)

const errorsFor = (payload: unknown): Array<ErrorObject> => {
  validate(payload)
  return [...(validate.errors ?? [])]
}

/** One rejection the schema itself must produce, and where. */
type Rejection = {
  readonly file: string
  readonly keyword: string
  readonly instancePath: string
  readonly param?: string
}

/**
 * `absolute-api-path.json` is the first case for the same reason
 * `utxos-in-the-body.json` leads the build examples: it is the payload the whole
 * mechanism exists to make unexpressible, and it fails on the grammar rather
 * than on a rule someone has to remember to run.
 */
const schemaRejections: ReadonlyArray<Rejection> = [
  { file: "absolute-api-path.json", keyword: "pattern", instancePath: "/rules/0/apiPath" },
  { file: "protocol-relative-api-path.json", keyword: "pattern", instancePath: "/rules/0/apiPath" },
  { file: "double-star-not-last.json", keyword: "pattern", instancePath: "/rules/0/pathPattern" },
  { file: "partial-wildcard.json", keyword: "pattern", instancePath: "/rules/0/pathPattern" },
  { file: "relative-path-pattern.json", keyword: "pattern", instancePath: "/rules/0/pathPattern" },
  { file: "dot-segment.json", keyword: "pattern", instancePath: "/rules/0/pathPattern" },
  { file: "empty-segment.json", keyword: "pattern", instancePath: "/rules/0/pathPattern" },
  { file: "missing-api-path.json", keyword: "required", instancePath: "/rules/0", param: "apiPath" },
  { file: "rule-undeclared-field.json", keyword: "additionalProperties", instancePath: "/rules/0", param: "status" },
  { file: "undeclared-field.json", keyword: "additionalProperties", instancePath: "", param: "redirects" },
  { file: "missing-rules.json", keyword: "required", instancePath: "", param: "rules" },
  { file: "empty-rules.json", keyword: "minItems", instancePath: "/rules" },
  { file: "too-many-rules.json", keyword: "maxItems", instancePath: "/rules" }
]

/**
 * Two rules a JSON Schema cannot express, and both are about a relationship
 * between values rather than the shape of one.
 */
const ruleRejections: ReadonlyArray<{ readonly file: string; readonly rule: RegExp }> = [
  { file: "wildcard-count-disagrees.json", rule: /the same wildcards, of the same kinds, in the same order/ },
  { file: "wildcard-kind-disagrees.json", rule: /the same wildcards, of the same kinds, in the same order/ },
  { file: "duplicate-path-pattern.json", rule: /MUST NOT declare the same `pathPattern` twice/ }
]

describe("the slips.json schema", () => {
  it("accepts every payload the examples say is conforming", () => {
    const rejected = fixtures("valid")
      .map((file) => ({ file, errors: errorsFor(fixture("valid", file)) }))
      .filter(({ errors }) => errors.length > 0)
      .map(({ file, errors }) => `${file}: ${ajv.errorsText(errors)}`)
    expect(rejected).toEqual([])
  })

  it.each(schemaRejections)("rejects $file at $instancePath on $keyword", ({ file, keyword, instancePath, param }) => {
    const errors = errorsFor(fixture("invalid/schema", file))
    const matched = errors.filter((error) => error.keyword === keyword && error.instancePath === instancePath)
    expect(matched.length, `expected ${keyword} at "${instancePath}", got ${ajv.errorsText(errors)}`).toBeGreaterThan(0)

    if (param !== undefined) {
      const named = matched.some((error) => Object.values(error.params ?? {}).includes(param))
      expect(named, `expected ${keyword} to name "${param}"`).toBe(true)
    }
  })

  it("covers every fixture on disk", () => {
    expect(fixtures("invalid/schema").sort()).toEqual(schemaRejections.map((r) => r.file).sort())
    expect(fixtures("invalid/rule").sort()).toEqual(ruleRejections.map((r) => r.file).sort())
    expect(fixtures("valid").length).toBeGreaterThan(0)
  })

  it("makes another host unexpressible rather than merely forbidden", () => {
    // The whole security argument for this mechanism. A rule that has to be
    // *checked* is a rule an implementation can skip; a grammar that cannot
    // carry a host has nothing to skip. Every form that could name one —
    // absolute, protocol-relative, or a bare authority — fails the pattern.
    const defs = schema["$defs"] as Record<string, Record<string, unknown>>
    const path = new RegExp(defs["pathTemplate"]["pattern"] as string)
    for (const hostile of [
      "https://api.other.example/slips",
      "//api.other.example/slips",
      "http://api.other.example",
      "api.other.example/slips"
    ]) {
      expect(path.test(hostile), `the grammar admits ${hostile}`).toBe(false)
    }
  })

  it("carries no version, because one origin may front several", () => {
    // Every other shape in this protocol declares its major version. This one
    // cannot coherently: it maps paths for a whole origin, and an origin is
    // free to serve a v1 endpoint at one path and a v2 endpoint at another.
    expect(Object.keys(schema["properties"] as Record<string, unknown>)).toEqual(["rules"])
    expect(source).toMatch(/`slips.json` carries no `version`/)
  })
})

describe("the rules the schema cannot express", () => {
  it.each(ruleRejections)("$file passes validation, so the rule must live in the client", ({ file }) => {
    expect(errorsFor(fixture("invalid/rule", file))).toEqual([])
  })

  it.each(ruleRejections)("$file has its rule stated normatively in the CIP", ({ rule }) => {
    expect(rule.test(source)).toBe(true)
  })
})

/**
 * The resolution algorithm as the CIP specifies it.
 *
 * Deliberately literal: it follows the numbered steps in the spec rather than
 * being written the way one would write it for production. Anything clever here
 * would be testing the cleverness instead of the specification.
 */
const removeDotSegments = (path: string): string => {
  const out: Array<string> = []
  for (const segment of path.split("/").slice(1)) {
    if (segment === ".") continue
    if (segment === "..") {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return `/${out.join("/")}`
}

const matchPattern = (pattern: string, path: string): Array<string> | undefined => {
  const patternSegments = pattern.split("/").slice(1)
  const pathSegments = path.split("/").slice(1)
  const captured: Array<string> = []

  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]

    if (expected === "**") {
      // Only ever the final segment, and it needs at least one to take.
      const rest = pathSegments.slice(index)
      if (rest.length === 0 || rest.some((segment) => segment === "")) return undefined
      captured.push(rest.join("/"))
      return captured
    }

    const actual = pathSegments[index]
    if (actual === undefined || actual === "") return undefined
    if (expected === "*") {
      captured.push(actual)
      continue
    }
    if (expected !== actual) return undefined
  }

  return pathSegments.length === patternSegments.length ? captured : undefined
}

type Rule = { readonly pathPattern: string; readonly apiPath: string }

const resolve = (rules: ReadonlyArray<Rule>, target: string): string => {
  const [rawPath, query] = ((): [string, string] => {
    const at = target.indexOf("?")
    return at === -1 ? [target, ""] : [target.slice(0, at), target.slice(at)]
  })()

  const path = removeDotSegments(rawPath)

  for (const rule of rules) {
    const captured = matchPattern(rule.pathPattern, path)
    if (captured === undefined) continue

    let index = 0
    const rewritten = rule.apiPath.replaceAll(/\*\*|\*/g, () => captured[index++] ?? "")
    // One hop: the result is never matched against the rules again.
    return rewritten + query
  }

  return path + query
}

type ResolutionCase = {
  readonly name: string
  readonly rules: ReadonlyArray<Rule>
  readonly path: string
  readonly resolved: string
}

const resolutionCases = (readJson(join(examples, "resolution.json")) as { cases: Array<ResolutionCase> }).cases

describe("the published resolution table", () => {
  it.each(resolutionCases)("$name", ({ rules, path, resolved }) => {
    expect(resolve(rules, path)).toBe(resolved)
  })

  it("uses only rule sets that are themselves conforming", () => {
    // A case built on a slips.json no publisher could serve would prove a
    // behaviour nothing can reach.
    const invalid = resolutionCases
      .map((entry) => ({ name: entry.name, errors: errorsFor({ rules: entry.rules }) }))
      .filter(({ errors }) => errors.length > 0)
      .map(({ name, errors }) => `${name}: ${ajv.errorsText(errors)}`)
    expect(invalid).toEqual([])
  })

  it("covers the cases that separate this from a naive rewriter", () => {
    // Each of these is a place an implementation written from the written spec alone
    // would plausibly differ, so each has to be in the published table rather
    // than only in someone's head.
    const names = resolutionCases.map((entry) => entry.name)
    for (const required of [
      "does not re-match its own output",
      "takes the first matching rule",
      "leaves a path no rule matches alone",
      "carries the query string across",
      "keeps an encoded slash inside one segment",
      "removes dot segments before matching",
      "does not treat a trailing slash as equivalent",
      "matches case-sensitively"
    ]) {
      expect(names, `the table has no case for: ${required}`).toContain(required)
    }
  })
})

/** Slice one section out of the CIP, up to the next heading of any level. */
const slice = (heading: string, level: number): string => {
  const marker = `${"#".repeat(level)} ${heading}\n`
  const start = source.indexOf(marker)
  expect(start, `no "${marker.trim()}" section in the CIP`).toBeGreaterThan(-1)
  const rest = source.slice(start + marker.length)
  const end = rest.search(/^#{2,4} /m)
  return end === -1 ? rest : rest.slice(0, end)
}

const mapping = slice("Domain mapping", 3)

describe("the CIP text and the schema", () => {
  it("documents exactly the fields a rule defines", () => {
    const rows = mapping
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .slice(2)
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim())
      )
    expect(rows.length, "no field table under Domain mapping").toBeGreaterThan(0)

    const defs = schema["$defs"] as Record<string, Record<string, unknown>>
    const rule = defs["rule"]
    expect(rows.map((row) => row[0].replaceAll("`", "")).sort()).toEqual(
      Object.keys(rule["properties"] as Record<string, unknown>).sort()
    )
    expect(
      rows
        .filter((row) => row[1] === "yes")
        .map((row) => row[0].replaceAll("`", ""))
        .sort()
    ).toEqual(((rule["required"] as Array<string>) ?? []).slice().sort())
  })

  it("serves the file from the origin's root, cross-origin readable", () => {
    expect(mapping).toMatch(/\/slips\.json/)
    expect(mapping).toMatch(/Access-Control-Allow-Origin: \*/)
  })

  it("makes the file optional, and its absence mean the link is its own endpoint", () => {
    expect(mapping).toMatch(/MUST treat the\s+link as its own endpoint/)
  })

  it("separates an absent mapping from one it could not read", () => {
    // The distinction Solana's actions.json does not make, and the reason a
    // network blip must not silently route a person to the human URL: a client
    // that falls through cannot tell an origin with no mapping from one whose
    // mapping it failed to fetch.
    expect(mapping).toMatch(/MUST NOT treat it as absent/)
    expect(mapping).toMatch(/UNREACHABLE/)
    expect(mapping).toMatch(/MALFORMED_RESPONSE/)
  })

  it("resolves in one hop, and says so where an implementer will look", () => {
    expect(mapping).toMatch(/MUST NOT match the result against the rules again/)
  })

  it("illustrates the file with a payload from the examples", () => {
    // Like the build request, this shape has no `type` to name it by, so it
    // travels inside an ```http block rather than a ```json one and the check
    // that keeps examples honest has to live here. An example nothing
    // validates teaches whatever its author last typed.
    const bodies = [...mapping.matchAll(/```http\n[\s\S]*?\n\n(\{[\s\S]*?)\n```/g)].map(
      (match) => JSON.parse(match[1]) as unknown
    )
    expect(bodies.length).toBeGreaterThan(0)

    const held = fixtures("valid").map((file) => fixture("valid", file))
    for (const body of bodies) {
      expect(errorsFor(body), "an example in the CIP fails its own schema").toEqual([])
      expect(held, "an example in the CIP is not in the examples").toContainEqual(body)
    }
  })

  it("gives the worked example the issue asks for", () => {
    expect(mapping).toContain("linktap.example/delegate/POOL1")
  })

  it("is reachable from the rule that sends a publisher here", () => {
    // #15 forbids a cross-origin href and calls slips.json the sanctioned
    // indirection. That was a promise about a section which did not exist.
    expect(source).toMatch(/\[`slips\.json`\]\(#domain-mapping\) is the sanctioned indirection/)
  })
})
