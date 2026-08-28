import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeEndpointError, type EndpointErrorCode } from "@cardano-slips/core"
import { Either } from "effect"
import { describe, expect, it, vi } from "vitest"

import { defineSlip, fail, type Build, type BuildContext, type Discovery, type DiscoveryContext } from "../src/index.js"

/**
 * `defineSlip` against the payloads the CIP publishes. Two properties carry
 * most of these cases: an endpoint's own output is validated before it leaves,
 * and nothing a handler failed at ever reaches the wire as a stack trace.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples")

const example = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(examples, path), "utf8")) as Record<string, unknown>

/** The spec's own payloads, less the constants a publisher never writes. */
const withoutConstants = (payload: Record<string, unknown>): Record<string, unknown> => {
  const { type: _type, version: _version, network: _network, ...rest } = payload
  return rest
}

const payment = withoutConstants(example("get/valid/payment.json")) as unknown as Discovery
const closed = withoutConstants(example("get/valid/campaign-closed.json")) as unknown as Discovery
const intent = withoutConstants(example("partial/valid/payment.json")) as unknown as Build
const buildRequest = example("build-request/valid/payment.json")

const endpoint = "https://linktap.example/api/slips/pay"

const get = (url = endpoint): Request => new Request(url)

const post = (body: unknown, url = endpoint): Request =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  })

const slip = (overrides: Partial<Parameters<typeof defineSlip>[0]> = {}) =>
  defineSlip({
    network: "mainnet",
    get: () => payment,
    post: () => intent,
    onInternalError: () => {},
    ...overrides
  })

const body = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

describe("GET", () => {
  it("answers the spec's own discovery payload", async () => {
    const response = await slip().GET(get())
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual(example("get/valid/payment.json"))
  })

  it("sets the headers a browser client cannot work without", async () => {
    const response = await slip().GET(get())
    expect(response.headers.get("Content-Type")).toBe("application/json")
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60")
  })

  it("hands the handler the request and its URL", async () => {
    const seen = vi.fn((_: DiscoveryContext) => payment)
    await slip({ get: seen }).GET(get(`${endpoint}?amount=12`))
    const [context] = seen.mock.calls[0]!
    expect(context.url.searchParams.get("amount")).toBe("12")
    expect(context.request.method).toBe("GET")
  })

  it("answers 200 with a complete body for a Slip that is closed", async () => {
    // Reporting unavailability as a non-2xx turns a state the client can render
    // into a failure the person meets only after committing to the action.
    const response = await slip({ get: () => closed }).GET(get())
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual(example("get/valid/campaign-closed.json"))
  })
})

describe("what a publisher cannot get wrong", () => {
  it("fills the two constants and the network, and a handler cannot override them", async () => {
    const response = await slip({
      network: "preprod",
      get: () => ({ ...payment, type: "error", version: "9", network: "mainnet" }) as unknown as Discovery
    }).GET(get())
    const payload = await body(response)
    expect(payload.type).toBe("slip")
    expect(payload.version).toBe("1")
    expect(payload.network).toBe("preprod")
  })

  it("refuses to send a discovery response missing a required member", async () => {
    const onInternalError = vi.fn()
    const response = await slip({
      get: () => ({ ...payment, title: undefined }) as unknown as Discovery,
      onInternalError
    }).GET(get())
    expect(response.status).toBe(500)
    expect(await body(response)).toEqual({
      type: "error",
      version: "1",
      code: "INTERNAL_ERROR",
      message: "The endpoint could not answer this request."
    })
    expect(onInternalError).toHaveBeenCalledOnce()
  })

  it("refuses to send a discovery response carrying a member this version does not define", async () => {
    const response = await slip({
      get: () => ({ ...payment, fee: "170000" }) as unknown as Discovery
    }).GET(get())
    expect(response.status).toBe(500)
  })

  it("refuses to send an href pointing at another origin", async () => {
    // The rule needs the request URL, so no schema can make it.
    const response = await slip({
      get: () => withoutConstants(example("get/invalid/rule/cross-origin-href.json")) as unknown as Discovery
    }).GET(get())
    expect(response.status).toBe(500)
    expect((await body(response)).code).toBe("INTERNAL_ERROR")
  })

  it("refuses to send a partial intent that breaks the schema", async () => {
    const response = await slip({
      post: () => ({ intent: { outputs: [], validUntil: "2027-01-01T00:00:00Z" } }) as unknown as Build
    }).POST(post(buildRequest))
    expect(response.status).toBe(500)
    expect((await body(response)).code).toBe("INTERNAL_ERROR")
  })

  it("reports the defect to the publisher and never on the wire", async () => {
    const onInternalError = vi.fn()
    const response = await slip({
      get: () => ({ ...payment, icon: "http://linktap.example/i.png" }) as unknown as Discovery,
      onInternalError
    }).GET(get())
    expect(onInternalError.mock.calls[0]![0]).toContain("icon")
    expect(JSON.stringify(await body(response))).not.toContain("icon")
  })
})

