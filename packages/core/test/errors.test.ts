import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Either } from "effect"
import { ArrayFormatter, TreeFormatter, type ParseError } from "effect/ParseResult"
import { describe, expect, it } from "vitest"

import {
  classifyErrorCode,
  classifyStatus,
  decodeEndpointError,
  decodeSlipError,
  endpointErrorStatus,
  errorCodeClass,
  isSlipErrorCode,
  type SlipErrorClass,
  type SlipErrorCode
} from "../src/index.js"

/**
 * The schemas run against `spec/examples/error`, and the code table compared
 * against the one in the CIP — a class or status copied wrong decides whether a
 * client retries a failure it should have stopped on.
 */

const root = join(import.meta.dirname, "..", "..", "..")
const examples = join(root, "spec", "examples", "error")

const fixtures = (bucket: string): Array<string> =>
  readdirSync(join(examples, bucket)).filter((file) => file.endsWith(".json"))

const fixture = (bucket: string, file: string): unknown =>
  JSON.parse(readFileSync(join(examples, bucket, file), "utf8"))

const issues = (error: ParseError): Array<{ tag: string; path: string }> =>
  ArrayFormatter.formatErrorSync(error).map((issue) => ({ tag: issue._tag, path: issue.path.join("/") }))

const accepted = (result: Either.Either<unknown, ParseError>): string =>
  Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""

/** `—` in the status column marks a code an endpoint may not send. */
type SpecifiedCode = {
  code: string
  class: SlipErrorClass
  status: number | undefined
  raisedBy: Array<string>
}

const specifiedCodes: ReadonlyArray<SpecifiedCode> = readFileSync(join(root, "spec", "CIP-XXXX", "README.md"), "utf8")
  .split("\n")
  .flatMap((line) => {
    const row = /^\| `([A-Z_]+)` \| (request|terminal|transient) \| (\d{3}|—) \| ([^|]+) \|/.exec(line)
    if (row === null) return []
    return [
      {
        code: row[1]!,
        class: row[2] as SlipErrorClass,
        status: row[3] === "—" ? undefined : Number(row[3]),
        raisedBy: row[4]!.split(",").map((who) => who.trim())
      }
    ]
  })

const endpointCodes = specifiedCodes.filter((row) => row.raisedBy.includes("endpoint"))
const clientOnlyCodes = specifiedCodes.filter((row) => !row.raisedBy.includes("endpoint"))

describe("the code vocabulary", () => {
  it("found the table in the specification", () => {
    // Without this, a reformatted table turns every assertion below into a
    // comparison against an empty list and the suite goes green having read nothing.
    expect(specifiedCodes.length).toBeGreaterThan(10)
    expect(endpointCodes.length).toBe(8)
  })

  it("classifies every code exactly as the specification does", () => {
    const specified = Object.fromEntries(specifiedCodes.map((row) => [row.code, row.class]))
    expect(errorCodeClass).toEqual(specified)
  })

  it("pairs every endpoint code with the status the specification gives it", () => {
    const specified = Object.fromEntries(endpointCodes.map((row) => [row.code, row.status]))
    expect(endpointErrorStatus).toEqual(specified)
  })

  it("knows every specified code and nothing else", () => {
    for (const row of specifiedCodes) expect(isSlipErrorCode(row.code), row.code).toBe(true)
    for (const invented of ["SOMETHING_ELSE", "toString", "constructor", ""]) {
      expect(isSlipErrorCode(invented), invented).toBe(false)
    }
  })
})

describe("classifying a failure", () => {
  it("gives every defined code its own class", () => {
    for (const row of specifiedCodes) {
      expect(classifyErrorCode(row.code), row.code).toBe(row.class)
    }
  })

  it("treats a code it does not define as terminal", () => {
    expect(classifyErrorCode("INVENTED_CODE")).toBe("terminal")
  })

  it("is not fooled by a name inherited from Object", () => {
    expect(classifyErrorCode("constructor")).toBe("terminal")
    expect(classifyErrorCode("__proto__")).toBe("terminal")
  })

  it("judges an unreadable body by its status alone", () => {
    expect(classifyStatus(429)).toBe("transient")
    expect(classifyStatus(500)).toBe("transient")
    expect(classifyStatus(502)).toBe("transient")
    expect(classifyStatus(400)).toBe("terminal")
    expect(classifyStatus(404)).toBe("terminal")
    expect(classifyStatus(410)).toBe("terminal")
  })
})

