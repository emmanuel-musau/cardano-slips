import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { readOwnAddress, readWalletAddress } from "../src/address.js"
import { enterpriseAddress, mainnetAddress, testnetAddress } from "./stub-wallet.js"

const detail = (hex: string): string => {
  const result = readWalletAddress(hex)
  expect(Either.isLeft(result)).toBe(true)
  return Either.isLeft(result) ? result.left : ""
}

describe("reading the address CIP-30 returns", () => {
  it("writes a mainnet base address back as bech32", () => {
    expect(readWalletAddress(mainnetAddress.hex)).toEqual(Either.right({ bech32: mainnetAddress.bech32, networkId: 1 }))
  })

  it("writes a testnet base address back as bech32", () => {
    expect(readWalletAddress(testnetAddress.hex)).toEqual(Either.right({ bech32: testnetAddress.bech32, networkId: 0 }))
  })

  it("reads an enterprise address, which has no stake part", () => {
    expect(readWalletAddress(enterpriseAddress.hex)).toEqual(
      Either.right({ bech32: enterpriseAddress.bech32, networkId: 1 })
    )
  })

  it("reads the address whether or not the wallet wrapped it in CBOR", () => {
    // CIP-30 calls the value "the CBOR of the address" and wallets ship the
    // bytes bare. `0x58` cannot be an address header, so there is no ambiguity.
    const wrapped = `5839${mainnetAddress.hex}`
    expect(readWalletAddress(wrapped)).toEqual(readWalletAddress(mainnetAddress.hex))
  })

  it("accepts upper case hex and surrounding space", () => {
    expect(readWalletAddress(` ${mainnetAddress.hex.toUpperCase()} `)).toEqual(
      Either.right({ bech32: mainnetAddress.bech32, networkId: 1 })
    )
  })

  it("refuses a value that is not hex", () => {
    expect(detail("nonsense")).toContain("not hex")
    expect(detail(mainnetAddress.hex.slice(0, -1))).toContain("not hex")
    expect(detail("")).toContain("not hex")
  })

  it("refuses a header naming a network that does not exist", () => {
    // Byron addresses are CBOR arrays: `0x82` reads as network 2 and stops here.
    expect(detail(`82${"ab".repeat(28)}`)).toContain("network 2")
  })

  it("refuses a reward address, which cannot receive change", () => {
    expect(detail(`e1${"ab".repeat(28)}`)).toContain("address type 14")
  })

  it("refuses an address of the wrong length for its type", () => {
    // The bech32 comes out well-formed and is still not an address; the
    // `BuildRequest` schema in `core` is what settles it.
    expect(detail(`01${"ab".repeat(20)}`)).toContain("not a payment address")
  })
})

describe("reading an address the wallet calls its own", () => {
  const read = (hex: unknown) => {
    const result = readOwnAddress(hex)
    if (Either.isLeft(result)) throw new Error(result.left)
    return result.right
  }

  const refusal = (hex: unknown): string => {
    const result = readOwnAddress(hex)
    expect(Either.isLeft(result)).toBe(true)
    return Either.isLeft(result) ? result.left : ""
  }

  it("reads a payment address to its raw bytes and network", () => {
    const address = read(mainnetAddress.hex)

    expect(address.bytes).toHaveLength(57)
    expect(address.networkId).toBe(1)
    expect(read(testnetAddress.hex).networkId).toBe(0)
    expect(read(enterpriseAddress.hex).bytes).toHaveLength(29)
  })

  it("reads a reward account, which the change address reader refuses", () => {
    const account = read(`e1${"ab".repeat(28)}`)

    expect(account.bytes[0]).toBe(0xe1)
    expect(account.networkId).toBe(1)
  })

  it("reads the address whether or not the wallet wrapped it in CBOR", () => {
    expect(read(`581d61${"ab".repeat(28)}`).bytes).toEqual(read(`61${"ab".repeat(28)}`).bytes)
  })

  it("reads a Byron address as it is, since its header names no network", () => {
    const byron = read(`82d818582183581c${"ab".repeat(28)}a0001a12345678`)

    expect(byron.networkId).toBeUndefined()
    expect(byron.bytes[0]).toBe(0x82)
  })

  it.each([
    ["a value that is not hex", "zz", "not hex"],
    ["a value that is not a string", 42, "not hex"],
    ["a header naming a network that does not exist", `05${"ab".repeat(56)}`, "network 5"],
    ["a header type no address uses", `91${"ab".repeat(28)}`, "type 9"],
    ["a base address cut short", `01${"ab".repeat(28)}`, "wrong length"],
    ["a reward account with a second hash", `e1${"ab".repeat(56)}`, "wrong length"]
  ])("refuses %s", (_, hex, expected) => {
    expect(refusal(hex)).toContain(expected)
  })
})
