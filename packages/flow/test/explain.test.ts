import { type Reason, type ReasonCode, reasonCodes } from "@cardano-slips/verifier"
import { describe, expect, it } from "vitest"

import {
  assetLabel,
  explainReason,
  formatAda,
  formatCountdown,
  formatInstant,
  formatQuantity,
  secondsLeft,
  shortened
} from "../src/explain.js"

/**
 * The words the effects panel puts in front of a person. Every figure is exact:
 * a rounded amount is an amount nobody declared, and a token's decimals are
 * never guessed (the CIP, "Outputs").
 */

const shop = "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"
const usdm = { policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128", assetName: "5553444d" }
const expiry = BigInt(Date.parse("2026-08-22T19:40:00Z"))

describe("ADA", () => {
  it("is exact to the lovelace, with nothing rounded", () => {
    expect(formatAda(1n)).toBe("0.000001 ADA")
    expect(formatAda(170_837n)).toBe("0.170837 ADA")
    expect(formatAda(12_170_837n)).toBe("12.170837 ADA")
  })

  it("drops only the zeros that say nothing", () => {
    expect(formatAda(12_000_000n)).toBe("12 ADA")
    expect(formatAda(12_500_000n)).toBe("12.5 ADA")
    expect(formatAda(0n)).toBe("0 ADA")
  })

  it("groups the thousands, past the point a double would lose count", () => {
    expect(formatAda(45_000_000_000_000_000n)).toBe("45,000,000,000 ADA")
    expect(formatAda(9_007_199_254_740_993n)).toBe("9,007,199,254.740993 ADA")
  })

  it("states the size and leaves the direction to the words around it", () => {
    // "You pay" and "you receive" carry the sign; a minus in front of a figure is easy to miss.
    expect(formatAda(-2_000_000n)).toBe("2 ADA")
  })
})

describe("a token quantity", () => {
  it("is shown in base units, since its decimals are never guessed", () => {
    expect(formatQuantity(12_000_000n)).toBe("12,000,000")
    expect(formatQuantity(18_446_744_073_709_551_615n)).toBe("18,446,744,073,709,551,615")
    expect(formatQuantity(-5n)).toBe("5")
  })

  it("is named by its asset name where that name is text", () => {
    expect(assetLabel(usdm.assetName)).toBe("USDM")
  })

  it("has no name to show where the asset name is not readable text", () => {
    // Bytes rendered as a lookalike string are a name nobody chose.
    expect(assetLabel("")).toBeNull()
    expect(assetLabel("00ff")).toBeNull()
    expect(assetLabel("5553440a")).toBeNull()
  })
})

describe("time", () => {
  it("gives an instant in UTC, so two people reading it read the same moment", () => {
    expect(formatInstant(expiry)).toBe("22 Aug 2026, 19:40 UTC")
  })

  it("counts down to the expiry and stops at zero", () => {
    expect(secondsLeft(expiry, expiry - 90_500n)).toBe(90)
    expect(secondsLeft(expiry, expiry)).toBe(0)
    expect(secondsLeft(expiry, expiry + 1_000n)).toBe(0)
  })

  it("reads a countdown the way the sheet's clock does, with hours in front once there are any", () => {
    expect(formatCountdown(0)).toBe("0m 00s")
    expect(formatCountdown(47)).toBe("0m 47s")
    expect(formatCountdown(252)).toBe("4m 12s")
    expect(formatCountdown(3_723)).toBe("1h 02m 03s")
  })
})

describe("a bech32 string in a column", () => {
  it("keeps the prefix, three characters and the last four", () => {
    expect(shortened(shop)).toBe("addr1qxe…l5us")
    expect(shortened("pool1ayfz9ymjutjzx0a33q8tq6zrn8lj3ckmzp69c9vxk8kyxylly5y")).toBe("pool1ayf…ly5y")
  })

  it("leaves a string that is already short, or not bech32, as it is", () => {
    expect(shortened("abstain")).toBe("abstain")
    expect(shortened("addr1qxettqnd")).toBe("addr1qxettqnd")
  })
})

/** One reason of every kind the verifier can report. Keyed by code, so a new code without a case fails to compile. */
const oneOfEach: { readonly [code in ReasonCode]: Extract<Reason, { code: code }> } = {
  "output.missing": { code: "output.missing", address: shop, declared: 2, paid: 1 },
  "output.undeclared": { code: "output.undeclared", address: shop, declared: 0, paid: 1 },
  "output.lovelace": { code: "output.lovelace", address: shop, declared: 12_000_000n, paid: 120_000_000n },
  "output.assets": { code: "output.assets", address: shop, ...usdm, declared: 12_000_000n, paid: 1_200_000_000n },
  "certificate.missing": { code: "certificate.missing", declared: 1, carried: 0 },
  "certificate.undeclared": { code: "certificate.undeclared", declared: 0, carried: 1 },
  "certificate.order": { code: "certificate.order" },
  "certificate.target": { code: "certificate.target", index: 0, declared: "pool1declared", carried: "pool1carried" },
  "certificate.credential": { code: "certificate.credential", index: 1 },
  "certificate.deposit": { code: "certificate.deposit", index: 0, stated: 5_000_000n, parameter: 2_000_000n },
  "withdrawal.missing": { code: "withdrawal.missing" },
  "withdrawal.undeclared": { code: "withdrawal.undeclared", carried: 1 },
  "withdrawal.account": { code: "withdrawal.account", account: "stake1stranger" },
  "mint.undeclared": { code: "mint.undeclared", assets: [{ ...usdm, quantity: 5n }] },
  "body.unsupported": { code: "body.unsupported", members: ["collateral", "script"] },
  "fee.excessive": { code: "fee.excessive", fee: 9_000_000n, ceiling: 250_000n },
  "interval.beyond-declared": { code: "interval.beyond-declared", validUntil: null, declared: expiry },
  "interval.not-yet-valid": { code: "interval.not-yet-valid", validFrom: expiry, now: expiry - 60_000n }
}

describe("a mismatch reason", () => {
  it("has a sentence for every reason the verifier can report", () => {
    expect(Object.keys(oneOfEach).sort()).toEqual(Object.keys(reasonCodes).sort())
    const silent = Object.values(oneOfEach).filter((reason) => explainReason(reason).summary.trim() === "")
    expect(silent).toEqual([])
  })

  it("never shows a reason code in place of words", () => {
    // The person needs to see the difference, not which rule fired (the CIP, "No override").
    const leaked = Object.values(oneOfEach).filter((reason) => {
      const { actual, declared, summary } = explainReason(reason)
      return [summary, declared, actual].some((text) => text?.includes(reason.code))
    })
    expect(leaked).toEqual([])
  })

  it("puts what was asked for beside what the transaction does", () => {
    expect(explainReason(oneOfEach["output.lovelace"])).toEqual({
      summary: "The transaction pays a different amount of ADA from the one the link asks for.",
      declared: "12 ADA",
      actual: "120 ADA",
      where: shop
    })
  })

  it("holds the transaction to the link, as the sheet words it, and never to the Slip", () => {
    const worded = Object.values(oneOfEach).map((reason) => explainReason(reason).summary)
    expect(worded.filter((summary) => /\bSlip\b/.test(summary))).toEqual([])
    expect(worded.filter((summary) => summary.includes("link")).length).toBeGreaterThan(10)
  })

  it("keeps an address out of the sentence and gives it in full beside it", () => {
    // A sentence wraps an address wherever it likes; `where` is set on its own line.
    const withAddress = Object.values(oneOfEach).filter((reason) => explainReason(reason).summary.includes("addr1"))
    expect(withAddress).toEqual([])
    expect(explainReason(oneOfEach["output.undeclared"]).where).toBe(shop)
    expect(explainReason(oneOfEach["withdrawal.account"]).where).toBe("stake1stranger")
  })

  it("names a token by its asset name and gives its quantity in base units", () => {
    const { actual, declared } = explainReason(oneOfEach["output.assets"])
    expect(declared).toBe("12,000,000 USDM")
    expect(actual).toBe("1,200,000,000 USDM")
  })

  it("names a token by its policy where its asset name is not text", () => {
    const { actual } = explainReason({ ...oneOfEach["output.assets"], assetName: "00ff" })
    expect(actual).toBe(`1,200,000,000 of token 00ff under policy ${usdm.policyId}`)
  })

  it("says a transaction that never expires never expires", () => {
    const { actual, declared } = explainReason(oneOfEach["interval.beyond-declared"])
    expect(declared).toBe("Until 22 Aug 2026, 19:40 UTC")
    expect(actual).toBe("Never expires")
  })

  it("lists what a Slip cannot describe in words, not in field names", () => {
    const { summary } = explainReason(oneOfEach["body.unsupported"])
    expect(summary).toContain("collateral")
    expect(summary).toContain("runs a script")
  })

  it("counts certificates from one, the way a person counts them", () => {
    expect(explainReason(oneOfEach["certificate.credential"]).summary).toContain("Certificate 2")
  })

  it("says which tokens a transaction creates and which it destroys", () => {
    const { actual } = explainReason({
      code: "mint.undeclared",
      assets: [
        { ...usdm, quantity: 5n },
        { ...usdm, quantity: -7n }
      ]
    })
    expect(actual).toBe("Creates 5 USDM, Destroys 7 USDM")
  })

  it("holds the fee against its ceiling", () => {
    const { actual, declared } = explainReason(oneOfEach["fee.excessive"])
    expect(declared).toBe("At most 0.25 ADA")
    expect(actual).toBe("9 ADA")
  })
})
