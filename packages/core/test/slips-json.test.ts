import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Effect, Either, Schema } from "effect"
import { ArrayFormatter, TreeFormatter, type ParseError } from "effect/ParseResult"
import { describe, expect, it } from "vitest"

import {
  absentMapping,
  decodeSlipsJson,
  fetchDomainMapping,
  MappingRule,
  parseSlipUrl,
  resolvePath,
  resolveSlipUrl,
  type DomainMapping
} from "../src/index.js"

/**
 * The domain mapping: the file, the fetch, and the resolution. Unlike the other
 * two shapes, every rule here is visible in the payload, so `invalid/rule/` is
 * rejected by this decoder rather than deferred — the JSON Schema is what cannot
 * see them, not the client.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "slips-json")

const fixtures = (bucket: string): Array<string> =>
  readdirSync(join(examples, bucket)).filter((file) => file.endsWith(".json"))

const fixture = (bucket: string, file: string): unknown =>
  JSON.parse(readFileSync(join(examples, bucket, file), "utf8"))

const issues = (error: ParseError): Array<{ tag: string; path: string }> =>
  ArrayFormatter.formatErrorSync(error).map((issue) => ({ tag: issue._tag, path: issue.path.join("/") }))

/** Naming the issue and the path: a payload rejected for the wrong reason would still pass "it failed". */
const rejections: ReadonlyArray<{ file: string; tag: string; path: string }> = [
  { file: "missing-rules.json", tag: "Missing", path: "rules" },
  { file: "undeclared-field.json", tag: "Unexpected", path: "redirects" },
  { file: "empty-rules.json", tag: "Refinement", path: "rules" },
  { file: "too-many-rules.json", tag: "Refinement", path: "rules" },
  { file: "missing-api-path.json", tag: "Missing", path: "rules/0/apiPath" },
  { file: "rule-undeclared-field.json", tag: "Unexpected", path: "rules/0/status" },
  { file: "absolute-api-path.json", tag: "Refinement", path: "rules/0/apiPath" },
  { file: "protocol-relative-api-path.json", tag: "Refinement", path: "rules/0/apiPath" },
  { file: "double-star-not-last.json", tag: "Refinement", path: "rules/0/pathPattern" },
  { file: "partial-wildcard.json", tag: "Refinement", path: "rules/0/pathPattern" },
  { file: "relative-path-pattern.json", tag: "Refinement", path: "rules/0/pathPattern" },
  { file: "dot-segment.json", tag: "Refinement", path: "rules/0/pathPattern" },
  { file: "empty-segment.json", tag: "Refinement", path: "rules/0/pathPattern" }
]

/** Schema-valid and still refused. The JSON Schema cannot compare two siblings; this decoder can. */
const ruleRejections: ReadonlyArray<{ file: string; path: string }> = [
  { file: "wildcard-count-disagrees.json", path: "rules/0" },
  { file: "wildcard-kind-disagrees.json", path: "rules/0" },
  { file: "duplicate-path-pattern.json", path: "" }
]

describe("decoding slips.json", () => {
  it.each(fixtures("valid"))("accepts %s", (file) => {
    const result = decodeSlipsJson(fixture("valid", file))
    const failure = Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""
    expect(failure, failure).toBe("")
  })

  it.each(rejections)("rejects $file with $tag at '$path'", ({ file, tag, path }) => {
    const result = decodeSlipsJson(fixture("invalid/schema", file))
    expect(Either.isLeft(result), `${file} was accepted`).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag, path })
    }
  })

  it.each(ruleRejections)("rejects $file, which the JSON Schema alone cannot", ({ file, path }) => {
    const result = decodeSlipsJson(fixture("invalid/rule", file))
    expect(Either.isLeft(result), `${file} was accepted`).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag: "Refinement", path })
    }
  })

  it("records what every rejection example demonstrates", () => {
    expect([...rejections.map((rejection) => rejection.file)].sort()).toEqual(fixtures("invalid/schema").sort())
    expect([...ruleRejections.map((rejection) => rejection.file)].sort()).toEqual(fixtures("invalid/rule").sort())
  })

  it("makes another host unexpressible rather than merely forbidden", () => {
    // A rule that has to be checked is one an implementation can skip.
    for (const hostile of [
      "https://api.other.example/slips",
      "//api.other.example/slips",
      "http://api.other.example",
      "api.other.example/slips"
    ]) {
      const result = Schema.decodeUnknownEither(MappingRule)({ pathPattern: "/pay/*", apiPath: hostile })
      expect(Either.isLeft(result), `the grammar admits ${hostile}`).toBe(true)
    }
  })
})

