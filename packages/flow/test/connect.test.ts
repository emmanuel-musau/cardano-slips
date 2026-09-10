import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import { connectWallet, networkIdFor } from "../src/connect.js"
import { type ConnectRefusal, connectRefusals, type WalletConnectError } from "../src/wallet-error.js"
import { apiError, hostWith, mainnetAddress, stubProvider, testnetAddress } from "./stub-wallet.js"

const run = <A>(effect: Effect.Effect<A, WalletConnectError>): Promise<A> => Effect.runPromise(effect)

/** Every refusal this suite has reached, so the closed set can be checked at the end. */
const reached = new Set<ConnectRefusal>()

const expectRefusal = async <A>(
  effect: Effect.Effect<A, WalletConnectError>,
  refusal: ConnectRefusal
): Promise<WalletConnectError> => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (Either.isRight(result)) throw new Error("the connection was expected to fail and did not")
  expect(result.left.refusal).toBe(refusal)
  reached.add(result.left.refusal)
  return result.left
}

describe("the network a Slip declares", () => {
  it("is mainnet or a test network, because a CIP-19 address says no more than that", () => {
    expect(networkIdFor("mainnet")).toBe(1)
    expect(networkIdFor("preprod")).toBe(0)
    expect(networkIdFor("preview")).toBe(0)
  })
})

describe("connecting", () => {
  it("returns the API, the network and a bech32 change address", async () => {
    const host = hostWith({ lace: stubProvider() })
    const connected = await run(connectWallet("lace", { network: "mainnet", host }))

    expect(connected.wallet.name).toBe("Lace")
    expect(connected.network).toBe("mainnet")
    expect(connected.networkId).toBe(1)
    expect(connected.changeAddress).toBe(mainnetAddress.bech32)
    expect(typeof connected.api.signTx).toBe("function")
  })

  it("connects a test-network wallet to a preprod Slip", async () => {
    const host = hostWith({
      lace: stubProvider({ api: { getNetworkId: async () => 0, getChangeAddress: async () => testnetAddress.hex } })
    })
    const connected = await run(connectWallet("lace", { network: "preprod", host }))
    expect(connected.changeAddress).toBe(testnetAddress.bech32)
  })

  it("passes the extensions it was asked for through to the wallet", async () => {
    let asked: unknown
    const provider = stubProvider()
    const host = hostWith({
      lace: {
        ...provider,
        enable: async (extensions?: ReadonlyArray<{ readonly cip: number }>) => {
          asked = extensions
          return provider.enable(extensions)
        }
      }
    })
    await run(connectWallet("lace", { network: "mainnet", host, extensions: [{ cip: 95 }] }))
    expect(asked).toEqual([{ cip: 95 }])
  })

  it("says nothing is installed under a name nothing answers to", async () => {
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host: hostWith({}) }), "NotInjected")
    expect(error.message).toContain("lace")
  })

  it("separates that from a key holding something that is not a connector", async () => {
    // `window.cardano` is a namespace anything may write to, and telling a
    // person to install a wallet they already have sends them in a circle.
    const host = hostWith({ lace: { name: "Lace", apiVersion: "0.1.0" } })
    await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "NotCip30")
  })

  it("separates a declined connection from a failed one, and keeps the wallet's own code", async () => {
    // `-3` is a person saying no. Shown as a fault, it reads as the wallet being broken.
    const host = hostWith({ lace: stubProvider({ enableRejects: apiError(-3, "user declined") }) })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "Refused")
    expect(error.cip30).toEqual({ code: -3, info: "user declined" })
    expect(error.code).toBeUndefined()
  })

  it("reports any other enable failure as a failure, with the code preserved", async () => {
    const host = hostWith({ lace: stubProvider({ enableRejects: apiError(-2, "extension crashed") }) })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "EnableFailed")
    expect(error.cip30).toEqual({ code: -2, info: "extension crashed" })
    expect(error.detail).toContain("InternalError")
  })

  it("reports an enable that throws something other than an APIError", async () => {
    const host = hostWith({ lace: stubProvider({ enableRejects: new Error("boom") }) })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "EnableFailed")
    expect(error.cip30).toBeUndefined()
    expect(error.detail).toContain("boom")
  })

  it("refuses a wallet that enables without returning the API", async () => {
    const host = hostWith({ lace: stubProvider({ enableResolves: { getNetworkId: async () => 1 } }) })
    await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "NotCip30")
  })
})

describe("the two statements of network", () => {
  it("blocks a mainnet wallet on a preprod Slip", async () => {
    const host = hostWith({ lace: stubProvider() })
    const error = await expectRefusal(connectWallet("lace", { network: "preprod", host }), "WrongNetwork")
    expect(error.code).toBe("WRONG_NETWORK")
    expect(error.detail).toContain("preprod")
  })

  it("blocks a test-network wallet on a mainnet Slip", async () => {
    const host = hostWith({
      lace: stubProvider({ api: { getNetworkId: async () => 0, getChangeAddress: async () => testnetAddress.hex } })
    })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "WrongNetwork")
    expect(error.code).toBe("WRONG_NETWORK")
  })

  it("cannot tell preprod from preview, and does not pretend to", async () => {
    // Both are network 0 over CIP-30. Separating them is why a Slip states its
    // network by name, and why the endpoint checks all three statements again.
    const host = hostWith({
      lace: stubProvider({ api: { getNetworkId: async () => 0, getChangeAddress: async () => testnetAddress.hex } })
    })
    const connected = await run(connectWallet("lace", { network: "preview", host }))
    expect(connected.networkId).toBe(0)
  })

  it("refuses a wallet whose reported network contradicts its own change address", async () => {
    // Two answers about one wallet; neither can be taken at its word.
    const host = hostWith({
      lace: stubProvider({ api: { getNetworkId: async () => 1, getChangeAddress: async () => testnetAddress.hex } })
    })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "Unreadable")
    expect(error.detail).toContain("mainnet")
    expect(error.detail).toContain("test network")
  })
})

describe("a wallet that answers something unreadable", () => {
  it("refuses a network id outside the two CIP-30 defines", async () => {
    const host = hostWith({ lace: stubProvider({ api: { getNetworkId: async () => 7 } }) })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "Unreadable")
    expect(error.detail).toContain("7")
  })

  it("refuses a change address that is not an address", async () => {
    const host = hostWith({ lace: stubProvider({ api: { getChangeAddress: async () => "not-hex" } }) })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "Unreadable")
    expect(error.detail).toContain("getChangeAddress")
  })

  it("refuses a wallet whose method throws, keeping the code it threw", async () => {
    const host = hostWith({
      lace: stubProvider({ api: { getChangeAddress: () => Promise.reject(apiError(-4, "account changed")) } })
    })
    const error = await expectRefusal(connectWallet("lace", { network: "mainnet", host }), "Unreadable")
    expect(error.cip30).toEqual({ code: -4, info: "account changed" })
  })
})

describe("the refusals", () => {
  it("are every one this suite reaches", () => {
    // A state nothing can produce is a screen nobody sees.
    expect([...reached].sort()).toEqual(Object.keys(connectRefusals).sort())
  })
})
