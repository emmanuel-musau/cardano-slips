import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
// Named, not default: ajv is CommonJS and its default export only resolves to
// the class under `esModuleInterop`, which the base tsconfig does not enable.
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

/**
 * The POST build contract and the partial intent (#17) — the shape the mismatch
 * gate is held to, so a field that can express a quantity ambiguously is a hole
 * in the gate rather than a documentation defect.
 *
 * Three properties carry the weight: quantities are integer base units in
 * decimal strings; the endpoint declares only what it chooses, never what the
 * ledger or wallet determines; and nothing about the person travels except one
 * address they chose.
 */

const root = join(import.meta.dirname, "..")
const specPath = join(root, "spec", "CIP-XXXX", "README.md")
const schemas = join(root, "spec", "CIP-XXXX", "schemas")

const source = readFileSync(specPath, "utf8")
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

const requestSchema = readJson(join(schemas, "slip-post-request.schema.json")) as Record<string, unknown>
const intentSchema = readJson(join(schemas, "slip-partial-intent.schema.json")) as Record<string, unknown>
const discoverySchema = readJson(join(schemas, "slip-get-response.schema.json")) as Record<string, unknown>

/** See the note in spec-get-discovery.test.ts for why strictRequired is off. */
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true })
const validateRequest: ValidateFunction = ajv.compile(requestSchema)
const validateIntent: ValidateFunction = ajv.compile(intentSchema)

/** One example shape: its directory, its schema, and the validator over it. */
type Shape = {
  readonly dir: string
  readonly validate: ValidateFunction
}

const build: Shape = { dir: "build-request", validate: validateRequest }
const partial: Shape = { dir: "partial", validate: validateIntent }

const fixtures = (shape: Shape, bucket: string): Array<string> =>
  readdirSync(join(root, "spec", "examples", shape.dir, bucket)).filter((file) => file.endsWith(".json"))

const fixture = (shape: Shape, bucket: string, file: string): unknown =>
  readJson(join(root, "spec", "examples", shape.dir, bucket, file))

const errorsFor = (shape: Shape, payload: unknown): Array<ErrorObject> => {
  shape.validate(payload)
  return [...(shape.validate.errors ?? [])]
}

/** One rejection the schema itself must produce, and where. */
type Rejection = {
  readonly file: string
  readonly keyword: string
  readonly instancePath: string
  readonly param?: string
}

/**
 * The unspent-outputs body is first on purpose: the one payload this protocol
 * exists to make unsendable, refused by the same keyword as any undeclared
 * member. The privacy property is structural, not a rule someone remembered.
 */
const requestRejections: ReadonlyArray<Rejection> = [
  { file: "utxos-in-the-body.json", keyword: "additionalProperties", instancePath: "", param: "utxos" },
  { file: "missing-network.json", keyword: "required", instancePath: "", param: "network" },
  { file: "unknown-network.json", keyword: "enum", instancePath: "/network" },
  { file: "not-an-address.json", keyword: "pattern", instancePath: "/changeAddress" },
  { file: "stake-address-as-change.json", keyword: "pattern", instancePath: "/changeAddress" }
]

