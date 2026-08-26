import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  checkTemplates,
  checkValues,
  decodeSlip,
  fillHref,
  fillLabel,
  placeholdersIn,
  type LinkedAction,
  type Parameter,
  type Slip,
  type TemplateDefect
} from "../src/index.js"

/**
 * The three rules the discovery decoder defers, now that the discovery URL and
 * the collected values are in hand — the four `get/invalid/rule/` payloads are
 * rejected here, and nowhere earlier.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "get")

const fixtures = (bucket: string): Array<string> =>
  readdirSync(join(examples, bucket)).filter((file) => file.endsWith(".json"))

const slip = (bucket: string, file: string): Slip =>
  Either.getOrThrow(decodeSlip(JSON.parse(readFileSync(join(examples, bucket, file), "utf8"))))

const discovery = "https://fund.linktap.example/api/slips/fund/community"

const tags = (defects: ReadonlyArray<TemplateDefect>): Array<string> => defects.map((defect) => defect._tag)

describe("checking a Slip against its discovery URL", () => {
  it.each(fixtures("valid"))("finds nothing wrong with %s", (file) => {
    expect(checkTemplates(slip("valid", file), discovery)).toEqual([])
  })

  it("rejects an href that leaves the discovery origin", () => {
    expect(tags(checkTemplates(slip("invalid/rule", "cross-origin-href.json"), discovery))).toEqual(["CrossOriginHref"])
  })

  it("rejects a placeholder no parameter fills", () => {
    const defects = checkTemplates(slip("invalid/rule", "undeclared-placeholder.json"), discovery)
    expect(defects).toContainEqual({ _tag: "UndeclaredPlaceholder", action: 0, name: "amount" })
  })

  it("rejects a parameter no placeholder references", () => {
    // A collected value that reaches nothing is a defect in the endpoint.
    const defects = checkTemplates(slip("invalid/rule", "unfilled-placeholder-parameter.json"), discovery)
    expect(defects).toContainEqual({ _tag: "UnreferencedParameter", action: 0, name: "amount" })
  })

  it("rejects bounds that cannot both be met", () => {
    const defects = checkTemplates(slip("invalid/rule", "bounds-reversed.json"), discovery)
    expect(defects).toContainEqual({ _tag: "BoundsReversed", action: 0, name: "amount" })
  })

  it("covers every rule example the discovery decoder let through", () => {
    // A file here that produced no defect would be a rule stated in the CIP and enforced nowhere.
    for (const file of fixtures("invalid/rule")) {
      expect(checkTemplates(slip("invalid/rule", file), discovery).length, file).toBeGreaterThan(0)
    }
  })

  it("names the action a defect is in, so a card with three can say which", () => {
    const payload = slip("valid", "open-contribution.json")
    const elsewhere = { ...payload.links!.actions[0]!, href: "https://build.example.net/tx" }
    const moved: Slip = { ...payload, links: { actions: [payload.links!.actions[0]!, elsewhere] } }
    expect(checkTemplates(moved, discovery)).toEqual([
      { _tag: "CrossOriginHref", action: 1, href: "https://build.example.net/tx" }
    ])
  })

  it("cannot make a path-absolute href cross-origin, whatever the discovery URL is", () => {
    // Which is why the grammar admits one at all: it resolves where it was served from.
    const payload = slip("valid", "open-contribution.json")
    for (const origin of ["https://fund.linktap.example/x", "https://other.example/y", "https://a.b.c/d/e"]) {
      expect(checkTemplates(payload, origin), origin).toEqual([])
    }
  })

  it("treats braces as never literal", () => {
    expect(placeholdersIn("Contribute {amount} {token}")).toEqual(["amount", "token"])
    expect(placeholdersIn("/api/x?a={a}&b=2")).toEqual(["a"])
    expect(placeholdersIn("nothing here")).toEqual([])
  })
})

const parameters = (payload: Slip, index: number): ReadonlyArray<Parameter> =>
  payload.links?.actions[index]?.parameters ?? []

describe("checking the values a person supplied", () => {
  const contribution = slip("valid", "open-contribution.json")
  const form = parameters(contribution, 2)

  it("accepts a complete, in-range answer", () => {
    expect(checkValues(form, { amount: "25", token: "usdm" })).toEqual([])
  })

  it("will not send while a required parameter is empty", () => {
    expect(checkValues(form, { amount: "", token: "usdm" }).map((issue) => issue.reason)).toEqual(["required"])
  })

  it("enforces a number's bounds rather than only showing them", () => {
    expect(checkValues(form, { amount: "0", token: "usdm" }).map((issue) => issue.reason)).toEqual(["belowMin"])
    expect(checkValues(form, { amount: "501", token: "usdm" }).map((issue) => issue.reason)).toEqual(["aboveMax"])
    expect(checkValues(form, { amount: "500", token: "usdm" })).toEqual([])
  })

  it("refuses a select value that was never offered", () => {
    expect(checkValues(form, { amount: "25", token: "ada" }).map((issue) => issue.reason)).toEqual(["notAnOption"])
  })

  it("reads a number strictly, so no answer means something other than it looks", () => {
    for (const amount of ["0x10", "12abc", "1,000", "Infinity", "NaN", " "]) {
      expect(
        checkValues(form, { amount, token: "usdm" }).map((issue) => issue.reason),
        amount
      ).toEqual(["notANumber"])
    }
    for (const amount of ["25", "25.5", "2.5e1", " 25 "]) {
      expect(checkValues(form, { amount, token: "usdm" }), amount).toEqual([])
    }
  })

  it("counts characters on text and values on number", () => {
    const text: ReadonlyArray<Parameter> = [{ name: "note", label: "Note", type: "text", min: 2, max: 4 }]
    expect(checkValues(text, { note: "hi" })).toEqual([])
    expect(checkValues(text, { note: "h" }).map((issue) => issue.reason)).toEqual(["belowMin"])
    expect(checkValues(text, { note: "hello" }).map((issue) => issue.reason)).toEqual(["aboveMax"])
    // 3 is one character and would fail a value bound of 2..4 nowhere.
    expect(checkValues(text, { note: "3" }).map((issue) => issue.reason)).toEqual(["belowMin"])
  })

  it("reports every field at once rather than one per submission", () => {
    expect(checkValues(form, { amount: "", token: "ada" }).map((issue) => issue.name)).toEqual(["amount", "token"])
  })

  it("leaves an optional parameter that was not filled alone", () => {
    const optional: ReadonlyArray<Parameter> = [{ name: "note", label: "Note", type: "text", min: 2 }]
    expect(checkValues(optional, {})).toEqual([])
  })
})

describe("filling the template", () => {
  const contribution = slip("valid", "open-contribution.json")
  const action = contribution.links!.actions[2]!

  it("substitutes into the href and resolves against the discovery URL", () => {
    expect(Either.getOrThrow(fillHref(action, { amount: "25", token: "usdm" }, discovery))).toBe(
      "https://fund.linktap.example/api/slips/fund/community?amount=25&token=usdm"
    )
  })

  it("substitutes into the label verbatim, because a label is display", () => {
    expect(fillLabel(action, { amount: "1 000", token: "usdm" })).toBe("Contribute 1 000 usdm")
  })

  // `text` takes any string, which is what makes it the one worth pointing at the encoder.
  const freeText = {
    label: "Pay {note}",
    href: "/api/slips/pay?note={note}",
    parameters: [{ name: "note", label: "Note", type: "text" }]
  } satisfies LinkedAction

  it("percent-encodes to RFC 3986 unreserved and no further", () => {
    expect(Either.getOrThrow(fillHref(freeText, { note: "a b&c=d" }, discovery))).toBe(
      "https://fund.linktap.example/api/slips/pay?note=a%20b%26c%3Dd"
    )
    expect(Either.getOrThrow(fillHref(freeText, { note: "x!'()*~-_." }, discovery))).toBe(
      "https://fund.linktap.example/api/slips/pay?note=x%21%27%28%29%2A~-_."
    )
  })

  it("cannot be made to leave the origin by any answer a person gives", () => {
    // The origin is fixed by the template: an encoded value carries no `:`, `/`, `?`, `#` or `@`.
    for (const hostile of [
      "//evil.example/x",
      "https://evil.example",
      "@evil.example",
      "../../../etc/passwd",
      "x#@evil.example",
      "x?next=https://evil.example"
    ]) {
      const target = Either.getOrThrow(fillHref(freeText, { note: hostile }, discovery))
      expect(new URL(target).origin, hostile).toBe("https://fund.linktap.example")
      expect(new URL(target).pathname, hostile).toBe("/api/slips/pay")
    }
  })

  it("will not build a target while a value is wrong", () => {
    const result = fillHref(action, { amount: "999", token: "usdm" }, discovery)
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left.map((issue) => issue.reason)).toEqual(["aboveMax"])
  })

  it("sends an action with no parameters as soon as it is chosen", () => {
    const fixed = contribution.links!.actions[0]!
    expect(Either.getOrThrow(fillHref(fixed, {}, discovery))).toBe(
      "https://fund.linktap.example/api/slips/fund/community?amount=25&token=usdm"
    )
  })
})
