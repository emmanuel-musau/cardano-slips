import {
  decodeEndpointError,
  decodePartialIntent,
  decodeSlip,
  decodeSlipsJson,
  fillHref,
  resolvePath,
  type MappingRule,
  type Slip
} from "@cardano-slips/core"
import { defineDomainMapping, defineSlip, fail, type RouteParams, type SlipEndpoint } from "@cardano-slips/server"
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { inMinutes } from "../src/deadline.js"
import { author, delegate, tip } from "../src/index.js"

/**
 * The whole publisher side end to end: an App Router tree's routing, the
 * handlers called exactly as Next calls them, and every body decoded through
 * the `core` schemas a client will run on it.
 */

const origin = "https://linktap.example"

const changeAddress =
  "addr1qxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjynn4lleg4u9dpmgh74jap9ef7587khxr79r430d4gkalfwsl0vysa"

/** A route with a dynamic segment, so `params` is exercised through the adapter and not just unit-tested. */
const shop = defineSlip({
  network: "mainnet",
  get: ({ params }) => ({
    title: `Pay ${String(params.handle)}`,
    description: "One payment to the shop's address. Nothing is stored, no account is created.",
    icon: "https://linktap.example/i/shop.png",
    label: "Pay"
  }),
  post: ({ params }) =>
    params.handle === "corner-store"
      ? { intent: { outputs: [{ address: author, lovelace: "12000000" }], validUntil: inMinutes(10) } }
      : fail("NOT_FOUND", "No shop is registered under that name."),
  onInternalError: () => {}
})

/** Served fine, and currently offers nothing to sign — which the spec keeps apart from a failure. */
const closed = defineSlip({
  network: "mainnet",
  get: () => ({
    title: "Delegate to Community Stake Pool",
    description: "Stake your ADA. Funds never leave your wallet.",
    icon: "https://linktap.example/i/community-pool.svg",
    label: "Delegate",
    disabled: true,
    reason: { message: "This campaign closed on 12 August. Nothing can be signed from this link." }
  }),
  post: () => fail("UNAVAILABLE", "This campaign has closed."),
  onInternalError: () => {}
})

const rules: ReadonlyArray<MappingRule> = [
  { pathPattern: "/tip", apiPath: "/api/slips/tip" },
  { pathPattern: "/pay/*", apiPath: "/api/slips/pay/*" }
]

const mapping = defineDomainMapping({ rules })

type Route = {
  readonly pattern: RegExp
  readonly endpoint: SlipEndpoint
  readonly params?: (match: RegExpExecArray) => RouteParams
}

/** One entry per `route.ts` an App Router tree would hold. */
const routes: ReadonlyArray<Route> = [
  { pattern: /^\/api\/slips\/delegate$/, endpoint: delegate },
  { pattern: /^\/api\/slips\/tip$/, endpoint: tip },
  { pattern: /^\/api\/slips\/closed$/, endpoint: closed },
  { pattern: /^\/api\/slips\/pay\/([^/]+)$/, endpoint: shop, params: (match) => ({ handle: match[1] }) }
]

/** Next resolves `params` before the handler runs, and hands it over as a promise. */
const serve = async (method: string, target: string, body?: unknown): Promise<Response> => {
  const url = new URL(target, origin)
  const request =
    method === "POST"
      ? new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : new Request(url, { method })

  if (url.pathname === "/slips.json") return mapping.GET()

  for (const route of routes) {
    const match = route.pattern.exec(url.pathname)
    if (match === null) continue

    const context = route.params === undefined ? undefined : { params: Promise.resolve(route.params(match)) }
    if (method === "GET") return route.endpoint.GET(request, context)
    if (method === "POST") return route.endpoint.POST(request, context)
    return route.endpoint.OPTIONS()
  }

  return new Response(null, { status: 404 })
}

const build = { changeAddress, network: "mainnet" }

const body = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

const slipAt = async (path: string): Promise<Slip> => {
  const decoded = decodeSlip(await body(await serve("GET", path)))
  if (Either.isLeft(decoded)) throw new Error(`${path} did not answer a Slip`)
  return decoded.right as Slip
}

const paths = ["/api/slips/delegate", "/api/slips/tip", "/api/slips/pay/corner-store", "/api/slips/closed"] as const

describe("discovery", () => {
  for (const path of paths) {
    it(`answers ${path} with a Slip the schema accepts`, async () => {
      const response = await serve("GET", path)

      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toBe("application/json")
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60")
      expect(Either.isRight(decodeSlip(await body(response)))).toBe(true)
    })
  }

  it("fills a dynamic segment into what the card says", async () => {
    expect((await slipAt("/api/slips/pay/corner-store")).title).toBe("Pay corner-store")
  })
})

