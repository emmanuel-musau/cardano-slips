import { tip } from "@cardano-slips/example-slips"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import { type ExchangeError, type ExchangeOptions, fetchSlip, requestIntent } from "../src/exchange.js"
import { mainnetAddress } from "./stub-wallet.js"

/**
 * The exchanges against the example endpoints themselves: only the network is
 * a stand-in, routing each request to the handler that would have answered it.
 */

type Handler = (request: Request) => Response | Promise<Response>

const origin = "https://linktap.example"

type Network = { readonly fetch: typeof globalThis.fetch; readonly sent: Array<Request> }

const network = (routes: Record<string, Handler>): Network => {
  const sent: Array<Request> = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    sent.push(request.clone())
    const url = new URL(request.url)
    const handler = routes[url.pathname]
    if (handler === undefined) return new Response("<html>Not here</html>", { status: 404 })
    return handler(request)
  }
  return { fetch, sent }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

const failureBody = (code: string, message: string, extra: Record<string, unknown> = {}) => ({
  type: "error",
  version: "1",
  code,
  message,
  ...extra
})

const tipRoutes = { "/tip": (request: Request) => tip.GET(request) }

const slipAt = async (link: string, options: ExchangeOptions) => Effect.runPromise(fetchSlip(link, options))

const failure = async (link: string, options: ExchangeOptions): Promise<ExchangeError> => {
  const result = await Effect.runPromise(Effect.either(fetchSlip(link, options)))
  if (Either.isRight(result)) throw new Error("this was expected to fail and did not")
  if (result.left._tag !== "ExchangeError") throw new Error(`failed as ${result.left._tag}`)
  return result.left
}

describe("fetching a Slip", () => {
  it("reads the Slip at the link when the origin has no slips.json", async () => {
    const { fetch } = network(tipRoutes)
    const fetched = await slipAt(`${origin}/tip`, { fetch })

    expect(fetched.slip.title).toBe("Tip the author")
    expect(fetched.discoveryUrl).toBe(`${origin}/tip`)
  })

  it("follows slips.json from the link a person shares to the endpoint", async () => {
    const { fetch, sent } = network({
      "/slips.json": () => json({ rules: [{ pathPattern: "/t/*", apiPath: "/api/*" }] }),
      "/api/tip": (request) => tip.GET(request)
    })
    const fetched = await slipAt(`${origin}/t/tip`, { fetch })

    expect(fetched.discoveryUrl).toBe(`${origin}/api/tip`)
    expect(sent.map((request) => new URL(request.url).pathname)).toEqual(["/slips.json", "/api/tip"])
  })

  it("asks anonymously, with no credentials", async () => {
    const { fetch, sent } = network(tipRoutes)
    await slipAt(`${origin}/tip`, { fetch })

    expect(sent.at(-1)?.credentials).toBe("omit")
    expect(sent.at(-1)?.headers.get("authorization")).toBeNull()
  })

  it("refuses a link that is not https before fetching anything", async () => {
    const { fetch, sent } = network(tipRoutes)
    const result = await Effect.runPromise(Effect.either(fetchSlip("http://linktap.example/tip", { fetch })))

    expect(Either.isLeft(result) && result.left._tag).toBe("InsecureSlipUrl")
    expect(sent).toEqual([])
  })

  it("keeps the endpoint's own code and words when its failure body is readable", async () => {
    const { fetch } = network({ "/gone": () => json(failureBody("NOT_FOUND", "No shop by that name."), 404) })
    const error = await failure(`${origin}/gone`, { fetch })

    expect(error).toMatchObject({ code: "NOT_FOUND", errorClass: "terminal", endpointMessage: "No shop by that name." })
  })

  it("classifies an unreadable failure by its status alone, and keeps none of its words", async () => {
    const { fetch } = network({})
    const error = await failure(`${origin}/nothing`, { fetch })

    expect(error.code).toBeUndefined()
    expect(error.endpointMessage).toBeUndefined()
    expect(error).toMatchObject({ errorClass: "terminal", status: 404 })
  })

  it("reads a server error with no readable body as transient", async () => {
    const { fetch } = network({ "/tip": () => new Response("Bad gateway", { status: 502 }) })

    expect(await failure(`${origin}/tip`, { fetch })).toMatchObject({ errorClass: "transient", status: 502 })
  })

  it("carries how long to wait before asking again", async () => {
    const { fetch } = network({
      "/tip": () => json(failureBody("RATE_LIMITED", "Slow down."), 429, { "retry-after": "30" })
    })

    expect(await failure(`${origin}/tip`, { fetch })).toMatchObject({
      code: "RATE_LIMITED",
      errorClass: "transient",
      retryAfter: 30
    })
  })

  it("treats a code the spec does not define as terminal, whatever the status says", async () => {
    const { fetch } = network({ "/tip": () => json(failureBody("TRY_LATER", "Come back soon."), 503) })

    expect(await failure(`${origin}/tip`, { fetch })).toMatchObject({
      code: "TRY_LATER",
      errorClass: "terminal",
      endpointMessage: "Come back soon."
    })
  })

  it.each([
    ["a Slip", { type: "slip", version: "2" }, 200],
    ["a failure", failureBody("NOT_FOUND", "Gone.", { version: "2" }), 404]
  ])("names a newer protocol version in %s as unsupported, not as malformed", async (_, body, status) => {
    const { fetch } = network({ "/tip": () => json(body, status) })

    expect(await failure(`${origin}/tip`, { fetch })).toMatchObject({ code: "UNSUPPORTED_VERSION" })
  })

  it.each([
    ["a body that is not JSON", () => new Response("<html>hello</html>", { status: 200 })],
    [
      "a Slip with a member the spec does not define",
      async (request: Request) => {
        const slip = (await (await tip.GET(request)).json()) as Record<string, unknown>
        return json({ ...slip, extra: true })
      }
    ],
    [
      "a Slip whose action leaves the origin",
      async (request: Request) => {
        const slip = (await (await tip.GET(request)).json()) as { links: { actions: Array<Record<string, unknown>> } }
        const [first, ...rest] = slip.links.actions
        return json({ ...slip, links: { actions: [{ ...first, href: "https://elsewhere.example/pay" }, ...rest] } })
      }
    ]
  ] as const)("refuses %s as malformed", async (_, handler) => {
    const { fetch } = network({ "/tip": handler })

    expect(await failure(`${origin}/tip`, { fetch })).toMatchObject({ code: "MALFORMED_RESPONSE" })
  })

  it("refuses a response that arrived from another origin after a redirect", async () => {
    const { fetch } = network({
      "/tip": async (request) => {
        const response = await tip.GET(request)
        Object.defineProperty(response, "url", { value: "https://elsewhere.example/tip" })
        return response
      }
    })

    expect(await failure(`${origin}/tip`, { fetch })).toMatchObject({ code: "MALFORMED_RESPONSE" })
  })

  it("names a request that never got an answer as unreachable", async () => {
    const refused: typeof globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

    expect(await failure(`${origin}/tip`, { fetch: refused })).toMatchObject({
      code: "UNREACHABLE",
      errorClass: "transient"
    })
  })

  it("gives up on an endpoint that never answers", async () => {
    const hangs: typeof globalThis.fetch = () => new Promise(() => undefined)

    expect(await failure(`${origin}/tip`, { fetch: hangs, timeoutMs: 20 })).toMatchObject({ code: "UNREACHABLE" })
  })
})

