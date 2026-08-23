import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
// Named rather than default: ajv is CommonJS, and its default export only
// resolves to the class under `esModuleInterop`, which the base tsconfig does
// not enable. The named class is the same object and typechecks as one.
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

/**
 * The GET discovery contract (#15).
 *
 * Three artefacts have to agree: the JSON Schema, the examples, and the
 * text in the CIP. Any two of them can drift apart silently — a field added to
 * the schema and never documented, a rule written in the spec that nothing
 * enforces, an example that stopped being valid. Everything here exists to make
 * that drift fail on commit instead of in review.
 *
 * The examples themselves are published as part of the spec: `spec/examples/get`
 * carries payloads a conforming implementation must accept, payloads the schema
 * must reject, and payloads that are schema-valid but violate a rule the schema
 * cannot express. That third bucket is not a gap — it is the list of checks a
 * client owes on top of validation, and it is written down so `core` inherits
 * it rather than rediscovering it.
 */

const root = join(import.meta.dirname, "..")
const specPath = join(root, "spec", "CIP-XXXX", "README.md")
const schemaPath = join(root, "spec", "CIP-XXXX", "schemas", "slip-get-response.schema.json")
const examples = join(root, "spec", "examples", "get")

const source = readFileSync(specPath, "utf8")
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))
const fixtures = (dir: string): Array<string> => readdirSync(join(examples, dir)).filter((f) => f.endsWith(".json"))
const fixture = (dir: string, file: string): unknown => readJson(join(examples, dir, file))

/**
 * Strict mode on purpose: it rejects the schema keywords that look like they
 * constrain something and quietly do not — a misspelled keyword, a `type` that
 * contradicts a sibling. A schema that only appears to enforce a rule is worse
 * than one that admits it doesn't.
 *
 * `strictRequired` is the one exception, and it is off because it cannot see
 * through `$ref`: the conditional that ties `disabled` to `reason` is a shared
 * definition applied at two levels, so the properties it requires are declared
 * in the schemas that use it, not in the definition itself. Satisfying the rule
 * would mean duplicating those declarations inside every branch. A misspelled
 * `required` entry is caught instead by the text-versus-schema comparison
 * below, which would find a field the CIP does not document.
 */
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
 * Asserting only "it failed" would pass for a payload rejected by accident —
 * a typo in the fixture, a rule firing on the wrong field. Each case names the
 * keyword and the location that must do the rejecting.
 */
const schemaRejections: ReadonlyArray<Rejection> = [
  { file: "missing-title.json", keyword: "required", instancePath: "", param: "title" },
  { file: "unknown-network.json", keyword: "enum", instancePath: "/network" },
  { file: "insecure-icon.json", keyword: "pattern", instancePath: "/icon" },
  { file: "undeclared-field.json", keyword: "additionalProperties", instancePath: "", param: "amount" },
  { file: "disabled-without-reason.json", keyword: "required", instancePath: "", param: "reason" },
  { file: "reason-without-disabled.json", keyword: "required", instancePath: "", param: "disabled" },
  { file: "too-many-actions.json", keyword: "maxItems", instancePath: "/links/actions" },
  { file: "empty-actions.json", keyword: "minItems", instancePath: "/links/actions" },
  { file: "link-without-href.json", keyword: "required", instancePath: "/links/actions/0", param: "href" },
  { file: "unknown-parameter-type.json", keyword: "enum", instancePath: "/links/actions/0/parameters/0/type" },
  {
    file: "select-without-options.json",
    keyword: "required",
    instancePath: "/links/actions/0/parameters/0",
    param: "options"
  },
  { file: "bounds-on-select.json", keyword: "not", instancePath: "/links/actions/0/parameters/0" },
  { file: "options-on-number.json", keyword: "not", instancePath: "/links/actions/0/parameters/0" }
]

/**
 * Rules a JSON Schema cannot express: two of them compare sibling values, and
 * one needs the request URL. They are still normative, so the payloads live in
 * the examples with the rule they break, and the client-side check that has to
 * catch each one arrives with `core`.
 */
const ruleRejections: ReadonlyArray<{ readonly file: string; readonly rule: RegExp }> = [
  { file: "cross-origin-href.json", rule: /same origin as the discovery URL/ },
  { file: "bounds-reversed.json", rule: /MUST NOT be less than `min`/ },
  { file: "undeclared-placeholder.json", rule: /placeholder with no matching parameter MUST be\s+rejected/ },
  { file: "unfilled-placeholder-parameter.json", rule: /parameter that no placeholder references MUST be\s+rejected/ }
]

