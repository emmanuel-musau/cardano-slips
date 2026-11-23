import { afterEach, describe, expect, it, vi } from "vitest"

import { koiosStakeKey } from "../src/stake-key.js"

const mainnetChange =
  "addr1qxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjynn4lleg4u9dpmgh74jap9ef7587khxr79r430d4gkalfwsl0vysa"
const mainnetStake = "stake1u9e6llu527zksa5tl2ewsju5l2rlttnplz36chk65twl5hgg2yh8w"

const previewChange =
  "addr_test1qqwxxk8tjthrr8syjv2q3fdzusj8ps2ttj705y4pfq55ezv5frdaskp3avvresmn6flvgurlwxt7dhwcm8p9wg0ghc0sn8s9v3"
const previewStake = "stake_test1uz2y3k7ctqc7kxpucdeaylkywplhr9lxmhvdnsjhy85tu8cz305ej"

const enterpriseChange = "addr1vxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjyseeq605"

const answering = (status: number, payload: unknown) => {
  const fetch = vi.fn(() => Promise.resolve(Response.json(payload, { status })))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the Koios stake key lookup", () => {
  it("asks preview Koios about the stake address inside the change address", async () => {
    const fetch = answering(200, [{ stake_address: previewStake, status: "registered" }])

    await koiosStakeKey("preview")(previewChange)

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://preview.koios.rest/api/v1/account_info")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ _stake_addresses: [previewStake] })
  })

  it("asks mainnet Koios on mainnet", async () => {
    const fetch = answering(200, [{ stake_address: mainnetStake, status: "registered" }])

    await koiosStakeKey("mainnet")(mainnetChange)

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.koios.rest/api/v1/account_info")
    expect(JSON.parse(String(init.body))).toEqual({ _stake_addresses: [mainnetStake] })
  })

  it("sends the token as a bearer header when one is given", async () => {
    const fetch = answering(200, [{ stake_address: previewStake, status: "registered" }])

    await koiosStakeKey("preview", "a-token")(previewChange)

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer a-token")
  })

  it("answers true for a registered key", async () => {
    answering(200, [{ stake_address: previewStake, status: "registered" }])

    await expect(koiosStakeKey("preview")(previewChange)).resolves.toBe(true)
  })

  it("answers false for a key Koios reports as not registered", async () => {
    answering(200, [{ stake_address: previewStake, status: "not registered" }])

    await expect(koiosStakeKey("preview")(previewChange)).resolves.toBe(false)
  })

  it("answers false for a key the chain has never seen", async () => {
    answering(200, [])

    await expect(koiosStakeKey("preview")(previewChange)).resolves.toBe(false)
  })

  it.each([
    ["an HTTP failure", 503, { message: "down" }],
    ["a status it does not know", 200, [{ stake_address: previewStake, status: "pending" }]],
    ["a row for another stake address", 200, [{ stake_address: mainnetStake, status: "registered" }]],
    ["a body that is not a list", 200, { status: "registered" }]
  ])("rejects on %s rather than guess", async (_, status, payload) => {
    answering(status, payload)

    await expect(koiosStakeKey("preview")(previewChange)).rejects.toThrow()
  })

  it("rejects when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed")))
    )

    await expect(koiosStakeKey("preview")(previewChange)).rejects.toThrow()
  })

  it("rejects a change address with no stake key, without asking Koios", async () => {
    const fetch = answering(200, [])

    await expect(koiosStakeKey("mainnet")(enterpriseChange)).rejects.toThrow(/no stake key/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