type ResolutionCase = {
  readonly name: string
  readonly rules: ReadonlyArray<MappingRule>
  readonly path: string
  readonly resolved: string
}

const resolutionCases = (
  JSON.parse(readFileSync(join(examples, "resolution.json"), "utf8")) as { cases: Array<ResolutionCase> }
).cases

describe("the published resolution table", () => {
  it.each(resolutionCases)("$name", ({ rules, path, resolved }) => {
    expect(resolvePath(rules, path)).toBe(resolved)
  })

  it("runs every case the CIP publishes", () => {
    // The table is the specification of this algorithm; a case skipped here is a rule nothing holds us to.
    expect(resolutionCases.length).toBeGreaterThan(0)
  })

  it("uses only rule sets a publisher could actually serve", () => {
    const unserveable = resolutionCases
      .filter(({ rules }) => Either.isLeft(decodeSlipsJson({ rules })))
      .map(({ name }) => name)
    expect(unserveable).toEqual([])
  })
})

describe("a link and the endpoint behind it", () => {
  const mapping: DomainMapping = {
    _tag: "Mapping",
    rules: [{ pathPattern: "/delegate/*", apiPath: "/api/slips/delegate/*" }]
  }

  it("takes the origin from the link and never from the file", () => {
    // Which is what makes the same-origin constraint structural rather than a check.
    expect(Either.getOrThrow(resolveSlipUrl("https://linktap.example/delegate/POOL1", mapping))).toBe(
      "https://linktap.example/api/slips/delegate/POOL1"
    )
  })

  it("treats a link on an origin with no mapping as its own endpoint", () => {
    expect(Either.getOrThrow(resolveSlipUrl("https://linktap.example/api/slips/pay", absentMapping))).toBe(
      "https://linktap.example/api/slips/pay"
    )
  })

  it("keeps the query and the port the link arrived with", () => {
    expect(Either.getOrThrow(resolveSlipUrl("https://linktap.example:8443/delegate/P1?ref=x", mapping))).toBe(
      "https://linktap.example:8443/api/slips/delegate/P1?ref=x"
    )
  })

  it("refuses every scheme but https, and http only on loopback", () => {
    for (const link of ["https://linktap.example/pay", "http://localhost:3000/pay", "http://127.0.0.1:3000/pay"]) {
      expect(Either.isRight(parseSlipUrl(link)), link).toBe(true)
    }
    for (const link of [
      "http://linktap.example/pay",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "web+cardano://slip/pay",
      "linktap.example/pay"
    ]) {
      expect(Either.isLeft(parseSlipUrl(link)), link).toBe(true)
    }
  })
})

const respond = (body: string, init: ResponseInit & { url?: string } = {}): Response => {
  const response = new Response(body, init)
  if (init.url !== undefined) Object.defineProperty(response, "url", { value: init.url })
  return response
}

const stub = (answer: (url: string) => Response | Promise<Response>): typeof globalThis.fetch =>
  ((url: string) => Promise.resolve(answer(String(url)))) as unknown as typeof globalThis.fetch

