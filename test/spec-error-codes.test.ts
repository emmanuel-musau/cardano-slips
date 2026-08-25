import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
// Named, not default: ajv is CommonJS and its default export only resolves to
// the class under `esModuleInterop`, which the base tsconfig does not enable.
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

/**
 * The failure codes and the versioning rule (#18).
 *
 * The codes only stay a closed vocabulary if the table in the written spec, the
 * JSON Schema and the examples agree, so every pair is compared. The versioning
 * rules have no schema to enforce them — the response may satisfy some *other*
 * version's schema — so they are asserted against the written spec directly.
 */

const root = join(import.meta.dirname, "..")
const specPath = join(root, "spec", "CIP-XXXX", "README.md")
const schemas = join(root, "spec", "CIP-XXXX", "schemas")
const examples = join(root, "spec", "examples", "error")

const source = readFileSync(specPath, "utf8")

/** Two schemas binding two parties: the endpoint's `code` is closed to the v1 list, the client's is not (ADR-0009). */
const schema = JSON.parse(readFileSync(join(schemas, "slip-error-response.schema.json"), "utf8")) as Record<
  string,
  unknown
>
const endpointSchema = JSON.parse(
  readFileSync(join(schemas, "slip-error-response-endpoint.schema.json"), "utf8")
) as Record<string, unknown>

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))
const fixtures = (dir: string): Array<string> => readdirSync(join(examples, dir)).filter((f) => f.endsWith(".json"))
const fixture = (dir: string, file: string): unknown => readJson(join(examples, dir, file))

const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true })
ajv.addSchema(schema)
const validate: ValidateFunction = ajv.compile(schema)
const validateEndpoint: ValidateFunction = ajv.compile(endpointSchema)

/** What an endpoint is held to: the shape, with `code` closed to the v1 list. */
const errorsFor = (payload: unknown): Array<ErrorObject> => {
  validateEndpoint(payload)
  return [...(validateEndpoint.errors ?? [])]
}

/** What a client must be able to read, whatever the `code` turns out to say. */
const clientErrorsFor = (payload: unknown): Array<ErrorObject> => {
  validate(payload)
  return [...(validate.errors ?? [])]
}

/** Slice one `###` section out of the CIP, up to the next heading of any level. */
const section = (heading: string): string => {
  const start = source.indexOf(`### ${heading}`)
  expect(start, `no "### ${heading}" section in the CIP`).toBeGreaterThan(-1)
  const rest = source.slice(start + heading.length + 4)
  const end = rest.search(/^#{2,3} /m)
  return end === -1 ? rest : rest.slice(0, end)
}

const failures = section("Failure responses")
const versioning = section("Protocol versioning")

/** Every markdown table in a chunk of text, as rows of trimmed cells. */
const tables = (text: string): Array<Array<Array<string>>> => {
  const found: Array<Array<Array<string>>> = []
  let current: Array<Array<string>> = []

  for (const line of text.split("\n")) {
    if (line.startsWith("|")) {
      current.push(
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim())
      )
    } else if (current.length > 0) {
      found.push(current.slice(2)) // header row, then the alignment row
      current = []
    }
  }
  if (current.length > 0) found.push(current.slice(2))
  return found
}

const unquote = (cell: string): string => cell.replaceAll("`", "")

// The field table comes first in the section, the code table second.
const [fieldRows, codeRows] = tables(failures)

type Code = {
  readonly code: string
  readonly klass: string
  readonly status: string
  readonly raisedBy: ReadonlyArray<string>
}

const codeTable: ReadonlyArray<Code> = (codeRows ?? []).map((row) => ({
  code: unquote(row[0] ?? ""),
  klass: row[1] ?? "",
  status: unquote(row[2] ?? ""),
  raisedBy: (row[3] ?? "").split(",").map((who) => who.trim())
}))

const sent = codeTable.filter((entry) => entry.raisedBy.includes("endpoint"))
const raisedLocally = codeTable.filter((entry) => !entry.raisedBy.includes("endpoint"))
const enumerated = ((endpointSchema["$defs"] as Record<string, { enum?: Array<string> }>)["code"]?.enum ?? []).slice()

/** One rejection the schema itself must produce, and where. */
type Rejection = {
  readonly file: string
  readonly keyword: string
  readonly instancePath: string
  readonly param?: string
  /** Whether a client can still read it: an undefined `code` value can, a broken shape cannot. */
  readonly readable: "readable" | "unreadable"
}

