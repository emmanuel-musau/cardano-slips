// @vitest-environment node

import { describe, expect, it } from "vitest"

/**
 * This SDK is imported by pages we do not control, and a large share of them
 * are rendered on a server. A module that reads `window` while loading throws
 * there before any of our code runs — the failure that ruled out
 * connect-with-wallet-core (ADR-0004). Node environment, no DOM: this file
 * fails if anyone reintroduces module-scope browser access.
 */

describe("the package outside a browser", () => {
  it("has no browser globals to read", () => {
    expect(typeof globalThis.window).toBe("undefined")
    expect(typeof globalThis.document).toBe("undefined")
  })

  it("imports", async () => {
    const flow = await import("../src/index.js")
    expect(typeof flow.discoverWallets).toBe("function")
  })

  it("finds no wallet and does not throw looking", async () => {
    const { discoverWallets, findWallet } = await import("../src/index.js")
    expect(discoverWallets()).toEqual([])
    expect(findWallet("lace")).toBeUndefined()
  })

  it("fails a connection rather than throwing", async () => {
    const { connectWallet } = await import("../src/index.js")
    const { Effect, Either } = await import("effect")
    const result = await Effect.runPromise(Effect.either(connectWallet("lace", { network: "mainnet" })))
    expect(Either.isLeft(result)).toBe(true)
  })
})
