import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Either } from "effect"
import { ArrayFormatter, TreeFormatter, type ParseError } from "effect/ParseResult"
import { describe, expect, it } from "vitest"

import { decodeSlip, PROTOCOL_VERSION, type Slip } from "../src/index.js"

/**
 * `decodeSlip` against the examples the CIP publishes. `valid/` must decode,
 * `invalid/schema/` must be rejected by the right member, and `invalid/rule/`
 * must decode — those break rules needing context no payload carries.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "get")

const fixtures = (bucket: string): Array<string> =>
  readdirSync(join(examples, bucket)).filter((file) => file.endsWith(".json"))

const fixture = (bucket: string, file: string): unknown =>
  JSON.parse(readFileSync(join(examples, bucket, file), "utf8"))

const issues = (error: ParseError): Array<{ tag: string; path: string }> =>
  ArrayFormatter.formatErrorSync(error).map((issue) => ({ tag: issue._tag, path: issue.path.join("/") }))

/** Naming the issue and the path: a payload rejected for the wrong reason would still pass "it failed". */
const rejections: ReadonlyArray<{ file: string; tag: string; path: string }> = [
  { file: "missing-title.json", tag: "Missing", path: "title" },
  { file: "unknown-network.json", tag: "Type", path: "network" },
  { file: "insecure-icon.json", tag: "Refinement", path: "icon" },
  { file: "undeclared-field.json", tag: "Unexpected", path: "amount" },
  { file: "disabled-without-reason.json", tag: "Refinement", path: "" },
  { file: "reason-without-disabled.json", tag: "Refinement", path: "" },
  { file: "too-many-actions.json", tag: "Refinement", path: "links/actions" },
  { file: "empty-actions.json", tag: "Refinement", path: "links/actions" },
  { file: "link-without-href.json", tag: "Missing", path: "links/actions/0/href" },
  { file: "unknown-parameter-type.json", tag: "Type", path: "links/actions/0/parameters/0/type" },
  { file: "select-without-options.json", tag: "Missing", path: "links/actions/0/parameters/0/options" },
  { file: "bounds-on-select.json", tag: "Unexpected", path: "links/actions/0/parameters/0/min" },
  { file: "options-on-number.json", tag: "Unexpected", path: "links/actions/0/parameters/0/options" }
]

describe("decoding the discovery response", () => {
  it.each(fixtures("valid"))("accepts %s", (file) => {
    const result = decodeSlip(fixture("valid", file))
    const failure = Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""
    expect(failure, failure).toBe("")
  })

  it.each(rejections)("rejects $file with $tag at '$path'", ({ file, tag, path }) => {
    const result = decodeSlip(fixture("invalid/schema", file))
    expect(Either.isLeft(result), `${file} was accepted`).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag, path })
    }
  })

  it("records what every rejection example demonstrates", () => {
    expect([...rejections.map((rejection) => rejection.file)].sort()).toEqual(fixtures("invalid/schema").sort())
  })

  it.each(fixtures("invalid/rule"))("decodes %s, whose rule no schema can see", (file) => {
    // The checks arrive with URL resolution and parameter interpolation.
    const result = decodeSlip(fixture("invalid/rule", file))
    const failure = Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""
    expect(failure, failure).toBe("")
  })
})

describe("what the decoder refuses on its own account", () => {
  const payment = fixture("valid", "payment.json") as Record<string, unknown>

  it("rejects an undeclared member however deeply it is buried", () => {
    const result = decodeSlip({
      ...payment,
      links: { actions: [{ label: "Pay", href: "/api/slips/pay", surprise: true }] }
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag: "Unexpected", path: "links/actions/0/surprise" })
    }
  })

  it("reports every fault at once rather than one per round trip", () => {
    const result = decodeSlip({ ...payment, title: "", network: "testnet", icon: "http://x.example/i.png" })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      const paths = new Set(issues(result.left).map((issue) => issue.path))
      expect([...paths].sort()).toEqual(["icon", "network", "title"])
    }
  })

  it("reads a version it does not implement rather than calling it malformed", () => {
    // `UNSUPPORTED_VERSION` has to stay distinguishable from `MALFORMED_RESPONSE`.
    const result = decodeSlip({ ...payment, version: "2" })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.version).not.toBe(PROTOCOL_VERSION)
    }
  })

  it("rejects a version that is not a major", () => {
    for (const version of ["1.0", "0", "01", "v1", ""]) {
      expect(Either.isLeft(decodeSlip({ ...payment, version })), version).toBe(true)
    }
  })
})

describe("the types a producer and a consumer share", () => {
  it("narrows a parameter by its type", () => {
    const slip = Either.getOrThrow(decodeSlip(fixture("valid", "open-contribution.json"))) satisfies Slip
    const parameters = slip.links?.actions[2]?.parameters ?? []
    const select = parameters.find((parameter) => parameter.type === "select")
    expect(select?.options.map((option) => option.value)).toEqual(["usdm", "usdcx"])

    const amount = parameters.find((parameter) => parameter.type === "number")
    expect(amount?.max).toBe(500)
  })
})