/** Naming the keyword and location: "it failed" would pass for a payload rejected by accident. */
const schemaRejections: ReadonlyArray<Rejection> = [
  { file: "missing-code.json", keyword: "required", instancePath: "", param: "code", readable: "unreadable" },
  { file: "missing-version.json", keyword: "required", instancePath: "", param: "version", readable: "unreadable" },
  { file: "empty-message.json", keyword: "minLength", instancePath: "/message", readable: "unreadable" },
  { file: "stack-trace-message.json", keyword: "maxLength", instancePath: "/message", readable: "unreadable" },
  { file: "unknown-code.json", keyword: "enum", instancePath: "/code", readable: "readable" },
  { file: "client-code-on-the-wire.json", keyword: "enum", instancePath: "/code", readable: "readable" },
  { file: "field-without-invalid-parameter.json", keyword: "not", instancePath: "", readable: "unreadable" },
  {
    file: "undeclared-field.json",
    keyword: "additionalProperties",
    instancePath: "",
    param: "retryAfter",
    readable: "unreadable"
  }
]

/** Neither is a shape a schema can see — both fixtures are well-formed failures of the right length. */
const ruleRejections: ReadonlyArray<{ readonly file: string; readonly rule: RegExp }> = [
  { file: "markup-in-message.json", rule: /MUST NOT contain markup/ },
  { file: "internal-detail-in-message.json", rule: /MUST NOT carry internal detail/ }
]

