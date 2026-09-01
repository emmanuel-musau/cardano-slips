/**
 * The three places a derivation refuses rather than guesses. Each one is a case
 * where carrying on would show a person a number the transaction does not
 * support, which is worse than showing them nothing. Every case runs against
 * both derivations: they share one resolution step today, and this is what
 * fails if either grows its own.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { DerivationError, DerivationRefusal } from "../src/derive-error.js"
import { derivationRefusals } from "../src/derive-error.js"
import type { AssetEffects, Derivation, LovelaceEffects } from "../src/derive.js"
import { deriveAssets, deriveLovelace } from "../src/derive.js"
import { fromHex } from "./support/bytes.js"
import { derivationOf } from "./support/derivation.js"
import { fixture } from "./support/fixtures.js"
import { transaction } from "./support/transactions.js"

/** A real mainnet payment, resolved inputs and all, spoiled one way per case. */
const honest = (): Derivation => derivationOf(fixture("payment-legacy-outputs"))

type Case = { readonly rule: string; readonly refusal: DerivationRefusal; readonly derivation: Derivation }

const derivations: ReadonlyArray<
  readonly [string, (derivation: Derivation) => Either.Either<AssetEffects | LovelaceEffects, DerivationError>]
> = [
  ["deriveLovelace", deriveLovelace],
  ["deriveAssets", deriveAssets]
]

const cases: ReadonlyArray<Case> = [
  {
    rule: "an input the caller supplied no value for",
    refusal: "UnresolvedInput",
    derivation: { ...honest(), resolvedInputs: [] }
  },
  {
    rule: "two readings of the same input, disagreeing on the amount",
    refusal: "ConflictingResolvedInput",
    derivation: (() => {
      const base = honest()
      const first = base.resolvedInputs[0]
      return {
        ...base,
        resolvedInputs: [...base.resolvedInputs, { ...first, value: { ...first.value, coin: first.value.coin + 1n } }]
      }
    })()
  },
  {
    rule: "two readings of the same input, disagreeing on whose address it is",
    refusal: "ConflictingResolvedInput",
    derivation: (() => {
      const base = honest()
      const first = base.resolvedInputs[0]
      return { ...base, resolvedInputs: [...base.resolvedInputs, { ...first, address: new Uint8Array(57) }] }
    })()
  },
  {
    rule: "two readings of the same input, disagreeing on the assets it holds",
    refusal: "ConflictingResolvedInput",
    derivation: (() => {
      // The bundle is what the per-policy deltas are counted from, and the
      // later reading would otherwise win without a word.
      const base = honest()
      const first = base.resolvedInputs[0]
      const assets = [{ policyId: new Uint8Array(28), assets: [{ name: new Uint8Array(4), quantity: 1000n }] }]
      return { ...base, resolvedInputs: [...base.resolvedInputs, { ...first, value: { ...first.value, assets } }] }
    })()
  },
  {
    rule: "a transaction whose scripts the body says will fail",
    refusal: "ScriptsExpectedToFail",
    derivation: { ...honest(), transaction: transaction(honest().transaction.body, false) }
  }
]

describe.each(derivations)("%s", (_name, derive) => {
  it.each(cases.map((one) => [one.rule, one] as const))("refuses %s", (_rule, one) => {
    const result = derive(one.derivation)
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left.refusal).toBe(one.refusal)
  })

  it("starts from a derivation that succeeds", () => {
    expect(Either.isRight(derive(honest()))).toBe(true)
  })

  it("ignores resolved inputs the body does not spend, rather than refusing them", () => {
    // A wallet may hand over its whole unspent set; only the ones the body
    // names take part.
    const base = honest()
    const spare = {
      input: { transactionId: fromHex("00".repeat(32)), index: 7n },
      address: base.resolvedInputs[0].address,
      value: { coin: 9_999_999n, assets: [] }
    }
    expect(Either.isRight(derive({ ...base, resolvedInputs: [...base.resolvedInputs, spare] }))).toBe(true)
  })

  it("accepts the same input supplied twice when both readings agree", () => {
    const base = honest()
    expect(Either.isRight(derive({ ...base, resolvedInputs: [...base.resolvedInputs, ...base.resolvedInputs] }))).toBe(
      true
    )
  })
})

describe("the refusal vocabulary", () => {
  it("has a case for every refusal it defines", () => {
    // A rule nothing can trip is a comment, not a guarantee.
    const reached = new Set(cases.map((one) => one.refusal))
    expect([...reached].sort()).toEqual(Object.keys(derivationRefusals).sort())
  })

  it("leaves the figures alone when a spare input is ignored", () => {
    const base = honest()
    const spare = {
      input: { transactionId: fromHex("00".repeat(32)), index: 7n },
      address: base.resolvedInputs[0].address,
      value: { coin: 9_999_999n, assets: [] }
    }
    const result = deriveLovelace({ ...base, resolvedInputs: [...base.resolvedInputs, spare] })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(String(result.right.user.spent)).toBe(fixture("payment-legacy-outputs").user.spent)
    }
  })
})
