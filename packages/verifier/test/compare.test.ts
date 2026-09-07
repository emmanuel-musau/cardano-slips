import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { Comparison, Reason, Verdict } from "../src/compare.js"
import { compare } from "../src/compare.js"
import type { ComparisonRefusal } from "../src/compare-error.js"
import { comparisonRefusals } from "../src/compare-error.js"
import type { CertificateEffect } from "../src/derive.js"
import { minimumChangeLovelace, minimumFee } from "../src/minimums.js"
import { decodeBech32 } from "../src/bech32.js"
import { mainnetParameters } from "./support/derivation.js"
import { cases, comparisonOf } from "./support/verdicts.js"

/**
 * What the published table does not reach. The table is the specification's own
 * behaviour and runs in `verdicts.test.ts`; these are the cases an
 * implementation still has to answer for, starting from one of its honest ones.
 */

const honest = (): Comparison => comparisonOf(cases.find((entry) => entry.verdict === "sign")!)

const verdictOf = (comparison: Comparison): Verdict => {
  const result = compare(comparison)
  if (Either.isLeft(result)) throw new Error(`it refused to compare: ${result.left.message}`)
  return result.right
}

const codesOf = (comparison: Comparison): Array<Reason["code"]> => {
  const verdict = verdictOf(comparison)
  return verdict._tag === "match" ? [] : [...new Set(verdict.reasons.map((reason) => reason.code))].sort()
}

const refusalOf = (comparison: Comparison): ComparisonRefusal => {
  const result = compare(comparison)
  if (Either.isRight(result)) throw new Error("it produced a verdict")
  return result.left.refusal
}

const ceilingOf = (comparison: Comparison): bigint => {
  const change = decodeBech32(comparison.changeAddress)
  if (Either.isLeft(change)) throw new Error(comparison.changeAddress)
  return (
    minimumFee(comparison.effects.size, mainnetParameters) +
    minimumChangeLovelace(change.right.bytes, mainnetParameters)
  )
}

describe("the fee ceiling", () => {
  it("signs a fee exactly at the ceiling", () => {
    // The remainder after paying everything was too small to return as change,
    // so the balancer added it to the fee. That is the one legitimate reason to
    // exceed what the transaction costs, and it is allowed exactly this far.
    const base = honest()
    expect(codesOf({ ...base, effects: { ...base.effects, fee: ceilingOf(base) } })).toEqual([])
  })

  it("blocks the next lovelace past it", () => {
    const base = honest()
    expect(codesOf({ ...base, effects: { ...base.effects, fee: ceilingOf(base) + 1n } })).toEqual(["fee.excessive"])
  })

  it("rises with the transaction's size, because a larger transaction costs more to submit", () => {
    const base = honest()
    const larger = { ...base, effects: { ...base.effects, size: base.effects.size + 100 } }
    expect(ceilingOf(larger) - ceilingOf(base)).toBe(mainnetParameters.minFeeCoefficient * 100n)
  })
})

describe("the present moment", () => {
  it("comes from the argument, so the same transaction answers the same way twice", () => {
    // A gate that read a clock would answer differently depending on when it
    // was asked, and nothing in the package may consult one.
    const base = honest()
    const validFrom = { slot: 0n, time: 2_000_000_000_000n }
    const effects = { ...base.effects, validity: { ...base.effects.validity, validFrom } }
    expect(codesOf({ ...base, effects, now: validFrom.time - 1n })).toEqual(["interval.not-yet-valid"])
    expect(codesOf({ ...base, effects, now: validFrom.time })).toEqual([])
  })
})

describe("the declared deadline", () => {
  const ending = (validUntil: Comparison["effects"]["validity"]["validUntil"]): Comparison => {
    const base = honest()
    return { ...base, effects: { ...base.effects, validity: { ...base.effects.validity, validUntil } } }
  }

  it("signs a body ending exactly on it", () => {
    const base = honest()
    expect(codesOf(ending(base.effects.validity.validUntil))).toEqual([])
  })

  it("blocks a body carrying no end at all", () => {
    // Not an exception to the rule but the extreme of it: a transaction with no
    // end never stops being submittable, by whoever obtains it, which is later
    // than any instant the intent could have named.
    const verdict = verdictOf(ending(null))
    expect(verdict).toEqual({
      _tag: "mismatch",
      reasons: [{ code: "interval.beyond-declared", validUntil: null, declared: expect.any(BigInt) }]
    })
  })
})

describe("a stake registration", () => {
  const registration = (kind: CertificateEffect["kind"]): Comparison => {
    const base = honest()
    const certificate: CertificateEffect = {
      kind,
      credential: { _tag: "KeyHash", hash: new Uint8Array(28) },
      role: "stake",
      ours: true,
      pool: null,
      drep: null,
      deposit: null,
      refund: null,
      index: 0
    }
    return {
      ...base,
      declared: { ...base.declared, outputs: undefined, certificates: [{ type: "stakeRegistration" }] },
      effects: {
        ...base.effects,
        outputs: base.effects.outputs.filter((output) => output.mine),
        certificates: [certificate]
      }
    }
  }

  it.each(["StakeRegistration", "Registration"] as const)("is answered by the %s encoding", (kind) => {
    // Both register the same credential; the Conway form states the deposit the
    // ledger fixes anyway. Refusing the newer one would block honest work.
    expect(codesOf(registration(kind))).toEqual([])
  })

  it("is not answered by a certificate that also delegates", () => {
    // One certificate doing two things is not the thing that was declared, and
    // the second thing is exactly what nobody was shown.
    expect(codesOf(registration("StakeRegistrationDelegation"))).toEqual([
      "certificate.missing",
      "certificate.undeclared"
    ])
  })
})

describe("a declaration the comparison cannot read", () => {
  // Not a mismatch: nothing was found to disagree with the transaction, so
  // saying it lied would tell a person something that did not happen.

  const cases: ReadonlyArray<readonly [ComparisonRefusal, () => Comparison]> = [
    [
      "DeclaredAddress",
      () => {
        const base = honest()
        return { ...base, declared: { ...base.declared, outputs: [{ address: "addr1notanaddress", lovelace: "1" }] } }
      }
    ],
    [
      "DeclaredPool",
      () => {
        const base = honest()
        return {
          ...base,
          declared: { ...base.declared, certificates: [{ type: "stakeDelegation", poolId: "pool1notapool" }] }
        }
      }
    ],
    [
      "DeclaredDRep",
      () => {
        const base = honest()
        return {
          ...base,
          declared: { ...base.declared, certificates: [{ type: "voteDelegation", drep: "drep1notadrep" }] }
        }
      }
    ],
    [
      "DeclaredInstant",
      () => {
        const base = honest()
        return { ...base, declared: { ...base.declared, validUntil: "the end of the month" } }
      }
    ],
    ["ChangeAddress", () => ({ ...honest(), changeAddress: "addr1notanaddress" })]
  ]

  it.each(cases)("refuses to compare against %s", (refusal, build) => {
    expect(refusalOf(build())).toBe(refusal)
  })

  it("reaches every refusal the vocabulary names", () => {
    // A refusal nothing can reach is a branch nobody has read.
    expect(cases.map(([refusal]) => refusal).sort()).toEqual(
      (Object.keys(comparisonRefusals) as Array<ComparisonRefusal>).sort()
    )
  })
})