const intentRejections: ReadonlyArray<Rejection> = [
  { file: "wrong-type.json", keyword: "const", instancePath: "/type" },
  { file: "missing-intent.json", keyword: "required", instancePath: "", param: "intent" },
  { file: "undeclared-field.json", keyword: "additionalProperties", instancePath: "", param: "fee" },
  { file: "decimal-quantity.json", keyword: "pattern", instancePath: "/intent/outputs/0/lovelace" },
  { file: "numeric-quantity.json", keyword: "type", instancePath: "/intent/outputs/0/lovelace" },
  { file: "negative-quantity.json", keyword: "pattern", instancePath: "/intent/outputs/0/lovelace" },
  { file: "zero-asset-quantity.json", keyword: "pattern", instancePath: "/intent/outputs/0/assets/0/quantity" },
  { file: "asset-name-not-hex.json", keyword: "pattern", instancePath: "/intent/outputs/0/assets/0/assetName" },
  { file: "nothing-to-do.json", keyword: "anyOf", instancePath: "/intent" },
  { file: "missing-valid-until.json", keyword: "required", instancePath: "/intent", param: "validUntil" },
  { file: "local-time.json", keyword: "pattern", instancePath: "/intent/validUntil" },
  { file: "deposit-declared.json", keyword: "additionalProperties", instancePath: "/intent/certificates/0" },
  { file: "unknown-certificate.json", keyword: "enum", instancePath: "/intent/certificates/0/type" },
  {
    file: "delegation-without-pool.json",
    keyword: "required",
    instancePath: "/intent/certificates/0",
    param: "poolId"
  },
  { file: "pool-on-registration.json", keyword: "not", instancePath: "/intent/certificates/0" },
  { file: "message-too-long.json", keyword: "maxLength", instancePath: "/message" }
]

/** Rules needing the wall clock, the declared network, or a judgement about what a value says. */
const requestRuleRejections: ReadonlyArray<{ readonly file: string; readonly rule: RegExp }> = [
  { file: "address-network-disagrees.json", rule: /the network its own address encodes/ }
]