describe("decoding a failure body", () => {
  it.each(fixtures("valid"))("accepts %s from an endpoint and at a client", (file) => {
    const payload = fixture("valid", file)
    expect(accepted(decodeEndpointError(payload)), file).toBe("")
    expect(accepted(decodeSlipError(payload)), file).toBe("")
  })

  it("covers every code an endpoint may send with an example", () => {
    const covered = fixtures("valid")
      .map((file) => (fixture("valid", file) as { code: string }).code)
      .sort()
    expect(covered).toEqual([...endpointCodes.map((row) => row.code)].sort())
  })

  it.each(fixtures("invalid/schema"))("refuses to let an endpoint send %s", (file) => {
    expect(Either.isLeft(decodeEndpointError(fixture("invalid/schema", file))), file).toBe(true)
  })

  it.each(fixtures("invalid/rule"))("accepts %s, whose rule is about what the message says", (file) => {
    // Why `message` cannot be an exception's `.message` piped to the wire.
    expect(accepted(decodeEndpointError(fixture("invalid/rule", file))), file).toBe("")
  })
})

describe("the split between what an endpoint may send and what a client may read", () => {
  const stillReadable = ["client-code-on-the-wire.json", "unknown-code.json"]

  it.each(stillReadable)("reads %s even though no endpoint may send it", (file) => {
    const payload = fixture("invalid/schema", file)
    expect(Either.isLeft(decodeEndpointError(payload))).toBe(true)
    expect(accepted(decodeSlipError(payload)), file).toBe("")
  })

  it("classifies both by their code, and keeps the publisher's message", () => {
    // Both codes are in the spec's table; what makes them non-conforming is the
    // direction of travel, not the value. A client still reads and classifies them.
    const classes = stillReadable.map((file) => {
      const body = Either.getOrThrow(decodeSlipError(fixture("invalid/schema", file)))
      expect(body.message.length, file).toBeGreaterThan(0)
      return classifyErrorCode(body.code)
    })
    expect(classes).toEqual(["transient", "request"])
  })

  it("rejects the structurally broken ones at a client too", () => {
    const broken = fixtures("invalid/schema").filter((file) => !stillReadable.includes(file))
    for (const file of broken) {
      expect(Either.isLeft(decodeSlipError(fixture("invalid/schema", file))), file).toBe(true)
    }
    expect(broken.length).toBeGreaterThan(0)
  })

  it("turns away every client-only code at the endpoint boundary", () => {
    for (const row of clientOnlyCodes) {
      const body = { type: "error", version: "1", code: row.code, message: "Something went wrong." }
      expect(Either.isLeft(decodeEndpointError(body)), row.code).toBe(true)
      expect(accepted(decodeSlipError(body)), row.code).toBe("")
    }
    expect(clientOnlyCodes.length).toBeGreaterThan(0)
  })
})

describe("what the failure schema refuses on its own account", () => {
  const base = { type: "error", version: "1", code: "INVALID_PARAMETER", message: "Pick a smaller amount." }

  it("attaches field only to the code that rejected a submitted value", () => {
    expect(accepted(decodeEndpointError({ ...base, field: "amount" }))).toBe("")

    const misplaced = decodeEndpointError({ ...base, code: "RATE_LIMITED", field: "amount" })
    expect(Either.isLeft(misplaced)).toBe(true)
    if (Either.isLeft(misplaced)) {
      expect(issues(misplaced.left)).toContainEqual({ tag: "Refinement", path: "" })
    }
  })

  it("rejects an undeclared member", () => {
    // `Retry-After` is a header HTTP already defines; mirroring it here would be two sources for one fact.
    const result = decodeEndpointError({ ...base, retryAfter: 30 })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag: "Unexpected", path: "retryAfter" })
    }
  })

  it("rejects a message that could not have been written for a person", () => {
    expect(Either.isLeft(decodeEndpointError({ ...base, message: "" }))).toBe(true)
    expect(Either.isLeft(decodeEndpointError({ ...base, message: "x".repeat(301) }))).toBe(true)
  })

  it("keeps a failure distinguishable from the shapes success returns", () => {
    const result = decodeSlipError({ ...base, type: "slip" })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag: "Type", path: "type" })
    }
  })

  it("types a decoded code as something classifiable", () => {
    const body = Either.getOrThrow(decodeEndpointError(base))
    const code: SlipErrorCode = body.code
    expect(errorCodeClass[code]).toBe("request")
  })
})
