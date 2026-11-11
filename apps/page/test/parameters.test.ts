import type { BalancingParameters } from "@cardano-slips/flow"
import type { ProtocolParameters } from "@evolution-sdk/evolution/sdk/provider/Provider"
import { Effect, Either, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { answerFor, bodyOf, keepFor } from "../src/app/parameters/[network]/answer.js"
import {
  fetchParameters,
  ParametersBody,
  type ParametersBody as Body,
  ParametersError,
  resolveParameters,
  slotsFor
} from "../src/slip-page/parameters.js"

/** Preview at epoch 1434, as Koios `epoch_params` gave it. */
const body: Body = {
  stakeDeposit: "2000000",
  poolDeposit: "500000000",
  drepDeposit: "500000000",
  governanceActionDeposit: "1000000000",
  minFeeCoefficient: "44",
  minFeeConstant: "155381",
  coinsPerUtxoByte: "4310",
  maxTxSize: 16_384
}

const preview: BalancingParameters = {
  stakeDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  governanceActionDeposit: 1_000_000_000n,
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384,
  slots: slotsFor.preview
}

const fromProvider: ProtocolParameters = {
  minFeeA: 44,
  minFeeB: 155_381,
  maxTxSize: 16_384,
  maxValSize: 5_000,
  keyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  govActionDeposit: 1_000_000_000n,
  priceMem: 0.0577,
  priceStep: 0.0000721,
  maxTxExMem: 14_000_000n,
  maxTxExSteps: 10_000_000_000n,
  coinsPerUtxoByte: 4_310n,
  collateralPercentage: 150,
  maxCollateralInputs: 3,
  minFeeRefScriptCostPerByte: 15,
  costModels: { PlutusV1: {}, PlutusV2: {}, PlutusV3: {} }
}

const serve = (answer: () => Response) => {
  const fetch = vi.fn(async (_input: RequestInfo | URL) => answer())
  vi.stubGlobal("fetch", fetch)
  return fetch
}

const failureOf = async (network: "preview" = "preview") => {
  const result = await Effect.runPromise(Effect.either(fetchParameters(network)))
  return Either.isLeft(result) ? result.left : undefined
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("resolving the parameters for a run", () => {
  it("uses figures handed in and asks nobody", async () => {
    const fetch = serve(() => Response.json(body))
    const given = { ...preview, minFeeConstant: 1n }
    expect(await Effect.runPromise(resolveParameters("preview", given))).toBe(given)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("asks the page's own server when none are handed in, and adds the shipped slot mapping", async () => {
    const fetch = serve(() => Response.json(body))
    expect(await Effect.runPromise(resolveParameters("preview"))).toEqual(preview)
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toBe("/parameters/preview")
  })

  it("fails when the server answers with an error", async () => {
    serve(() => Response.json({ message: "The chain provider did not answer." }, { status: 502 }))
    expect(await failureOf()).toEqual(new ParametersError({ network: "preview", detail: "answered 502" }))
  })

  it("fails when the answer is not JSON", async () => {
    serve(() => new Response("<html>down</html>", { status: 200 }))
    expect(await failureOf()).toMatchObject({ _tag: "ParametersError", detail: "not JSON" })
  })

  it("fails when the server cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    )
    expect(await failureOf()).toMatchObject({ _tag: "ParametersError" })
  })

  it.each([
    ["a figure missing", { ...body, minFeeConstant: undefined }],
    ["a negative lovelace figure", { ...body, stakeDeposit: "-2000000" }],
    ["a lovelace figure that is not a whole number", { ...body, minFeeCoefficient: "44.5" }],
    ["a lovelace figure sent as a number", { ...body, coinsPerUtxoByte: 4310 }],
    ["a size of zero", { ...body, maxTxSize: 0 }]
  ])("refuses an answer with %s", async (_name, answer) => {
    serve(() => Response.json(answer))
    expect(await failureOf()).toMatchObject({ _tag: "ParametersError" })
  })
})

const context = (network: string) => ({ params: Promise.resolve({ network }) })
const ask = (answer: ReturnType<typeof answerFor>, network = "preview") =>
  answer(new Request(`https://slips.example/parameters/${network}`), context(network))

describe("the page's parameters route", () => {
  it("maps a provider's parameters to the figures a run needs", () => {
    expect(bodyOf(fromProvider)).toEqual(body)
  })

  it("answers with figures the browser side reads back unchanged", async () => {
    const response = await ask(answerFor(async () => fromProvider))
    expect(response.status).toBe(200)
    const read = Schema.decodeUnknownSync(ParametersBody)(await response.json())
    expect({ ...read, slots: slotsFor.preview }).toEqual(preview)
  })

  it("asks the provider for the network in the path", async () => {
    const read = vi.fn(async () => fromProvider)
    await ask(answerFor(read), "mainnet")
    expect(read).toHaveBeenCalledWith("mainnet")
  })

  it("answers 404 for a network that does not exist, without asking the provider", async () => {
    const read = vi.fn(async () => fromProvider)
    expect((await ask(answerFor(read), "sancho")).status).toBe(404)
    expect(read).not.toHaveBeenCalled()
  })

  it("answers 502 when the provider fails", async () => {
    const response = await ask(answerFor(() => Promise.reject(new Error("429"))))
    expect(response.status).toBe(502)
  })

  it("keeps an answer for a while, so visits do not each cost a provider call", async () => {
    let clock = 0
    const read = vi.fn(async () => fromProvider)
    const answer = answerFor(read, () => clock)
    await ask(answer)
    clock = keepFor - 1
    await ask(answer)
    expect(read).toHaveBeenCalledOnce()
    clock = keepFor
    await ask(answer)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("shares one provider call between visits that arrive while it runs", async () => {
    const read = vi.fn(async () => fromProvider)
    const answer = answerFor(read)
    await Promise.all([ask(answer), ask(answer), ask(answer)])
    expect(read).toHaveBeenCalledOnce()
  })

  it("does not keep a failure", async () => {
    const read = vi.fn<() => Promise<ProtocolParameters>>()
    read.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(fromProvider)
    const answer = answerFor(read)
    expect((await ask(answer)).status).toBe(502)
    expect((await ask(answer)).status).toBe(200)
  })
})