describe("a handler that throws", () => {
  it("becomes INTERNAL_ERROR, and the thrown detail never reaches the person", async () => {
    const onInternalError = vi.fn()
    const response = await slip({
      get: () => {
        throw new Error("connect ECONNREFUSED 10.0.0.4:5432")
      },
      onInternalError
    }).GET(get())
    expect(response.status).toBe(500)
    expect(await response.clone().text()).not.toContain("10.0.0.4")
    expect(onInternalError).toHaveBeenCalledOnce()
    expect(onInternalError.mock.calls[0]![1]).toBeInstanceOf(Error)
  })

  it("does the same at POST", async () => {
    const response = await slip({
      post: () => {
        throw new Error("upstream said no")
      }
    }).POST(post(buildRequest))
    expect(response.status).toBe(500)
    expect(await response.clone().text()).not.toContain("upstream")
  })
})

describe("failures a handler declares", () => {
  it.each([
    ["NOT_FOUND", 404],
    ["UNAVAILABLE", 409],
    ["EXPIRED", 410],
    ["UPSTREAM_FAILURE", 502],
    ["INTERNAL_ERROR", 500]
  ] as const)("sends %s with status %i", async (code, status) => {
    const response = await slip({ get: () => fail(code, "Nothing here can be signed.") }).GET(get())
    expect(response.status).toBe(status)
    expect(await body(response)).toEqual({ type: "error", version: "1", code, message: "Nothing here can be signed." })
  })

  it("attaches field to the parameter at fault", async () => {
    const response = await slip({
      post: () => fail("INVALID_PARAMETER", "Amount must be between 1 and 500 USDM.", { field: "amount" })
    }).POST(post(buildRequest))
    expect(response.status).toBe(400)
    expect(await body(response)).toEqual(example("error/valid/invalid-parameter.json"))
  })

  it("sets Retry-After where the publisher gave one", async () => {
    const response = await slip({
      get: () => fail("RATE_LIMITED", "Too many requests. Try again shortly.", { retryAfter: 30 })
    }).GET(get())
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("30")
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -5, 1.5, 1e30])(
    "refuses to put %p on the wire as Retry-After",
    async (retryAfter) => {
      // A header is part of the response. A client waits the interval this
      // names, and none of these names one.
      const onInternalError = vi.fn()
      const response = await slip({
        get: () => fail("RATE_LIMITED", "Too many requests.", { retryAfter }),
        onInternalError
      }).GET(get())
      expect(response.headers.get("Retry-After")).toBeNull()
      expect(response.status).toBe(500)
      expect(onInternalError).toHaveBeenCalledOnce()
    }
  )

  it("keeps a whole number of zero seconds, which is a real interval", async () => {
    const response = await slip({ get: () => fail("RATE_LIMITED", "Try again.", { retryAfter: 0 }) }).GET(get())
    expect(response.headers.get("Retry-After")).toBe("0")
  })

  it("refuses to send field alongside a code that names no parameter", async () => {
    // `field` points at a rejected submitted value, so it means nothing here.
    const response = await slip({ get: () => fail("NOT_FOUND", "Nothing here.", { field: "amount" }) }).GET(get())
    expect(response.status).toBe(500)
    expect((await body(response)).code).toBe("INTERNAL_ERROR")
  })

  it("never caches a failure", async () => {
    const response = await slip({ get: () => fail("EXPIRED", "This campaign closed.") }).GET(get())
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("sends a fallback that is itself a conforming failure", async () => {
    // Nothing validates this one on the way out, so it is validated here.
    const response = await slip({
      get: () => {
        throw new Error("boom")
      }
    }).GET(get())
    expect(Either.isRight(decodeEndpointError(await body(response)))).toBe(true)
  })

  it("refuses to send a code this version does not give an endpoint", async () => {
    const response = await slip({
      get: () => fail("EFFECTS_MISMATCH" as EndpointErrorCode, "The effects disagree.")
    }).GET(get())
    expect(response.status).toBe(500)
    expect((await body(response)).code).toBe("INTERNAL_ERROR")
  })

  it("validates the failure body too, and replaces one the spec would reject", async () => {
    // A message over 300 characters is the publisher's bug, not something to send.
    const onInternalError = vi.fn()
    const response = await slip({
      get: () => fail("UNAVAILABLE", "x".repeat(301)),
      onInternalError
    }).GET(get())
    expect(response.status).toBe(500)
    expect((await body(response)).message).toBe("The endpoint could not answer this request.")
    expect(onInternalError).toHaveBeenCalledOnce()
  })
})

describe("a reporter that throws", () => {
  it("still answers, rather than letting the framework render the exception", async () => {
    const endpointUnderTest = defineSlip({
      network: "mainnet",
      get: () => {
        throw new Error("connect ECONNREFUSED 10.0.0.4:5432")
      },
      post: () => intent,
      onInternalError: () => {
        throw new Error("the logger is not configured")
      }
    })
    const response = await endpointUnderTest.GET(get())
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain("10.0.0.4")
  })
})

describe("POST", () => {
  it("answers the spec's own partial intent", async () => {
    const response = await slip().POST(post(buildRequest))
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual(example("partial/valid/payment.json"))
  })

  it("never caches a partial intent", async () => {
    // Built for one person, against one address, and it expires.
    const response = await slip().POST(post(buildRequest))
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  it("hands the handler the change address, the network and the URL", async () => {
    const seen = vi.fn((_: BuildContext) => intent)
    await slip({ post: seen }).POST(post(buildRequest, `${endpoint}?amount=12`))
    const [context] = seen.mock.calls[0]!
    expect(context.changeAddress).toBe(buildRequest.changeAddress)
    expect(context.network).toBe("mainnet")
    expect(context.url.searchParams.get("amount")).toBe("12")
  })

  it("rejects a body that is not JSON", async () => {
    const response = await slip().POST(post("not json at all"))
    expect(response.status).toBe(400)
    expect((await body(response)).code).toBe("INVALID_PARAMETER")
  })

  it.each([
    "missing-network.json",
    "not-an-address.json",
    "stake-address-as-change.json",
    "unknown-network.json",
    "utxos-in-the-body.json"
  ])("rejects %s with INVALID_PARAMETER", async (file) => {
    const response = await slip().POST(post(example(`build-request/invalid/schema/${file}`)))
    expect(response.status).toBe(400)
    expect((await body(response)).code).toBe("INVALID_PARAMETER")
  })

  it("never calls the handler for a body it rejected", async () => {
    const never = vi.fn((_: BuildContext) => intent)
    await slip({ post: never }).POST(post(example("build-request/invalid/schema/utxos-in-the-body.json")))
    expect(never).not.toHaveBeenCalled()
  })
})

describe("the three statements of network that have to agree", () => {
  it("rejects a request stating a network the Slip does not serve", async () => {
    const response = await slip().POST(post(example("build-request/valid/preprod.json")))
    expect(response.status).toBe(400)
    expect((await body(response)).code).toBe("WRONG_NETWORK")
  })

  it("rejects a change address encoding another network than the request states", async () => {
    const response = await slip().POST(post(example("build-request/invalid/rule/address-network-disagrees.json")))
    expect(response.status).toBe(400)
    expect((await body(response)).code).toBe("WRONG_NETWORK")
  })

  it("accepts a preprod request at a preprod endpoint", async () => {
    const response = await slip({ network: "preprod" }).POST(post(example("build-request/valid/preprod.json")))
    expect(response.status).toBe(200)
  })
})

describe("OPTIONS", () => {
  it("answers the preflight a JSON body makes mandatory", () => {
    const response = slip().OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type")
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400")
  })
})

describe("every response, whatever happened", () => {
  const responses = async (): Promise<Response[]> => {
    const endpointUnderTest = slip()
    return [
      await endpointUnderTest.GET(get()),
      await endpointUnderTest.POST(post(buildRequest)),
      await endpointUnderTest.POST(post("not json")),
      await endpointUnderTest.POST(post(example("build-request/valid/preprod.json"))),
      await slip({ get: () => fail("NOT_FOUND", "Nothing here.") }).GET(get()),
      await slip({
        get: () => {
          throw new Error("boom")
        }
      }).GET(get()),
      endpointUnderTest.OPTIONS()
    ]
  }

  it("carries Access-Control-Allow-Origin", async () => {
    for (const response of await responses()) {
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    }
  })

  it("never asks for credentials", async () => {
    // An endpoint MUST NOT require them, and discovery is anonymous by construction.
    for (const response of await responses()) {
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull()
    }
  })
})
