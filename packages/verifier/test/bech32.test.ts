import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { decodeBech32, encodeBech32 } from "../src/bech32.js"
import { toHex } from "../src/bytes.js"

/**
 * The one place a declared address becomes bytes. Everything the comparison
 * says about who is paid rests on this reading being exact, so the refusals
 * matter as much as the round trip.
 */

const mainnetPayment =
  "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"
const testnetPayment =
  "addr_test1qzettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsrnz5s0"
const rewardAccount = "stake1u8q3q00cvtd82drw0zp29czqs06yqu898c2vgyje03ldmfgh40x27"
const poolId = "pool1ayfz9ymjutjzx0a33q8tq6zrn8lj3ckmzp69c9vxk8kyxylly5y"

const decoded = (text: string): { readonly prefix: string; readonly bytes: Uint8Array } => {
  const result = decodeBech32(text)
  if (Either.isLeft(result)) throw new Error(`${text} was refused: ${result.left.detail}`)
  return result.right
}

const refusalOf = (text: string): string => {
  const result = decodeBech32(text)
  if (Either.isRight(result)) throw new Error(`${text} was accepted`)
  return result.left.refusal
}

describe("reading bech32", () => {
  it.each([
    ["a mainnet payment address", mainnetPayment, "addr", 57],
    ["a testnet payment address", testnetPayment, "addr_test", 57],
    ["a reward account", rewardAccount, "stake", 29],
    ["a pool id", poolId, "pool", 28]
  ])("reads %s", (_what, text, prefix, length) => {
    const { bytes, prefix: read } = decoded(text)
    expect(read).toBe(prefix)
    expect(bytes.length).toBe(length)
  })

  it("accepts a string past the 90 characters BIP-173 allows", () => {
    // CIP-19 drops the limit, and every Cardano base address is over it. A
    // reader that keeps the limit rejects every address this protocol carries.
    expect(mainnetPayment.length).toBeGreaterThan(90)
    expect(decoded(mainnetPayment).bytes.length).toBe(57)
  })

  it("refuses a string whose checksum does not verify", () => {
    // One character changed: the string is still well-formed and still decodes
    // to bytes, which is exactly why the checksum has to be checked.
    const tampered = `${mainnetPayment.slice(0, -1)}${mainnetPayment.endsWith("s") ? "q" : "s"}`
    expect(refusalOf(tampered)).toBe("BadChecksum")
  })

  it.each([
    ["a character outside the charset", "addr1bqqqqqqqqqq"],
    ["no separator at all", "addrqqqqqqqqqqqq"],
    ["nothing before the separator", "1qqqqqqqqqqqqq"],
    ["a data part shorter than its checksum", "addr1qqq"],
    ["mixed case", mainnetPayment.toUpperCase()]
  ])("refuses %s", (_what, text) => {
    expect(refusalOf(text)).toBe("Malformed")
  })

  it("refuses a data part that leaves a whole group of padding", () => {
    // Five bits of data and a valid checksum. BIP-173 calls this invalid
    // because it lets one set of bytes be written two ways, and an address
    // with two spellings is one a comparison can be walked past.
    expect(refusalOf("addr1qps5c0s")).toBe("Malformed")
  })
})

describe("writing bech32", () => {
  it.each([mainnetPayment, testnetPayment, rewardAccount, poolId])("writes %s back exactly as it arrived", (text) => {
    const { bytes, prefix } = decoded(text)
    expect(encodeBech32(prefix, bytes)).toBe(text)
  })

  it("round-trips arbitrary bytes at every length a remainder can take", () => {
    // Five bits into eight leaves a different remainder at each length, and the
    // padding rule is where a hand-written implementation goes wrong.
    for (let length = 1; length <= 64; length++) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256)
      const written = encodeBech32("addr", bytes)
      expect(toHex(decoded(written).bytes), `${length} bytes`).toBe(toHex(bytes))
    }
  })

  it("writes an empty byte string as a prefix and a checksum", () => {
    const written = encodeBech32("addr", new Uint8Array())
    expect(decoded(written).bytes.length).toBe(0)
  })
})
