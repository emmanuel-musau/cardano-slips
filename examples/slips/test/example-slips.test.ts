import { checkTemplates, decodePartialIntent, decodeSlip, type Slip } from "@cardano-slips/core"
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { author, communityPool, delegate, tip } from "../src/index.js"

/**
 * The fixtures are only worth sharing if they conform, so every response here
 * goes through the same `core` decode a client will run on it.
 */

const delegateUrl = "https://linktap.example/api/slips/delegate"
const tipUrl = "https://linktap.example/api/slips/tip"

const changeAddress =
  "addr1qxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjynn4lleg4u9dpmgh74jap9ef7587khxr79r430d4gkalfwsl0vysa"

const build = (url: string, network = "mainnet"): Request =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changeAddress, network })
  })

const body = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

const secondsAway = (instant: string): number => (Date.parse(instant) - Date.now()) / 1000

describe("the delegate Slip", () => {
  it("serves a discovery response the schema accepts", async () => {
    const response = await delegate.GET(new Request(delegateUrl))

    expect(response.status).toBe(200)
    expect(Either.isRight(decodeSlip(await body(response)))).toBe(true)
  })

  it("builds one delegation certificate and no output", async () => {
    const response = await delegate.POST(build(delegateUrl))
    const payload = await body(response)

    expect(response.status).toBe(200)
    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect(payload.intent).toMatchObject({ certificates: [{ type: "stakeDelegation", poolId: communityPool }] })
    expect(payload.intent).not.toHaveProperty("outputs")
  })

  it("expires, and not in the past", async () => {
    const payload = await body(await delegate.POST(build(delegateUrl)))
    const { validUntil } = payload.intent as { validUntil: string }

    expect(secondsAway(validUntil)).toBeGreaterThan(0)
    expect(secondsAway(validUntil)).toBeLessThanOrEqual(600)
  })

  it("refuses a wallet on another network", async () => {
    const response = await delegate.POST(build(delegateUrl, "preprod"))

    // A request fault, not a conflict: the spec pairs WRONG_NETWORK with 400.
    expect(response.status).toBe(400)
    expect((await body(response)).code).toBe("WRONG_NETWORK")
  })
})

describe("the tip Slip", () => {
  it("serves a discovery response the schema accepts", async () => {
    const response = await tip.GET(new Request(tipUrl))

    expect(response.status).toBe(200)
    expect(Either.isRight(decodeSlip(await body(response)))).toBe(true)
  })

  it("declares linked actions the spec's own template rules accept", async () => {
    const decoded = decodeSlip(await body(await tip.GET(new Request(tipUrl))))
    if (Either.isLeft(decoded)) throw new Error("the tip Slip did not decode")

    expect(checkTemplates(decoded.right as Slip, tipUrl)).toEqual([])
  })

  it("turns whole ADA into lovelace", async () => {
    const payload = await body(await tip.POST(build(`${tipUrl}?amount=5`)))

    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect(payload.intent).toMatchObject({ outputs: [{ address: author, lovelace: "5000000" }] })
  })

  it("keeps the sixth decimal place, which a float would lose", async () => {
    const payload = await body(await tip.POST(build(`${tipUrl}?amount=1.234567`)))

    expect(payload.intent).toMatchObject({ outputs: [{ lovelace: "1234567" }] })
    expect(payload.message).toBe("Tip 1.234567 ADA to the author.")
  })

  it("names the amount from what it parsed, not from the query string", async () => {
    const payload = await body(await tip.POST(build(`${tipUrl}?amount=5.000`)))

    expect(payload.message).toBe("Tip 5 ADA to the author.")
  })

  for (const [name, query] of [
    ["no amount at all", ""],
    ["an amount that is not a number", "?amount=abc"],
    ["an amount below the declared minimum", "?amount=0.5"],
    ["an amount above the declared maximum", "?amount=1001"],
    ["a negative amount", "?amount=-5"]
  ] as const) {
    it(`refuses ${name}`, async () => {
      const response = await tip.POST(build(`${tipUrl}${query}`))
      const payload = await body(response)

      expect(response.status).toBe(400)
      expect(payload.code).toBe("INVALID_PARAMETER")
      expect(payload.field).toBe("amount")
    })
  }
})

describe("both fixtures", () => {
  for (const [name, endpoint] of [
    ["delegate", delegate],
    ["tip", tip]
  ] as const) {
    it(`answers the preflight a JSON body makes mandatory for ${name}`, () => {
      const response = endpoint.OPTIONS()

      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")
    })
  }
})
