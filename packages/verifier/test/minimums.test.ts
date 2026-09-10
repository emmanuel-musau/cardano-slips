import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { decodeBech32 } from "../src/bech32.js"
import { minimumChangeLovelace, minimumFee, minimumLovelace } from "../src/minimums.js"
import { mainnetParameters } from "./support/derivation.js"

/**
 * The two bounds the gate enforces. Both are computed rather than supplied,
 * because a caller allowed to work them out could work them out generously and
 * the fee ceiling is where an undeclared payment would hide.
 */

const bytesOf = (text: string): Uint8Array => {
  const decoded = decodeBech32(text)
  if (Either.isLeft(decoded)) throw new Error(text)
  return decoded.right.bytes
}

const baseAddress =
  "addr1qxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjynn4lleg4u9dpmgh74jap9ef7587khxr79r430d4gkalfwsl0vysa"
const enterpriseAddress = "addr1vxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjyseeq605"

describe("the minimum fee", () => {
  it("is the coefficient over the size plus the constant", () => {
    // Mainnet epoch 651: 44 lovelace a byte over 155381. A 352-byte transaction
    // is the one the CIP's published verdicts are priced at.
    expect(minimumFee(352, mainnetParameters)).toBe(170_869n)
  })

  it("charges the constant on a transaction of no size at all", () => {
    expect(minimumFee(0, mainnetParameters)).toBe(mainnetParameters.minFeeConstant)
  })

  it("rises with every byte, so a larger transaction never costs less", () => {
    for (let size = 0; size < 2000; size += 137) {
      expect(minimumFee(size + 1, mainnetParameters) - minimumFee(size, mainnetParameters)).toBe(
        mainnetParameters.minFeeCoefficient
      )
    }
  })
})

describe("an output's minimum ADA", () => {
  it("is the per-byte cost over the output's own bytes plus the ledger's overhead", () => {
    // 65 bytes is an ADA-only output to a base address, and 0.969750 ADA is the
    // figure mainnet has quoted for one since Babbage.
    expect(minimumLovelace(65, mainnetParameters)).toBe(969_750n)
  })

  it("is higher for an output carrying assets", () => {
    // 114 bytes: the same output with one policy and one asset name on it.
    expect(minimumLovelace(114, mainnetParameters)).toBe(1_180_940n)
    expect(minimumLovelace(114, mainnetParameters)).toBeGreaterThan(minimumLovelace(65, mainnetParameters))
  })
})

describe("the change output's minimum ADA", () => {
  it("lands on the quoted mainnet figure for a base address", () => {
    expect(minimumChangeLovelace(bytesOf(baseAddress), mainnetParameters)).toBe(969_750n)
  })

  it("is smaller for a shorter address, because the output is shorter", () => {
    const enterprise = minimumChangeLovelace(bytesOf(enterpriseAddress), mainnetParameters)
    expect(enterprise).toBeLessThan(minimumChangeLovelace(bytesOf(baseAddress), mainnetParameters))
    expect(enterprise).toBe(minimumLovelace(1 + 2 + 29 + 5, mainnetParameters))
  })

  it("settles on an amount that pays for its own encoding", () => {
    // The answer is part of what it is measured from: a wider CBOR integer
    // makes the output longer, which raises the minimum again. Anything that
    // did not settle would be a bound that changes each time it is asked.
    for (const address of [baseAddress, enterpriseAddress]) {
      const bytes = bytesOf(address)
      const settled = minimumChangeLovelace(bytes, mainnetParameters)
      const width = settled < 0x1_0000_0000n ? 5 : 9
      expect(settled).toBe(minimumLovelace(1 + 2 + bytes.length + width, mainnetParameters))
    }
  })
})