describe("the discovery schema", () => {
  it("accepts every payload the examples say is conforming", () => {
    const rejected = fixtures("valid")
      .map((file) => ({ file, errors: errorsFor(fixture("valid", file)) }))
      .filter(({ errors }) => errors.length > 0)
      .map(({ file, errors }) => `${file}: ${ajv.errorsText(errors)}`)
    expect(rejected).toEqual([])
  })

  it.each(schemaRejections)("rejects $file at $instancePath on $keyword", ({ file, keyword, instancePath, param }) => {
    const errors = errorsFor(fixture("invalid/schema", file))
    expect(errors.length).toBeGreaterThan(0)

    const matched = errors.filter((error) => error.keyword === keyword && error.instancePath === instancePath)
    expect(matched.length, `expected ${keyword} at "${instancePath}", got ${ajv.errorsText(errors)}`).toBeGreaterThan(0)

    if (param !== undefined) {
      const named = matched.some((error) => Object.values(error.params ?? {}).includes(param))
      expect(named, `expected ${keyword} to name "${param}", got ${JSON.stringify(matched.map((e) => e.params))}`).toBe(
        true
      )
    }
  })

  it("covers every fixture on disk", () => {
    // A fixture added without an expectation would otherwise sit there proving
    // nothing. Both directions: no orphan file, no expectation for a file that
    // has been deleted.
    expect(fixtures("invalid/schema").sort()).toEqual(schemaRejections.map((r) => r.file).sort())
    expect(fixtures("invalid/rule").sort()).toEqual(ruleRejections.map((r) => r.file).sort())
    expect(fixtures("valid").length).toBeGreaterThan(0)
  })
})

describe("the rules the schema cannot express", () => {
  it.each(ruleRejections)("$file passes validation, so the rule must live in the client", ({ file }) => {
    // If one of these ever starts failing validation, the schema grew a rule it
    // cannot actually enforce in every case — or the fixture stopped being the
    // thing it was written to demonstrate. Either way, look before deleting.
    expect(errorsFor(fixture("invalid/rule", file))).toEqual([])
  })

  it.each(ruleRejections)("$file has its rule stated normatively in the CIP", ({ rule }) => {
    expect(rule.test(source)).toBe(true)
  })
})

describe("the examples", () => {
  it("labels every button with the value its own href sends", () => {
    // Nothing in the schema relates a label to an href, so an example can say
    // one amount and request another and still validate. In a specification
    // that is worse than a broken example: it teaches the wrong thing, and
    // every reader who copies it inherits the mistake.
    const disagreements: Array<string> = []

    for (const dir of ["valid", "invalid/schema", "invalid/rule"]) {
      for (const file of fixtures(dir)) {
        const doc = fixture(dir, file) as {
          links?: { actions?: Array<{ label?: string; href?: string }> }
        }
        for (const action of doc.links?.actions ?? []) {
          const labelled = /\b(\d+)\b/.exec(action.label ?? "")?.[1]
          const sent = /amount=(\d+)/.exec(action.href ?? "")?.[1]
          if (labelled !== undefined && sent !== undefined && labelled !== sent) {
            disagreements.push(`${dir}/${file}: "${action.label}" sends amount=${sent}`)
          }
        }
      }
    }

    expect(disagreements).toEqual([])
  })
})

/** Slice one `###` section out of the CIP, up to the next heading of any level. */
const section = (heading: string): string => {
  const start = source.indexOf(`### ${heading}`)
  expect(start, `no "### ${heading}" section in the CIP`).toBeGreaterThan(-1)
  const rest = source.slice(start + heading.length + 4)
  const end = rest.search(/^#{2,3} /m)
  return end === -1 ? rest : rest.slice(0, end)
}

/** The first markdown table in a section, as `{ name, required }` per row. */
const fieldTable = (heading: string): Array<{ name: string; required: boolean }> => {
  const rows = section(heading)
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2) // header row, then the alignment row
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    )

  expect(rows.length, `no field table under "${heading}"`).toBeGreaterThan(0)
  return rows.map(([name, required]) => ({
    name: (name ?? "").replaceAll("`", ""),
    required: required === "yes"
  }))
}

const properties = (path: ReadonlyArray<string>): { keys: Array<string>; required: Array<string> } => {
  const node = path.reduce<Record<string, unknown>>(
    (acc, key) => acc[key] as Record<string, unknown>,
    schema as Record<string, unknown>
  )
  return {
    keys: Object.keys(node.properties as Record<string, unknown>),
    required: ((node.required as Array<string>) ?? []).slice()
  }
}

