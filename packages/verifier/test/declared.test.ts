import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { readAddress, readDRep, readInstant, readPool } from "../src/declared.js"

/**
 * Reading the endpoint's own strings. Each refusal here is a declaration the
 * comparison cannot read, which is an endpoint sending something malformed
 * rather than something untrue — a client reports it as `MALFORMED_RESPONSE`
 * and never as a mismatch.
 */

const address =
  "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"
const poolId = "pool1ayfz9ymjutjzx0a33q8tq6zrn8lj3ckmzp69c9vxk8kyxylly5y"
const rewardAccount = "stake1u8q3q00cvtd82drw0zp29czqs06yqu898c2vgyje03ldmfgh40x27"
/** CIP-129: a header byte then the credential. `0x22` is a key, `0x23` a script. */
const drep129 = "drep1y2wfmxsjt7786qc663mts7qh5m9nzn27qjzrpuglaq6wsgqws500e"
/** CIP-105 wrote the same DRep as the 28-byte key hash alone. */
const drep105 = "drep1njwe5yjlh37sxxk5w6u8s9axevc56hsyssc0z8lgxn5zqudg2nc"

const refusalOf = <A>(result: Either.Either<A, { readonly refusal: string }>): string => {
  if (Either.isRight(result)) throw new Error("it was accepted")
  return result.left.refusal
}

const valueOf = <A>(result: Either.Either<A, { readonly message: string }>): A => {
  if (Either.isLeft(result)) throw new Error(result.left.message)
  return result.right
}

describe("a declared address", () => {
  it("reads as the bytes a body output would carry, and as the same text back", () => {
    const read = valueOf(readAddress(address))
    expect(read.bytes.length).toBe(57)
    expect(read.text).toBe(address)
  })

  it("refuses one whose checksum does not verify", () => {
    expect(refusalOf(readAddress(`${address.slice(0, -1)}q`))).toBe("DeclaredAddress")
  })

  it("refuses a reward account, which is not an address anything can be paid to", () => {
    expect(refusalOf(readAddress(rewardAccount))).toBe("DeclaredAddress")
  })
})

describe("a declared pool", () => {
  it("reads as the token a body certificate's pool hash writes to", () => {
    expect(valueOf(readPool(poolId))).toBe(poolId)
  })

  it("refuses a hash of the wrong length, whatever its checksum says", () => {
    // The bytes below check out as bech32 and are not a pool id.
    expect(refusalOf(readPool("pool1qps5c0s"))).toBe("DeclaredPool")
  })

  it("refuses an identifier from another namespace", () => {
    expect(refusalOf(readPool(drep129))).toBe("DeclaredPool")
  })
})

describe("a declared DRep", () => {
  it("reads the two predefined votes as themselves", () => {
    expect(valueOf(readDRep("abstain"))).toBe("abstain")
    expect(valueOf(readDRep("noConfidence"))).toBe("noConfidence")
  })

  it("reads a CIP-129 id as the credential its header names", () => {
    expect(valueOf(readDRep(drep129))).toMatch(/^key\.[0-9a-f]{56}$/)
  })

  it("reads a CIP-105 id as the same key, so an honest delegation is not blocked over a spelling", () => {
    // The older form wrote the 28-byte key hash alone. Both name one DRep.
    const cip129 = valueOf(readDRep(drep129))
    const cip105 = valueOf(readDRep(drep105))
    expect(cip105).toBe(cip129)
  })

  it("refuses an id that is neither length", () => {
    expect(refusalOf(readDRep("drep1qps5c0s"))).toBe("DeclaredDRep")
  })
})

describe("a declared instant", () => {
  it("reads UTC to the second as Unix milliseconds", () => {
    expect(valueOf(readInstant("1970-01-01T00:00:00Z"))).toBe(0n)
    expect(valueOf(readInstant("2026-08-22T19:40:00Z"))).toBe(1_787_427_600_000n)
  })

  it("reads a leap day, and refuses the same date in a year that has none", () => {
    expect(valueOf(readInstant("2024-02-29T00:00:00Z"))).toBeGreaterThan(0n)
    expect(refusalOf(readInstant("2026-02-29T00:00:00Z"))).toBe("DeclaredInstant")
  })

  it.each([
    "2026-02-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-08-22T24:00:00Z",
    "2026-08-22T19:60:00Z",
    "2026-08-22T19:40:00+01:00",
    "2026-08-22T19:40:00.000Z",
    "not an instant"
  ])("refuses %s", (text) => {
    expect(refusalOf(readInstant(text))).toBe("DeclaredInstant")
  })

  it("orders instants the way the calendar does, across a century boundary", () => {
    // The conversion is written out rather than reached for through `Date`, so
    // the leap rules are this package's own and have to be checked.
    const instants = [
      "1899-12-31T23:59:59Z",
      "1900-03-01T00:00:00Z",
      "1999-12-31T23:59:59Z",
      "2000-02-29T12:00:00Z",
      "2100-03-01T00:00:00Z"
    ].map((text) => valueOf(readInstant(text)))
    expect(instants).toEqual([...instants].sort((left, right) => (left < right ? -1 : 1)))
  })
})