describe("requesting the partial intent", () => {
  const post = (href: string, fetch: typeof globalThis.fetch) =>
    Effect.runPromise(
      Effect.either(requestIntent({ href, changeAddress: mainnetAddress.bech32, network: "mainnet" }, { fetch }))
    )

  it("sends the change address and the network and nothing else, and reads the intent back", async () => {
    const { fetch, sent } = network({ "/tip": (request) => tip.POST(request) })
    const result = await post(`${origin}/tip?amount=5`, fetch)

    expect(Either.getOrThrow(result).intent.outputs?.[0]?.lovelace).toBe("5000000")
    expect(await sent[0]?.json()).toEqual({ changeAddress: mainnetAddress.bech32, network: "mainnet" })
    expect(sent[0]?.credentials).toBe("omit")
  })

  it("carries the field an endpoint rejected, so it can land on that field", async () => {
    const { fetch } = network({ "/tip": (request) => tip.POST(request) })
    const result = await post(`${origin}/tip?amount=nope`, fetch)

    expect(Either.isLeft(result) && result.left).toMatchObject({
      code: "INVALID_PARAMETER",
      errorClass: "request",
      field: "amount"
    })
  })

  // The body carries the change address; a redirect followed and refused afterwards has already handed it on.
  it("refuses a redirect without letting the fetch follow it", async () => {
    const { fetch, sent } = network({
      "/tip": () => new Response(null, { status: 307, headers: { location: "https://tracker.example/collect" } })
    })
    const result = await post(`${origin}/tip?amount=5`, fetch)

    expect(Either.isLeft(result) && result.left).toMatchObject({ code: "MALFORMED_RESPONSE" })
    expect(sent.map((request) => request.redirect)).toEqual(["manual"])
  })

  it("stops reading an answer with no end", async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(4096)))
      }
    })
    const { fetch } = network({ "/tip": () => new Response(endless) })
    const result = await Effect.runPromise(
      Effect.either(
        requestIntent(
          { href: `${origin}/tip?amount=5`, changeAddress: mainnetAddress.bech32, network: "mainnet" },
          { fetch, maxBytes: 8192 }
        )
      )
    )

    expect(Either.isLeft(result) && result.left).toMatchObject({ code: "UNREACHABLE" })
  })

  it("refuses a 200 that is not a partial intent", async () => {
    const { fetch } = network({ "/tip": (request) => tip.GET(request) })
    const result = await post(`${origin}/tip`, fetch)

    expect(Either.isLeft(result) && result.left).toMatchObject({ code: "MALFORMED_RESPONSE" })
  })
})