const intentRuleRejections: ReadonlyArray<{ readonly file: string; readonly rule: RegExp }> = [
  { file: "already-expired.json", rule: /`validUntil` that has already\s+passed/ },
  { file: "output-on-wrong-network.json", rule: /[Ee]very address in the intent MUST encode the Slip's own network/ },
  { file: "duplicate-asset.json", rule: /MUST NOT name the same asset twice/ },
  { file: "internal-detail-in-message.json", rule: /MUST NOT carry internal detail/ }
]

describe("the build request", () => {
  it("accepts every payload the examples say is conforming", () => {
    const rejected = fixtures(build, "valid")
      .map((file) => ({ file, errors: errorsFor(build, fixture(build, "valid", file)) }))
      .filter(({ errors }) => errors.length > 0)
      .map(({ file, errors }) => `${file}: ${ajv.errorsText(errors)}`)
    expect(rejected).toEqual([])
  })

  it.each(requestRejections)("rejects $file at $instancePath on $keyword", ({ file, keyword, instancePath, param }) => {
    const errors = errorsFor(build, fixture(build, "invalid/schema", file))
    const matched = errors.filter((error) => error.keyword === keyword && error.instancePath === instancePath)
    expect(matched.length, `expected ${keyword} at "${instancePath}", got ${ajv.errorsText(errors)}`).toBeGreaterThan(0)

    if (param !== undefined) {
      const named = matched.some((error) => Object.values(error.params ?? {}).includes(param))
      expect(named, `expected ${keyword} to name "${param}"`).toBe(true)
    }
  })

  it("asks for two fields and nothing that describes the person", () => {
    // The whole privacy claim in one assertion: a third field here is where it would start leaking.
    expect(Object.keys(requestSchema["properties"] as Record<string, unknown>).sort()).toEqual([
      "changeAddress",
      "network"
    ])
    expect(requestSchema["additionalProperties"]).toBe(false)
  })

  it("carries no version, because the URL already fixes it", () => {
    // ADR-0009: one URL speaks one major version, and there is nothing to
    // negotiate. A version in the request would be the start of negotiation.
    expect(requestSchema["properties"]).not.toHaveProperty("version")
  })

  it("covers every fixture on disk", () => {
    expect(fixtures(build, "invalid/schema").sort()).toEqual(requestRejections.map((r) => r.file).sort())
    expect(fixtures(build, "invalid/rule").sort()).toEqual(requestRuleRejections.map((r) => r.file).sort())
    expect(fixtures(build, "valid").length).toBeGreaterThan(0)
  })
})

describe("the partial intent", () => {
  it("accepts every payload the examples say is conforming", () => {
    const rejected = fixtures(partial, "valid")
      .map((file) => ({ file, errors: errorsFor(partial, fixture(partial, "valid", file)) }))
      .filter(({ errors }) => errors.length > 0)
      .map(({ file, errors }) => `${file}: ${ajv.errorsText(errors)}`)
    expect(rejected).toEqual([])
  })

  it.each(intentRejections)("rejects $file at $instancePath on $keyword", ({ file, keyword, instancePath, param }) => {
    const errors = errorsFor(partial, fixture(partial, "invalid/schema", file))
    const matched = errors.filter((error) => error.keyword === keyword && error.instancePath === instancePath)
    expect(matched.length, `expected ${keyword} at "${instancePath}", got ${ajv.errorsText(errors)}`).toBeGreaterThan(0)

    if (param !== undefined) {
      const named = matched.some((error) => Object.values(error.params ?? {}).includes(param))
      expect(named, `expected ${keyword} to name "${param}"`).toBe(true)
    }
  })

  it("covers every fixture on disk", () => {
    expect(fixtures(partial, "invalid/schema").sort()).toEqual(intentRejections.map((r) => r.file).sort())
    expect(fixtures(partial, "invalid/rule").sort()).toEqual(intentRuleRejections.map((r) => r.file).sort())
    expect(fixtures(partial, "valid").length).toBeGreaterThan(0)
  })

  it("discriminates itself from every other shape with type partial", () => {
    const properties = intentSchema["properties"] as Record<string, Record<string, unknown>>
    expect(properties["type"]?.["const"]).toBe("partial")
    for (const file of fixtures(partial, "valid")) {
      expect((fixture(partial, "valid", file) as { type?: string }).type, `${file}`).toBe("partial")
    }
  })

  it("does something on chain, or is not an intent", () => {
    // Otherwise the intent asks a person to pay a fee for nothing.
    const intent = (intentSchema["$defs"] as Record<string, Record<string, unknown>>)["intent"]
    const alternatives = (intent["anyOf"] as Array<{ required?: Array<string> }>).flatMap((one) => one.required ?? [])
    expect(alternatives.sort()).toEqual(["certificates", "outputs", "withdrawRewards"])
  })
})

describe("quantities", () => {
  const quantities = (payload: unknown): Array<[string, unknown]> => {
    const found: Array<[string, unknown]> = []
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((item, index) => walk(item, `${path}/${index}`))
      if (node === null || typeof node !== "object") return
      for (const [key, value] of Object.entries(node)) {
        if (["lovelace", "quantity"].includes(key)) found.push([`${path}/${key}`, value])
        walk(value, `${path}/${key}`)
      }
    }
    walk(payload, "")
    return found
  }

  it("are integer base units in decimal strings, everywhere in the examples", () => {
    // 9007199254740993 lovelace does not survive a double, and "12.5" is not a quantity of anything.
    const offenders: Array<string> = []
    for (const file of fixtures(partial, "valid")) {
      for (const [path, value] of quantities(fixture(partial, "valid", file))) {
        if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
          offenders.push(`${file}${path}: ${JSON.stringify(value)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("carry no decimals field for a publisher to set", () => {
    // Otherwise an endpoint shows 1200 base units as "0.0012" while the gate compares 1200 against 1200 and passes.
    expect(JSON.stringify(intentSchema)).not.toMatch(/"decimals"/)
    expect(source).toMatch(/MUST NOT infer\s+decimals/)
  })
})

describe("what an endpoint may not declare", () => {
  const defs = intentSchema["$defs"] as Record<string, Record<string, unknown>>

  it("gives a certificate no field for a deposit the protocol already fixes", () => {
    // A declared deposit is either right and redundant or wrong and fatal:
    // the ledger takes the parameter value whatever the endpoint said.
    const properties = Object.keys(defs["certificate"]["properties"] as Record<string, unknown>)
    expect(properties).not.toContain("deposit")
    expect(properties).not.toContain("refund")
  })

  it("gives a certificate no field for the stake credential it acts on", () => {
    // The endpoint has one address and no business naming the person's own
    // credential back at them. The client supplies it, so no lie fits here.
    const properties = Object.keys(defs["certificate"]["properties"] as Record<string, unknown>)
    expect(properties).not.toContain("rewardAddress")
    expect(properties).not.toContain("stakeCredential")
  })

  it("declares a withdrawal without an amount only the client can know", () => {
    // A reward withdrawal must take the entire balance. The endpoint never
    // sees it, so the only honest declaration is that one happens at all.
    const intent = defs["intent"]["properties"] as Record<string, Record<string, unknown>>
    expect(intent["withdrawRewards"]?.["type"]).toBe("boolean")
  })

  it("gives an endpoint no way to ask for a required signer", () => {
    // Dropped from version 1: no script runs in a Mode A transaction, so nothing
    // could read the signers a publisher named. Pinned against a future sweep
    // adding it back as an oversight.
    expect(Object.keys(defs["intent"]["properties"] as Record<string, unknown>)).not.toContain("requiredSigners")
    expect(defs).not.toHaveProperty("signerRole")
    expect(source).toMatch(/Required signers, and why there are none/)
    expect(source).toMatch(/nothing could read them/)
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

/** Every markdown table in a section, as rows of trimmed cells. */
const tables = (text: string): Array<Array<Array<string>>> => {
  const found: Array<Array<Array<string>>> = []
  let current: Array<Array<string>> | undefined

  for (const line of text.split("\n")) {
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
      if (current === undefined) {
        current = []
        found.push(current)
      }
      current.push(cells)
    } else {
      current = undefined
    }
  }

  // Drop the header row and the alignment row from each.
  return found.map((table) => table.slice(2))
}

const fieldTable = (heading: string, level: number, index: number): Array<{ name: string; required: boolean }> => {
  const found = tables(slice(heading, level))
  expect(found.length, `fewer than ${index + 1} tables under "${heading}"`).toBeGreaterThan(index)
  return found[index].map(([name, required]) => ({
    name: (name ?? "").replaceAll("`", ""),
    required: required === "yes"
  }))
}

const properties = (
  schema: Record<string, unknown>,
  path: ReadonlyArray<string>
): { keys: Array<string>; required: Array<string> } => {
  const node = path.reduce<Record<string, unknown>>((acc, key) => acc[key] as Record<string, unknown>, schema)
  return {
    keys: Object.keys(node["properties"] as Record<string, unknown>),
    required: ((node["required"] as Array<string>) ?? []).slice()
  }
}

describe("the CIP text and the schemas", () => {
  const documented: ReadonlyArray<{
    readonly heading: string
    readonly level: number
    readonly index: number
    readonly schema: Record<string, unknown>
    readonly path: ReadonlyArray<string>
  }> = [
    { heading: "Building the transaction", level: 3, index: 0, schema: requestSchema, path: [] },
    { heading: "The partial intent", level: 3, index: 0, schema: intentSchema, path: [] },
    { heading: "The partial intent", level: 3, index: 1, schema: intentSchema, path: ["$defs", "intent"] },
    { heading: "Outputs", level: 4, index: 0, schema: intentSchema, path: ["$defs", "output"] },
    { heading: "Outputs", level: 4, index: 1, schema: intentSchema, path: ["$defs", "asset"] },
    { heading: "Certificates", level: 4, index: 0, schema: intentSchema, path: ["$defs", "certificate"] }
  ]

  it.each(documented)("documents exactly the fields the schema defines for $heading table $index", (entry) => {
    const table = fieldTable(entry.heading, entry.level, entry.index)
    expect(table.map((row) => row.name).sort()).toEqual(properties(entry.schema, entry.path).keys.sort())
  })

  it.each(documented)("agrees with the schema about what is required in $heading table $index", (entry) => {
    const table = fieldTable(entry.heading, entry.level, entry.index)
    expect(
      table
        .filter((row) => row.required)
        .map((row) => row.name)
        .sort()
    ).toEqual(properties(entry.schema, entry.path).required.sort())
  })

  it("illustrates the request with a body from the examples", () => {
    // No `type` to name it by, so it travels in an ```http block — held to the examples all the same.
    const bodies = [...source.matchAll(/```http\nPOST[\s\S]*?\n\n(\{[\s\S]*?)\n```/g)].map(
      (match) => JSON.parse(match[1]) as unknown
    )
    expect(bodies.length).toBeGreaterThan(0)

    const held = fixtures(build, "valid").map((file) => fixture(build, "valid", file))
    for (const body of bodies) {
      expect(errorsFor(build, body), `a request example in the CIP fails its own schema`).toEqual([])
      expect(held, `a request example in the CIP is not in the examples`).toContainEqual(body)
    }
  })
})

describe("the rules the schemas cannot express", () => {
  const rules = [
    ...requestRuleRejections.map((entry) => ({ ...entry, shape: build })),
    ...intentRuleRejections.map((entry) => ({ ...entry, shape: partial }))
  ]

  it.each(rules)("$file passes validation, so the rule must live in the client", ({ file, shape }) => {
    expect(errorsFor(shape, fixture(shape, "invalid/rule", file))).toEqual([])
  })

  it.each(rules)("$file has its rule stated normatively in the CIP", ({ rule }) => {
    expect(rule.test(source)).toBe(true)
  })
})

describe("the obligations this step puts on both parties", () => {
  const building = slice("Building the transaction", 3)
  const balancing = slice("Balancing", 3)

  it("keeps the user's unspent outputs off the wire, normatively", () => {
    // The invariant the whole mode exists for. It is a sentence in the spec,
    // a closed schema above, and hard invariant 2 in CLAUDE.md.
    expect(balancing).toMatch(/MUST NOT (?:send|transmit)[^.]*unspent outputs/)
  })

  it("requires the endpoint to answer a preflight", () => {
    // A JSON body makes POST non-simple, so every client request is preceded
    // by an OPTIONS the publisher must answer or the browser never sends it.
    expect(building).toMatch(/OPTIONS/)
    expect(building).toMatch(/Access-Control-Allow-Methods/)
    expect(building).toMatch(/Access-Control-Allow-Headers/)
  })

  it("makes the three statements of network agree, or fail", () => {
    expect(building).toMatch(/WRONG_NETWORK/)
    expect(building).toMatch(/the network its own address encodes/)
  })

  it("forbids caching a transaction built for one person", () => {
    expect(building).toMatch(/no-store/)
  })

  it("treats declared lovelace as a floor the client may have to raise", () => {
    // Without this an asset-only output is unbuildable, and #19's gate would
    // block every legitimate token payment as a mismatch.
    expect(source).toMatch(/MUST raise it to the minimum/)
    expect(source).toMatch(/as an effect of its own/)
  })

  it("caps the transaction's validity by the intent's own deadline", () => {
    expect(balancing).toMatch(/MUST NOT set a validity interval ending after `validUntil`/)
  })
})

describe("build modes", () => {
  it("reserves the field a server-balanced Slip would declare", () => {
    // Reserving it in words alone would not do: a client MUST reject an undefined
    // member, so Mode B would cost a major version it should not.
    const declared = (discoverySchema["properties"] as Record<string, Record<string, unknown>>)["build"]
    expect(declared).toBeDefined()
    expect((discoverySchema["$defs"] as Record<string, Record<string, unknown>>)["buildMode"]["enum"]).toEqual([
      "local",
      "server"
    ])
    expect((discoverySchema["required"] as Array<string>) ?? []).not.toContain("build")
  })

  it("refuses to post to one, in this version, with a code of its own", () => {
    expect(source).toMatch(/UNSUPPORTED_BUILD_MODE/)
    expect(source).toMatch(/MUST NOT `POST` to a Slip declaring `build: "server"`/)
  })
})
