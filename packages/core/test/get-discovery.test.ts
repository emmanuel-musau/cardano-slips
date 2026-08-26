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

describe("metadata built to get past a reader", () => {
  const payment = fixture("valid", "payment.json") as Record<string, unknown>

  const withAction = (action: unknown): unknown => ({ ...payment, links: { actions: [action] } })

  it("refuses a member named after something on Object's prototype", () => {
    // `JSON.parse` makes `__proto__` an own property, so it arrives as a member like any other.
    for (const name of ["__proto__", "constructor", "toString"]) {
      const hostile = JSON.parse(`{"${name}": {"admin": true}}`) as Record<string, unknown>
      expect(Object.keys(hostile), name).toContain(name)
      expect(issues(Either.getOrThrow(Either.flip(decodeSlip({ ...payment, ...hostile }))))).toContainEqual({
        tag: "Unexpected",
        path: name
      })
    }
  })

  it("closes a linked action with no reason, and gives a reason with nothing closed", () => {
    const closed = withAction({ label: "Pay", href: "/api/slips/pay", disabled: true })
    const stray = withAction({ label: "Pay", href: "/api/slips/pay", reason: { message: "Sold out" } })
    expect(issues(Either.getOrThrow(Either.flip(decodeSlip(closed))))).toContainEqual({
      tag: "Refinement",
      path: "links/actions/0"
    })
    expect(issues(Either.getOrThrow(Either.flip(decodeSlip(stray))))).toContainEqual({
      tag: "Refinement",
      path: "links/actions/0"
    })
  })

  it("bounds a form at eight fields and a select at twenty options", () => {
    const parameters = Array.from({ length: 9 }, (_, index) => ({
      name: `p${index}`,
      label: "Field",
      type: "text"
    }))
    const many = withAction({ label: "Pay", href: "/api/slips/pay", parameters })
    expect(issues(Either.getOrThrow(Either.flip(decodeSlip(many))))).toContainEqual({
      tag: "Refinement",
      path: "links/actions/0/parameters"
    })

    const options = Array.from({ length: 21 }, (_, index) => ({ label: `O${index}`, value: `${index}` }))
    const wide = withAction({
      label: "Pay",
      href: "/api/slips/pay",
      parameters: [{ name: "p", label: "Pick", type: "select", options }]
    })
    expect(issues(Either.getOrThrow(Either.flip(decodeSlip(wide))))).toContainEqual({
      tag: "Refinement",
      path: "links/actions/0/parameters/0/options"
    })
  })

  it("bounds every string the card renders", () => {
    // A response with no ceiling is a card that never finishes drawing.
    const overlong: ReadonlyArray<[string, unknown]> = [
      ["title", "t".repeat(121)],
      ["description", "d".repeat(501)],
      ["label", "l".repeat(49)],
      ["icon", `https://linktap.example/${"i".repeat(2049)}.png`]
    ]
    for (const [field, value] of overlong) {
      expect(Either.isLeft(decodeSlip({ ...payment, [field]: value })), field).toBe(true)
    }
  })

  it("refuses an icon that is not fetchable over https", () => {
    for (const icon of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "http://linktap.example/i.png",
      "//linktap.example/i.png",
      "https://linktap.example/i con.png"
    ]) {
      expect(Either.isLeft(decodeSlip({ ...payment, icon })), icon).toBe(true)
    }
  })

  it("refuses an href that is neither path-absolute nor an absolute https URL", () => {
    for (const href of ["api/slips/pay", "http://linktap.example/api", "/api slips/pay", ""]) {
      expect(Either.isLeft(decodeSlip(withAction({ label: "Pay", href }))), JSON.stringify(href)).toBe(true)
    }
  })

  it("refuses a parameter name a placeholder could not spell", () => {
    for (const name of ["9amount", "_amount", "amount-2", "amount.2", "", "a".repeat(33)]) {
      const named = withAction({
        label: "Pay",
        href: "/api/slips/pay",
        parameters: [{ name, label: "Amount", type: "number" }]
      })
      expect(Either.isLeft(decodeSlip(named)), JSON.stringify(name)).toBe(true)
    }
  })

  it("reads a title carrying markup, because rendering it as text is the client's rule", () => {
    // Nothing about the string is malformed; a client that ran it would be the defect.
    const scripted = decodeSlip({ ...payment, title: "<script>alert(1)</script>" })
    expect(Either.isRight(scripted)).toBe(true)
  })
})