describe("the build round trip", () => {
  it("carries a person's own amount from the card through to the intent", async () => {
    const action = (await slipAt("/api/slips/tip")).links?.actions[2]
    if (action === undefined) throw new Error("the tip Slip declared no parameterised action")

    const target = fillHref(action, { amount: "7.5" }, `${origin}/api/slips/tip`)
    if (Either.isLeft(target)) throw new Error("the client could not fill the action")

    const response = await serve("POST", target.right, build)
    const payload = await body(response)

    expect(response.status).toBe(200)
    // Built for one person, against one address, and it expires.
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect(payload.intent).toMatchObject({ outputs: [{ lovelace: "7500000" }] })
  })

  it("returns a certificate intent with no output", async () => {
    const payload = await body(await serve("POST", "/api/slips/delegate", build))

    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect(payload.intent).toMatchObject({ certificates: [{ type: "stakeDelegation" }] })
  })

  it("reaches a route's dynamic segment on the POST as well as the GET", async () => {
    const payload = await body(await serve("POST", "/api/slips/pay/corner-store", build))

    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect(payload.intent).toMatchObject({ outputs: [{ address: author, lovelace: "12000000" }] })
  })
})

describe("the domain mapping", () => {
  it("serves a slips.json the schema accepts", async () => {
    const response = await serve("GET", "/slips.json")

    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(Either.isRight(decodeSlipsJson(await body(response)))).toBe(true)
  })

  it("takes a shared human link all the way to a Slip", async () => {
    const decoded = decodeSlipsJson(await body(await serve("GET", "/slips.json")))
    if (Either.isLeft(decoded)) throw new Error("the mapping did not decode")

    const resolved = resolvePath(decoded.right.rules, "/pay/corner-store")
    expect(resolved).toBe("/api/slips/pay/corner-store")
    expect((await slipAt(resolved)).title).toBe("Pay corner-store")
  })

  it("leaves a path no rule matches alone", async () => {
    expect(resolvePath(rules, "/api/slips/delegate")).toBe("/api/slips/delegate")
  })
})

describe("CORS", () => {
  for (const path of paths) {
    it(`answers the preflight on ${path}`, async () => {
      const response = await serve("OPTIONS", path)

      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type")
      expect(response.headers.get("Access-Control-Max-Age")).not.toBeNull()
    })
  }

  it("reaches a client on an origin the publisher does not control, whatever the answer", async () => {
    const responses = [
      await serve("GET", "/api/slips/tip"),
      await serve("POST", "/api/slips/delegate", build),
      await serve("POST", "/api/slips/tip?amount=nonsense", build),
      await serve("GET", "/slips.json")
    ]

    for (const response of responses) {
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
      // An endpoint MUST NOT require them, and every one of these is anonymous.
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull()
    }
  })
})

describe("the failure paths", () => {
  for (const [name, path, sent, code, status] of [
    ["an amount the endpoint cannot read", "/api/slips/tip?amount=nonsense", build, "INVALID_PARAMETER", 400],
    ["a wallet on another network", "/api/slips/delegate", { ...build, network: "preprod" }, "WRONG_NETWORK", 400],
    ["a shop that does not exist", "/api/slips/pay/nowhere", build, "NOT_FOUND", 404],
    ["a campaign that has closed", "/api/slips/closed", build, "UNAVAILABLE", 409]
  ] as const) {
    it(`reports ${name} as ${code}`, async () => {
      const response = await serve("POST", path, sent)
      const payload = await body(response)

      expect(response.status).toBe(status)
      expect(payload.code).toBe(code)
      expect(response.headers.get("Cache-Control")).toBe("no-store")
      expect(Either.isRight(decodeEndpointError(payload))).toBe(true)
    })
  }

  it("reports a body that is not JSON without letting a parser error reach the person", async () => {
    const request = new Request(`${origin}/api/slips/tip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json"
    })
    const payload = await body(await tip.POST(request))

    expect(payload.code).toBe("INVALID_PARAMETER")
    expect(payload.message).toBe("The request body is not valid JSON.")
  })
})

describe("a Slip with nothing to sign", () => {
  it("is a complete 200, not an error status", async () => {
    const response = await serve("GET", "/api/slips/closed")
    const slip = await slipAt("/api/slips/closed")

    expect(response.status).toBe(200)
    expect(slip.disabled).toBe(true)
    expect(slip.reason?.message).toContain("closed")
  })
})