describe("the CIP text and the schema", () => {
  const documented: ReadonlyArray<{ heading: string; path: ReadonlyArray<string> }> = [
    { heading: "The discovery response", path: [] },
    { heading: "Linked actions", path: ["$defs", "linkedAction"] },
    { heading: "Parameters", path: ["$defs", "parameter"] }
  ]

  it.each(documented)("documents exactly the fields the schema defines for $heading", ({ heading, path }) => {
    const table = fieldTable(heading)
    const { keys } = properties(path)
    expect(table.map((row) => row.name).sort()).toEqual(keys.sort())
  })

  it.each(documented)("agrees with the schema about what is required in $heading", ({ heading, path }) => {
    const table = fieldTable(heading)
    const { required } = properties(path)
    expect(
      table
        .filter((row) => row.required)
        .map((row) => row.name)
        .sort()
    ).toEqual(required.sort())
  })

  it("illustrates its sections only with payloads from the examples", () => {
    // An example written inline is an example nothing validates. Every JSON
    // block in the specification is a file under `spec/examples/<shape>/valid`,
    // so a shape change breaks the example and the fixture together or not at
    // all. The block's own `type` picks which shape it is held to, which is
    // what lets one check cover a document that grows a section per issue —
    // a new shape registers here when its section lands.
    const shapes: Record<string, { readonly schema: string; readonly examples: string }> = {
      slip: { schema: "slip-get-response.schema.json", examples: "get" },
      error: { schema: "slip-error-response.schema.json", examples: "error" },
      partial: { schema: "slip-partial-intent.schema.json", examples: "partial" }
    }

    const blocks = [...source.matchAll(/```json\n([\s\S]*?)```/g)].map(
      (match) => JSON.parse(match[1]) as { type?: string }
    )
    expect(blocks.length).toBeGreaterThanOrEqual(4)

    for (const block of blocks) {
      const printed = `${JSON.stringify(block).slice(0, 80)}…`
      const shape = shapes[block.type ?? ""]
      expect(shape, `a JSON example in the CIP declares no shape this test knows: ${printed}`).toBeDefined()

      const shapeAjv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true })
      const shapeValidate = shapeAjv.compile(
        JSON.parse(readFileSync(join(root, "spec", "CIP-XXXX", "schemas", shape.schema), "utf8")) as Record<
          string,
          unknown
        >
      )
      expect(
        shapeValidate(block),
        `a JSON example in the CIP fails its own schema: ${shapeAjv.errorsText(shapeValidate.errors)}`
      ).toBe(true)

      const dir = join(root, "spec", "examples", shape.examples, "valid")
      const held = readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson(join(dir, file)))
      expect(held, `a JSON example in the CIP is not in the examples: ${printed}`).toContainEqual(block)
    }
  })

  it("introduces the keywords it then relies on", () => {
    // A CIP that uses MUST without invoking RFC 2119 gets bounced by an editor
    // before anyone reads the content.
    expect(source).toContain("[RFC 2119]")
    expect(source).toContain("[RFC 8174]")
    expect(source).toMatch(/^\[RFC 2119\]: https:\/\/www\.rfc-editor\.org/m)
    expect(source).toMatch(/^\[RFC 8174\]: https:\/\/www\.rfc-editor\.org/m)
  })

  it("states the two rules that make an unusable action renderable", () => {
    const unavailable = section("Unavailable actions")
    // Both of these have bitten every protocol that shipped without them: a
    // dead control with no reason, and a client that hides what it can't use.
    expect(unavailable).toMatch(/MUST be accompanied by `reason`/)
    expect(unavailable).toMatch(/MUST NOT hide a disabled action/)
    // Precedence, spelled out — a linked action cannot re-open a closed one.
    expect(unavailable).toMatch(/top level wins/)
  })
})

/**
 * The vocabulary the rename settled (ADR-0008).
 *
 * Three constants became load-bearing the moment the protocol stopped being
 * called Actions: the discriminator a client switches on, the URI authority the
 * CIP registers, and the discovery filename a publisher serves. Each is cited
 * by third-party implementers and none of them was covered before, so a silent
 * revert — or a half-finished re-rename later — would have passed CI.
 *
 * The last case here is the inverse guard. `links.actions` and `linkedAction`
 * were deliberately *kept*: a Slip offers up to three actions, and those are
 * choices within one Slip rather than Slips of their own. That decision is easy
 * to undo by accident during a future sweep, so it is pinned too.
 */
describe("the vocabulary the rename settled", () => {
  const properties = schema["properties"] as Record<string, Record<string, unknown>>
  const defs = schema["$defs"] as Record<string, unknown>

  it("discriminates a discovery response with type slip", () => {
    expect(properties["type"]?.["const"]).toBe("slip")
  })

  it("carries that discriminator through every valid example", () => {
    for (const file of fixtures("valid")) {
      const doc = fixture("valid", file) as { type?: string }
      expect(doc.type, `${file} does not declare type slip`).toBe("slip")
    }
  })

  it("documents the same value in the CIP text", () => {
    // The table and the schema are the two places an implementer looks;
    // they disagreeing is exactly the drift this file exists to catch.
    expect(source).toContain('MUST be `"slip"`')
    expect(source).not.toContain('MUST be `"action"`')
  })

  it("registers the //slip authority and nothing under //action", () => {
    expect(source).toContain("`//slip`")
    expect(source).not.toMatch(/web\+cardano:\/\/action/)
    expect(source).not.toMatch(/`\/\/action`/)
  })

  it("names the discovery file slips.json", () => {
    expect(source).toContain("slips.json")
    expect(source).not.toMatch(/(^|[^-])actions\.json/m)
  })

  it("keeps linked actions named actions, which the rename left alone", () => {
    // Deliberate: a Slip offers up to three actions. These are choices inside
    // one Slip, not Slips in their own right.
    const links = properties["links"] as { properties?: Record<string, unknown> }
    expect(links.properties).toHaveProperty("actions")
    expect(defs).toHaveProperty("linkedAction")
  })
})
