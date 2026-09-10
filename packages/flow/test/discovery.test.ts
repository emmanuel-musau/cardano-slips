import { describe, expect, it } from "vitest"

import { discoverWallets, findWallet } from "../src/discovery.js"
import { knownWallet, knownWallets } from "../src/registry.js"
import { hostWith, stubProvider } from "./stub-wallet.js"

describe("discovery", () => {
  it("finds nothing where no wallet is injected", () => {
    expect(discoverWallets(hostWith({}))).toEqual([])
  })

  it("finds nothing where there is no cardano namespace at all", () => {
    // A page rendered on a server and a page with no wallet are one case here,
    // and neither is a failure.
    expect(discoverWallets({})).toEqual([])
    expect(discoverWallets({ cardano: "nonsense" })).toEqual([])
  })

  it("finds one wallet", () => {
    const found = discoverWallets(hostWith({ lace: stubProvider({ name: "lace" }) }))
    expect(found.map((wallet) => wallet.key)).toEqual(["lace"])
  })

  it("finds several, in a stable order", () => {
    const host = hostWith({
      vespr: stubProvider(),
      eternl: stubProvider(),
      lace: stubProvider()
    })
    expect(discoverWallets(host).map((wallet) => wallet.name)).toEqual(["Eternl", "Lace", "VESPR"])
  })

  it("names a known wallet from the registry, not from what it injects", () => {
    // One extension reads the same way in every list, whatever it calls itself.
    const [wallet] = discoverWallets(hostWith({ lace: stubProvider({ name: "lace" }) }))
    expect(wallet?.name).toBe("Lace")
    expect(wallet?.install).toBe(knownWallet("lace")?.install)
  })

  it("lets an unknown wallet name itself, and offers no install link for it", () => {
    const [wallet] = discoverWallets(hostWith({ newcomer: stubProvider({ name: "Newcomer" }) }))
    expect(wallet?.key).toBe("newcomer")
    expect(wallet?.name).toBe("Newcomer")
    expect(wallet?.install).toBeUndefined()
  })

  it("falls back to the key where an unknown wallet names itself nothing", () => {
    const [wallet] = discoverWallets(hostWith({ newcomer: stubProvider({ name: "" }) }))
    expect(wallet?.name).toBe("newcomer")
  })

  it("skips a key that is not a CIP-30 provider", () => {
    // `window.cardano` is a namespace anything may write to.
    const host = hostWith({
      lace: stubProvider(),
      typhon: { isEnabled: () => true },
      note: "not a wallet",
      nothing: null
    })
    expect(discoverWallets(host).map((wallet) => wallet.key)).toEqual(["lace"])
  })

  it("shows one entry for an extension that injects two keys", () => {
    const host = hostWith({ eternl: stubProvider(), ccvault: stubProvider() })
    expect(discoverWallets(host).map((wallet) => wallet.key)).toEqual(["eternl"])
  })

  it("keeps the alias where the extension injects only that key", () => {
    // An older build injects `ccvault` alone, and it is still the wallet.
    const [wallet] = discoverWallets(hostWith({ ccvault: stubProvider() }))
    expect(wallet?.key).toBe("ccvault")
    expect(wallet?.name).toBe("Eternl")
  })

  it("carries the icon and the extensions the provider declares", () => {
    const host = hostWith({
      lace: stubProvider({ icon: "data:image/png;base64,AAA", supportedExtensions: [{ cip: 95 }] })
    })
    const [wallet] = discoverWallets(host)
    expect(wallet?.icon).toBe("data:image/png;base64,AAA")
    expect(wallet?.extensions).toEqual([95])
  })

  it("reports no icon rather than an empty one", () => {
    const [wallet] = discoverWallets(hostWith({ lace: stubProvider({ icon: "" }) }))
    expect(wallet?.icon).toBeUndefined()
  })
})

describe("finding one wallet by key", () => {
  it("returns it", () => {
    expect(findWallet("lace", hostWith({ lace: stubProvider() }))?.name).toBe("Lace")
  })

  it("returns nothing for a key that is absent or unusable", () => {
    expect(findWallet("lace", hostWith({}))).toBeUndefined()
    expect(findWallet("lace", hostWith({ lace: {} }))).toBeUndefined()
    expect(findWallet("lace", {})).toBeUndefined()
  })
})

describe("the registry", () => {
  it("gives every entry a name and an install link", () => {
    for (const wallet of knownWallets) {
      expect(wallet.name).not.toBe("")
      expect(wallet.install.startsWith("https://")).toBe(true)
    }
  })

  it("points every alias at an entry that exists", () => {
    const keys = new Set(knownWallets.map((wallet) => wallet.key))
    for (const wallet of knownWallets) {
      if (wallet.aliasOf !== undefined) expect(keys.has(wallet.aliasOf)).toBe(true)
    }
  })

  it("has no duplicate keys", () => {
    expect(new Set(knownWallets.map((wallet) => wallet.key)).size).toBe(knownWallets.length)
  })
})
