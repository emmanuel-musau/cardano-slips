import { checkTemplates, decodePartialIntent, decodeSlip, fillHref, type Slip } from "@cardano-slips/core"
import { Either } from "effect"
import { describe, expect, it, vi } from "vitest"

import { author, communityPool, delegate, delegateSlip, tip } from "../src/index.js"

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

const enterpriseChange = "addr1vxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjyseeq605"

const registered = () => Promise.resolve(true)
const unregistered = () => Promise.resolve(false)

const secondsAway = (instant: string): number => (Date.parse(instant) - Date.now()) / 1000

describe("the delegate Slip", () => {
  it("serves a discovery response the schema accepts", async () => {
    const response = await delegate.GET(new Request(delegateUrl))

    expect(response.status).toBe(200)
    expect(Either.isRight(decodeSlip(await body(response)))).toBe(true)
  })

  it("builds one delegation certificate and no output for a registered stake key", async () => {
    const response = await delegateSlip("mainnet", communityPool, registered).POST(build(delegateUrl))
    const payload = await body(response)

    expect(response.status).toBe(200)
    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect((payload.intent as { certificates: unknown }).certificates).toEqual([
      { type: "stakeDelegation", poolId: communityPool }
    ])
    expect(payload.intent).not.toHaveProperty("outputs")
    expect(payload.message).toBe("Delegate to the Community Stake Pool. Your ADA never leaves your wallet.")
  })

  it("registers the stake key before delegating when it is not registered", async () => {
    const response = await delegateSlip("mainnet", communityPool, unregistered).POST(build(delegateUrl))
    const payload = await body(response)

    expect(response.status).toBe(200)
    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect((payload.intent as { certificates: unknown }).certificates).toEqual([
      { type: "stakeRegistration" },
      { type: "stakeDelegation", poolId: communityPool }
    ])
    expect(payload.intent).not.toHaveProperty("outputs")
  })

  it("names the deposit, and does not claim no ADA leaves, when it registers the key", async () => {
    const payload = await body(await delegateSlip("mainnet", communityPool, unregistered).POST(build(delegateUrl)))

    expect(payload.message).toContain("deposit")
    expect(payload.message).not.toContain("never leaves")
  })

  it("refuses a change address with no stake key as the wallet's fault, without asking the chain", async () => {
    const lookup = vi.fn(registered)
    const request = new Request(delegateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeAddress: enterpriseChange, network: "mainnet" })
    })
    const response = await delegateSlip("mainnet", communityPool, lookup).POST(request)
    const payload = await body(response)

    expect(response.status).toBe(400)
    expect(payload.code).toBe("INVALID_PARAMETER")
    expect(payload.message).toContain("stake key")
    expect(payload.message).not.toContain("Try again")
    expect(lookup).not.toHaveBeenCalled()
  })

  it("asks about the change address the wallet sent", async () => {
    const lookup = vi.fn(registered)

    await delegateSlip("mainnet", communityPool, lookup).POST(build(delegateUrl))

    expect(lookup).toHaveBeenCalledWith(changeAddress)
  })

  it("says it could not check, rather than guess, when the lookup fails", async () => {
    const failing = () => Promise.reject(new Error("koios: 503"))
    const response = await delegateSlip("mainnet", communityPool, failing).POST(build(delegateUrl))
    const payload = await body(response)

    expect(response.status).toBe(502)
    expect(payload.code).toBe("UPSTREAM_FAILURE")
    expect(payload.message).not.toContain("koios")
    expect(payload).not.toHaveProperty("intent")
  })

  it("expires, and not in the past", async () => {
    const payload = await body(await delegateSlip("mainnet", communityPool, registered).POST(build(delegateUrl)))
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

  it("points its actions at wherever it was actually served", async () => {
    const elsewhere = "https://linktap.example/slips/tip"
    const decoded = decodeSlip(await body(await tip.GET(new Request(elsewhere))))
    if (Either.isLeft(decoded)) throw new Error("the tip Slip did not decode")

    const hrefs = (decoded.right as Slip).links?.actions.map((action) => action.href)
    expect(hrefs).toEqual(["/slips/tip?amount=5", "/slips/tip?amount=25", "/slips/tip?amount={amount}"])
  })

  it("answers the POST its own parameterised action fills in", async () => {
    const decoded = decodeSlip(await body(await tip.GET(new Request(tipUrl))))
    if (Either.isLeft(decoded)) throw new Error("the tip Slip did not decode")

    const action = (decoded.right as Slip).links?.actions[2]
    if (action === undefined) throw new Error("the tip Slip declared no parameterised action")

    const target = fillHref(action, { amount: "7.5" }, tipUrl)
    if (Either.isLeft(target)) throw new Error("the client could not fill the action")

    const payload = await body(await tip.POST(build(target.right)))
    expect(payload.intent).toMatchObject({ outputs: [{ lovelace: "7500000" }] })
  })

  it("takes the exponent form core's own parameter check lets through", async () => {
    const payload = await body(await tip.POST(build(`${tipUrl}?amount=5e2`)))

    expect(payload.intent).toMatchObject({ outputs: [{ lovelace: "500000000" }] })
  })

  it("says what is actually wrong with an amount finer than a lovelace", async () => {
    const response = await tip.POST(build(`${tipUrl}?amount=1.0000001`))
    const payload = await body(response)

    expect(response.status).toBe(400)
    expect(payload.message).toBe("ADA divides no further than six decimal places.")
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
