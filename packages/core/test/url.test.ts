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
    // Which is why a path-absolute href is allowed at all: it resolves where it was served from.
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

describe("parameters named after something on Object's prototype", () => {
  // The name pattern admits `constructor`, `toString`, `valueOf` and the rest,
  // and a plain object answers for every one of them without being asked.
  const inherited = {
    label: "Pay {constructor}",
    href: "/api/slips/pay?v={constructor}",
    parameters: [{ name: "constructor", label: "Value", type: "text" }]
  } satisfies LinkedAction

  it("reads one that was not supplied as empty, not as the inherited member", () => {
    expect(fillLabel(inherited, {})).toBe("Pay ")
    expect(Either.getOrThrow(fillHref(inherited, {}, discovery))).toBe("https://fund.linktap.example/api/slips/pay?v=")
  })

  it("still holds a required one to being filled", () => {
    const required: ReadonlyArray<Parameter> = [{ name: "toString", label: "Note", type: "text", required: true }]
    expect(checkValues(required, {}).map((issue) => issue.reason)).toEqual(["required"])
    expect(checkValues(required, { toString: "ok" })).toEqual([])
  })

  it("takes a value of that name normally once it is supplied", () => {
    expect(fillLabel(inherited, { constructor: "25" })).toBe("Pay 25")
  })
})

describe("what a person can type into a field", () => {
  const two = {
    label: "{a}{b}",
    href: "/api/slips/pay?a={a}&b={b}",
    parameters: [
      { name: "a", label: "A", type: "text" },
      { name: "b", label: "B", type: "text" }
    ]
  } satisfies LinkedAction

  const target = (values: Record<string, string>): URL => new URL(Either.getOrThrow(fillHref(two, values, discovery)))

  it("substitutes once, so a value that looks like a placeholder stays one", () => {
    expect(fillLabel(two, { a: "{b}", b: "X" })).toBe("{b}X")
    expect(target({ a: "{b}", b: "X" }).searchParams.get("a")).toBe("{b}")
  })

  it("takes a replacement pattern literally", () => {
    // `$&` and `$1` mean something to String.replace when the replacement is a string.
    expect(fillLabel(two, { a: "$&$1", b: "" })).toBe("$&$1")
  })

  it("encodes a value that would otherwise add a parameter of its own", () => {
    const url = target({ a: "1&admin=true", b: "2" })
    expect(url.searchParams.get("a")).toBe("1&admin=true")
    expect(url.searchParams.get("admin")).toBeNull()
  })

  it("encodes a line break rather than passing one on", () => {
    const url = Either.getOrThrow(fillHref(two, { a: "x\r\nX-Evil: 1", b: "" }, discovery))
    expect(url).toContain("a=x%0D%0AX-Evil%3A%201")
  })

  it("encodes an already-encoded value again, so it arrives as it was typed", () => {
    expect(target({ a: "%41", b: "" }).searchParams.get("a")).toBe("%41")
  })

  it("carries a space and an astral character through without losing them", () => {
    expect(target({ a: "a b", b: "\u{1F642}" }).searchParams.get("a")).toBe("a b")
    expect(target({ a: "a", b: "\u{1F642}" }).searchParams.get("b")).toBe("\u{1F642}")
  })

  it("fills every occurrence of a placeholder, not just the first", () => {
    const twice = { ...two, href: "/api/slips/pay?a={a}&again={a}" } satisfies LinkedAction
    const url = new URL(Either.getOrThrow(fillHref(twice, { a: "7", b: "" }, discovery)))
    expect(url.searchParams.getAll("a")).toEqual(["7"])
    expect(url.searchParams.get("again")).toBe("7")
  })

  it("ignores a value for a parameter the action never declared", () => {
    expect(target({ a: "1", b: "2", surprise: "3" }).search).toBe("?a=1&b=2")
  })
})

describe("defects the discovery schema leaves reachable", () => {
  const payment = JSON.parse(readFileSync(join(examples, "valid", "payment.json"), "utf8")) as Record<string, unknown>

  const withActions = (actions: unknown): Slip => Either.getOrThrow(decodeSlip({ ...payment, links: { actions } }))

  it("rejects an href the pattern admits and no URL parser accepts", () => {
    // `https://[` satisfies the pattern; `new URL` throws on it.
    const broken = withActions([{ label: "Pay", href: "https://[" }])
    expect(tags(checkTemplates(broken, discovery))).toEqual(["CrossOriginHref"])
  })

  it("rejects two parameters of one name in one action", () => {
    // Unique within its action is a MUST that no schema can state.
    const clashing = withActions([
      {
        label: "Pay {a}",
        href: "/api/slips/pay?a={a}",
        parameters: [
          { name: "a", label: "First", type: "text" },
          { name: "a", label: "Second", type: "text" }
        ]
      }
    ])
    expect(checkTemplates(clashing, discovery)).toEqual([{ _tag: "DuplicateParameter", action: 0, name: "a" }])
  })

  it("rejects a bound reversed on a text length as readily as on a value", () => {
    const reversed = withActions([
      {
        label: "Pay {note}",
        href: "/api/slips/pay?note={note}",
        parameters: [{ name: "note", label: "Note", type: "text", min: 10, max: 2 }]
      }
    ])
    expect(tags(checkTemplates(reversed, discovery))).toEqual(["BoundsReversed"])
  })

  it("accepts bounds that meet at one value", () => {
    const exact = withActions([
      {
        label: "Pay {n}",
        href: "/api/slips/pay?n={n}",
        parameters: [{ name: "n", label: "N", type: "number", min: 5, max: 5 }]
      }
    ])
    expect(checkTemplates(exact, discovery)).toEqual([])
  })

  it("reports every defect in an action at once", () => {
    const bad = withActions([
      {
        label: "Pay {missing}",
        href: "https://build.example.net/tx?n={n}",
        parameters: [{ name: "n", label: "N", type: "number", min: 9, max: 1 }]
      }
    ])
    expect(tags(checkTemplates(bad, discovery)).sort()).toEqual([
      "BoundsReversed",
      "CrossOriginHref",
      "UndeclaredPlaceholder"
    ])
  })
})

describe("the protocol-relative href the pattern admits", () => {
  const payment = JSON.parse(readFileSync(join(examples, "valid", "payment.json"), "utf8")) as Record<string, unknown>

  it("passes discovery and is caught here", () => {
    // `//evil.example/x` satisfies the path-absolute alternative in the href
    // pattern and resolves to another origin. slips.json's pattern excludes the
    // form outright; this one does not, so the origin check is what stops it.
    const relative = Either.getOrThrow(
      decodeSlip({ ...payment, links: { actions: [{ label: "Pay", href: "//evil.example/x" }] } })
    )
    expect(new URL("//evil.example/x", discovery).origin).toBe("https://evil.example")
    expect(checkTemplates(relative, discovery)).toEqual([
      { _tag: "CrossOriginHref", action: 0, href: "//evil.example/x" }
    ])
  })
})