const run = (
  link: string,
  fetch: typeof globalThis.fetch,
  options: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<Either.Either<DomainMapping, { readonly _tag: string; readonly code?: string; readonly detail: string }>> =>
  Effect.runPromise(Effect.either(fetchDomainMapping(link, { fetch, ...options })))

const served = JSON.stringify({ rules: [{ pathPattern: "/delegate/*", apiPath: "/api/slips/delegate/*" }] })

describe("fetching the mapping", () => {
  it("asks the root of the link's own origin", async () => {
    let asked = ""
    const result = await run(
      "https://linktap.example/delegate/POOL1?ref=x",
      stub((url) => {
        asked = url
        return respond(served)
      })
    )
    expect(asked).toBe("https://linktap.example/slips.json")
    expect(Either.isRight(result) && result.right._tag).toBe("Mapping")
  })

  it.each([404, 410])("reads %i as an origin that serves no mapping", async (status) => {
    const result = await run(
      "https://linktap.example/pay",
      stub(() => respond("", { status }))
    )
    expect(Either.isRight(result) && result.right).toEqual(absentMapping)
  })

  it.each([500, 502, 503, 403, 429])("does not read %i as absent", async (status) => {
    // A client cannot tell an origin with no mapping from one whose mapping it failed to read.
    const result = await run(
      "https://linktap.example/pay",
      stub(() => respond("", { status }))
    )
    expect(Either.isLeft(result) && result.left.code).toBe("UNREACHABLE")
  })

  it("reports a refused request as unreachable rather than falling through", async () => {
    const result = await run("https://linktap.example/pay", (() =>
      Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof globalThis.fetch)
    expect(Either.isLeft(result) && result.left.code).toBe("UNREACHABLE")
  })

  it("reports a file it cannot read as malformed, and does not fall back to the human path", async () => {
    for (const body of [
      "<!doctype html><p>not here",
      JSON.stringify({ rules: [] }),
      JSON.stringify({ redirects: [] })
    ]) {
      const result = await run(
        "https://linktap.example/pay",
        stub(() => respond(body))
      )
      expect(Either.isLeft(result) && result.left.code, body.slice(0, 24)).toBe("MALFORMED_RESPONSE")
    }
  })

  it("refuses a redirect that leaves the origin", async () => {
    // The indirection a rule cannot express, arriving by a third route.
    const result = await run(
      "https://linktap.example/pay",
      stub(() => respond(served, { url: "https://api.other.example/slips.json" }))
    )
    expect(Either.isLeft(result) && result.left.code).toBe("MALFORMED_RESPONSE")
  })

  it("follows a redirect that stays on the origin", async () => {
    const result = await run(
      "https://linktap.example/pay",
      stub(() => respond(served, { url: "https://linktap.example/static/slips.json" }))
    )
    expect(Either.isRight(result) && result.right._tag).toBe("Mapping")
  })

  it("stops reading a body with no end", async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(4096)))
      }
    })
    const result = await run(
      "https://linktap.example/pay",
      (() => Promise.resolve(new Response(endless))) as unknown as typeof globalThis.fetch,
      { maxBytes: 8192 }
    )
    expect(Either.isLeft(result) && result.left.code).toBe("UNREACHABLE")
    expect(Either.isLeft(result) && result.left.detail).toContain("exceeded 8192 bytes")
  })

  it("stops waiting for a response that never comes", async () => {
    const result = await run(
      "https://linktap.example/pay",
      (() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch,
      { timeoutMs: 20 }
    )
    expect(Either.isLeft(result) && result.left.code).toBe("UNREACHABLE")
    expect(Either.isLeft(result) && result.left.detail).toContain("timed out")
  })

  it("never asks the network for a link it would refuse anyway", async () => {
    let asked = false
    const result = await run(
      "http://linktap.example/pay",
      stub(() => {
        asked = true
        return respond(served)
      })
    )
    expect(asked).toBe(false)
    expect(Either.isLeft(result) && result.left._tag).toBe("InsecureSlipUrl")
  })
})