describe("the failure schema", () => {
  it("accepts every payload the examples say is conforming, under both schemas", () => {
    const rejected = fixtures("valid")
      .flatMap((file) => [
        { file: `${file} (endpoint)`, errors: errorsFor(fixture("valid", file)) },
        { file: `${file} (client)`, errors: clientErrorsFor(fixture("valid", file)) }
      ])
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

  it.each(schemaRejections)("holds $file to the client schema as $readable", ({ file, readable }) => {
    // Rejected over the *value* of `code` is still readable; structurally broken is not.
    const errors = clientErrorsFor(fixture("invalid/schema", file))
    expect(errors.length === 0, `client schema said: ${ajv.errorsText(errors)}`).toBe(readable === "readable")
  })

  it("splits those two cases rather than collapsing them", () => {
    const readable = schemaRejections.filter((r) => r.readable === "readable")
    expect(readable.length).toBeGreaterThan(0)
    expect(readable.length).toBeLessThan(schemaRejections.length)
  })

  it("covers every fixture on disk", () => {
    expect(fixtures("invalid/schema").sort()).toEqual(schemaRejections.map((r) => r.file).sort())
    expect(fixtures("invalid/rule").sort()).toEqual(ruleRejections.map((r) => r.file).sort())
    expect(fixtures("valid").length).toBeGreaterThan(0)
  })
})

describe("the rules the schema cannot express", () => {
  it.each(ruleRejections)("$file passes validation, so the rule must live in the client", ({ file }) => {
    // Both schemas: nothing about their shape betrays what the message says.
    expect(errorsFor(fixture("invalid/rule", file))).toEqual([])
    expect(clientErrorsFor(fixture("invalid/rule", file))).toEqual([])
  })

  it.each(ruleRejections)("$file has its rule stated normatively in the CIP", ({ rule }) => {
    expect(rule.test(failures)).toBe(true)
  })
})

describe("the code table", () => {
  it("is published as a table a reader can act on", () => {
    expect(codeTable.length).toBeGreaterThan(0)
    expect(sent.length).toBeGreaterThan(0)
    expect(raisedLocally.length).toBeGreaterThan(0)
  })

  it("names each code once", () => {
    expect(new Set(codeTable.map((entry) => entry.code)).size).toBe(codeTable.length)
  })

  it("puts every code in exactly one of the three classes", () => {
    const misclassed = codeTable.filter((entry) => !["request", "terminal", "transient"].includes(entry.klass))
    expect(misclassed.map((entry) => `${entry.code}: ${entry.klass}`)).toEqual([])
  })

  it("shapes each code like a code", () => {
    const malformed = codeTable.filter((entry) => !/^[A-Z][A-Z0-9_]{2,47}$/.test(entry.code))
    expect(malformed.map((entry) => entry.code)).toEqual([])
  })

  it("enumerates in the schema exactly the codes an endpoint may send", () => {
    expect(sent.map((entry) => entry.code).sort()).toEqual(enumerated.sort())
  })

  it("keeps client-raised codes off the wire", () => {
    for (const entry of raisedLocally) {
      expect(enumerated, `${entry.code} is client-raised but the schema lets an endpoint send it`).not.toContain(
        entry.code
      )
      const body = { type: "error", version: "1", code: entry.code, message: "x" }
      expect(errorsFor(body).length, `an endpoint may send ${entry.code}`).toBeGreaterThan(0)
      // Readable all the same, so a client meeting one still renders the message.
      expect(clientErrorsFor(body)).toEqual([])
    }
    expect(failures).toMatch(/MUST\s+NOT send a code the table marks as raised only by a client/)
  })

  it("names the one code both parties can raise, and keeps it sendable", () => {
    // Derived from the table: the written spec once stated this as a numeral, and it was wrong.
    const dual = codeTable.filter((entry) => entry.raisedBy.includes("endpoint") && entry.raisedBy.includes("client"))
    expect(dual.map((entry) => entry.code)).toEqual(["WRONG_NETWORK"])
    expect(enumerated).toContain("WRONG_NETWORK")
    expect(failures).toMatch(/`WRONG_NETWORK` is raised by both/)
  })

  it("pairs every endpoint code with one status, in the family its class implies", () => {
    for (const entry of sent) {
      expect(entry.status, `${entry.code} carries no status`).toMatch(/^[45][0-9][0-9]$/)
      const status = Number(entry.status)
      if (entry.klass === "transient") expect(status === 429 || status >= 500, `${entry.code} is ${status}`).toBe(true)
      else expect(status, `${entry.code} is ${status}`).toBeLessThan(500)
    }
  })

  it("gives client-raised codes no status at all", () => {
    for (const entry of raisedLocally) {
      expect(entry.status, `${entry.code} claims status ${entry.status}`).toBe("—")
    }
  })

  it("illustrates every code an endpoint can send with a payload in the examples", () => {
    const covered = fixtures("valid").map((file) => (fixture("valid", file) as { code?: string }).code)
    expect(covered.filter((code) => code !== undefined).sort()).toEqual(sent.map((entry) => entry.code).sort())
  })

  it("never transmits the class", () => {
    // An endpoint that could declare its own failure transient could keep a client asking.
    expect(Object.keys(schema["properties"] as Record<string, unknown>)).not.toContain("class")
    expect(failures).toMatch(/deliberately not a field/)
    for (const dir of ["valid", "invalid/schema", "invalid/rule"]) {
      for (const file of fixtures(dir)) {
        expect(fixture(dir, file)).not.toHaveProperty("class")
      }
    }
  })
})

describe("the CIP text and the failure schema", () => {
  const documented = (fieldRows ?? []).map((row) => ({ name: unquote(row[0] ?? ""), required: row[1] === "yes" }))
  const properties = Object.keys(schema["properties"] as Record<string, unknown>)
  const required = ((schema["required"] as Array<string>) ?? []).slice()

  it("documents exactly the fields the schema defines", () => {
    expect(documented.map((row) => row.name).sort()).toEqual(properties.sort())
  })

  it("agrees with the schema about what is required", () => {
    expect(
      documented
        .filter((row) => row.required)
        .map((row) => row.name)
        .sort()
    ).toEqual(required.sort())
  })

  it("discriminates a failure with type error", () => {
    expect((schema["properties"] as Record<string, Record<string, unknown>>)["type"]?.["const"]).toBe("error")
    expect(failures).toContain('MUST be `"error"`')
  })

  it("keeps a failure distinct from an action that is merely unavailable", () => {
    // `reason` accompanies a 200; a failure body says the exchange did not happen.
    expect(failures).toMatch(/MUST NOT report at `POST` a state it could have reported at `GET`/)
    expect(failures).toMatch(/MUST\s+re-fetch discovery/)
  })
})

describe("what a client does with a failure", () => {
  it("classifies by an ordered rule rather than by three that collide", () => {
    // The order is normative: asserted separately, these rules contradicted one another.
    expect(failures).toMatch(/MUST classify a failure by the first of these that applies/)
    const ordered = failures.slice(failures.indexOf("by the first of these that applies"))
    expect(ordered.indexOf("1.")).toBeLessThan(ordered.indexOf("2."))
    expect(ordered.indexOf("2.")).toBeLessThan(ordered.indexOf("3."))
    expect(failures).toMatch(/MUST classify by status alone/)
    expect(failures).toMatch(/Otherwise the client MUST classify by `code`/)
  })

  it("binds a client and an endpoint to different schemas, and says which is which", () => {
    expect(failures).toMatch(/slip-error-response-endpoint\.schema\.json/)
    expect(failures).toMatch(/constrains `code` to the shape of a code and not to that list/)
  })

  it("never renders a body it could not read", () => {
    expect(failures).toMatch(/MUST NOT render any\s+part of it/)
  })

  it("treats a code it does not recognise as terminal, whatever the status says", () => {
    // The status carve-out matters: a 429 with an uninterpretable code could loop a client.
    expect(failures).toMatch(/does\s+not define is terminal/)
    expect(failures).toMatch(/A disagreeing status MUST NOT override this/)
  })

  it("blames a non-conforming endpoint for an unknown code, not a newer one", () => {
    // A later major is caught by the version check before any code is read.
    expect(failures).toMatch(/means a non-conforming endpoint, not a\s+newer one/)
  })

  it("bounds its retries, honours Retry-After, and has a floor without one", () => {
    // `Retry-After` is only a SHOULD, so without a floor the polite client and the hammering one are the same code.
    expect(failures).toMatch(/MUST wait at least the interval given by `Retry-After`/)
    expect(failures).toMatch(/at least one second where none is given/)
    expect(failures).toMatch(/Successive intervals MUST increase/)
    expect(failures).toMatch(/attempts MUST be bounded/)
  })

  it("requires the failure path to be readable cross-origin", () => {
    // CORS on the happy path alone means the browser withholds every failure body.
    expect(failures).toMatch(/MUST set\s*\n?`?Access-Control-Allow-Origin: \*`/)
    expect(failures).toMatch(/MUST NOT be cached/)
  })
})

describe("the CIP's cross-references", () => {
  it("points every internal link at a heading that exists", () => {
    // Both were prose deferrals in #15 and are links now; links rot as sections are renamed.
    const slug = (heading: string): string =>
      heading
        .toLowerCase()
        .replaceAll(/[^\w\s-]/g, "")
        .trim()
        .replaceAll(/\s+/g, "-")

    const present = new Set([...source.matchAll(/^#{2,4} (.+)$/gm)].map((match) => slug(match[1].trim())))
    const linked = [...source.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1])

    expect(linked.length).toBeGreaterThan(0)
    expect(linked.filter((target) => !present.has(target))).toEqual([])
  })

  it("defers nothing to a section that now exists", () => {
    // Matched verbatim on purpose: this guards the exact phrasing #15 left open.
    expect(source).not.toMatch(/specified with the error\s+taxonomy/)
  })
})

describe("protocol versioning", () => {
  it("carries a major version and nothing else", () => {
    expect(versioning).toMatch(/carries a major version and nothing else/)
    expect(versioning).toMatch(/There are no minor versions/)
  })

  it("makes the version the only compatibility signal", () => {
    expect(versioning).toMatch(/MUST NOT infer\s+what an endpoint supports from the presence or absence of any field/)
  })

  it("puts one major version behind one URL, with nothing to negotiate", () => {
    // Discovery must return the same bytes to a person, a crawler and a cache alike.
    expect(versioning).toMatch(/One URL speaks one major version/)
    // Scoped to the body: `Vary: Origin` is ordinary CORS practice.
    expect(versioning).toMatch(/MUST NOT vary the response body by request header/)
    expect(versioning).toMatch(/one\s+URL per\s+version/)
  })

  it("reads the version before validating anything else", () => {
    expect(versioning).toMatch(/MUST read `version` before validating/)
  })

  it("renders nothing and posts nothing from a major version it does not implement", () => {
    expect(versioning).toMatch(/MUST\s+fail with `UNSUPPORTED_VERSION`/)
    expect(versioning).toMatch(/MUST NOT render any part of the response/)
    expect(versioning).toMatch(/MUST NOT `POST`/)
  })

  it("names that refusal with a code the table defines", () => {
    expect(codeTable.map((entry) => entry.code)).toContain("UNSUPPORTED_VERSION")
  })

  it("declares the same version on every response shape", () => {
    const declared = ((schema["properties"] as Record<string, Record<string, unknown>>)["version"] ?? {})["pattern"]
    expect(declared).toBe("^[1-9][0-9]*$")
    expect((schema["required"] as Array<string>) ?? []).toContain("version")
  })
})
