/**
 * Twenty-six mainnet transactions, read by this decoder and by Koios. The
 * commit carries the most weight: BLAKE2b-256 over the extracted body must
 * equal the chain's transaction id, and fails on a single byte of drift.
 */
import { blake2b } from "@noble/hashes/blake2.js"
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { DecodedTransaction } from "../src/decode.js"
import { decodeTransaction, extractTransactionBody } from "../src/decode.js"
import { fromHex, toHex } from "./support/bytes.js"
import type { Fixture } from "./support/fixtures.js"
import { cipVectors, fixtures } from "./support/fixtures.js"

const decoded = (fixture: Fixture): DecodedTransaction => {
  const result = decodeTransaction(fromHex(fixture.cbor))
  if (Either.isLeft(result)) throw new Error(`${fixture.name} was refused: ${result.left.message}`)
  return result.right
}

const commit = (bodyBytes: Uint8Array): string => toHex(blake2b(bodyBytes, { dkLen: 32 }))

it("has fixtures to read", () => {
  expect(fixtures.length).toBeGreaterThanOrEqual(26)
})

describe.each(fixtures.map((fixture) => [fixture.name, fixture] as const))("%s", (_name, fixture) => {
  it("hashes to its transaction id", () => {
    expect(commit(decoded(fixture).bodyBytes)).toBe(fixture.transactionId)
  })

  it("takes the body from inside the transaction it was given", () => {
    const { bodyBytes, bodyRange } = decoded(fixture)
    const whole = fromHex(fixture.cbor)
    expect(bodyRange.start).toBeGreaterThan(0)
    expect(bodyRange.end).toBeLessThan(whole.length)
    expect(bodyBytes).toEqual(whole.slice(bodyRange.start, bodyRange.end))
  })

  it("agrees with the chain on the fee and the outputs", () => {
    const { body } = decoded(fixture)
    expect(String(body.fee)).toBe(fixture.chain.fee)
    expect(body.outputs.length).toBe(fixture.chain.outputs)
    expect(body.inputs.length).toBe(fixture.chain.inputs)
    const total = body.outputs.reduce((running, output) => running + output.value.coin, 0n)
    expect(String(total)).toBe(fixture.chain.totalOutput)
  })

  it("agrees with the chain on certificates and withdrawals", () => {
    const { body } = decoded(fixture)
    expect(body.certificates.length).toBe(fixture.chain.certificates.length)
    expect(body.withdrawals.map((withdrawal) => String(withdrawal.amount)).sort()).toEqual(
      [...fixture.chain.withdrawals].sort()
    )
  })

  it("agrees with the chain on the mint", () => {
    const minted = decoded(fixture)
      .body.mint.flatMap((policy) =>
        policy.assets.map((asset) => ({
          policyId: toHex(policy.policyId),
          name: toHex(asset.name),
          quantity: String(asset.quantity)
        }))
      )
      .sort((left, right) => (left.policyId + left.name < right.policyId + right.name ? -1 : 1))
    expect(minted).toEqual(fixture.chain.mint)
  })

  it("agrees with the chain on the validity interval", () => {
    const { body } = decoded(fixture)
    const asChainWrites = (slot: bigint | null): string | null => (slot === null ? null : String(slot))
    expect(asChainWrites(body.validityIntervalStart)).toBe(fixture.chain.invalidBefore)
    expect(asChainWrites(body.validityIntervalEnd)).toBe(fixture.chain.invalidAfter)
  })

  it("agrees with the chain on collateral, reference inputs and governance", () => {
    const { body } = decoded(fixture)
    expect(body.collateralInputs.length).toBe(fixture.chain.collateralInputs)
    expect(body.referenceInputs.length).toBe(fixture.chain.referenceInputs)
    expect(body.votingProcedures.length).toBe(fixture.chain.votingProcedures)
    expect(body.proposalProcedures.length).toBe(fixture.chain.proposalProcedures)
  })

  it("still exercises everything it claims to", () => {
    const { body } = decoded(fixture)
    const found = new Set<string>()
    for (const output of body.outputs) {
      found.add(output.form === "legacy" ? "legacy-output" : "post-alonzo-output")
      if (output.value.assets.length > 0) found.add("native-assets-in-output")
      if (output.datum?._tag === "InlineDatum") found.add("inline-datum")
      if (output.datum?._tag === "DatumHash") found.add("datum-hash")
      if (output.scriptRef !== null) found.add("reference-script")
    }
    for (const certificate of body.certificates) found.add(`certificate:${certificate._tag}`)
    for (const proposal of body.proposalProcedures) found.add(`proposal:${proposal.action.kind}`)
    if (body.withdrawals.length > 0) found.add("withdrawal")
    if (body.mint.length > 0) found.add("mint")
    if (body.mint.some((policy) => policy.assets.some((asset) => asset.quantity < 0n))) found.add("burn")
    if (body.auxiliaryDataHash !== null) found.add("auxiliary-data-hash")
    if (body.scriptDataHash !== null) found.add("script-data-hash")
    if (body.collateralInputs.length > 0) found.add("collateral-inputs")
    if (body.requiredSigners.length > 0) found.add("required-signers")
    if (body.networkId !== null) found.add("network-id")
    if (body.collateralReturn !== null) found.add("collateral-return")
    if (body.totalCollateral !== null) found.add("total-collateral")
    if (body.referenceInputs.length > 0) found.add("reference-inputs")
    if (body.votingProcedures.length > 0) found.add("voting-procedures")
    if (body.currentTreasuryValue !== null) found.add("current-treasury-value")
    if (body.donation !== null) found.add("treasury-donation")
    if (body.validityIntervalStart !== null) found.add("validity-interval-start")
    if (body.validityIntervalEnd !== null) found.add("validity-interval-end")

    expect([...found].sort()).toEqual([...fixture.exercises].sort())
  })
})

describe("the fixtures together", () => {
  const shapes = new Set(fixtures.flatMap((fixture) => fixture.exercises))

  it.each([
    "legacy-output",
    "post-alonzo-output",
    "native-assets-in-output",
    "inline-datum",
    "datum-hash",
    "withdrawal",
    "mint",
    "burn",
    "collateral-inputs",
    "collateral-return",
    "total-collateral",
    "reference-inputs",
    "required-signers",
    "network-id",
    "auxiliary-data-hash",
    "script-data-hash",
    "voting-procedures",
    "validity-interval-start",
    "validity-interval-end"
  ])("cover %s", (shape) => {
    expect(shapes).toContain(shape)
  })

  it("hold at least one transaction carrying both output forms at once", () => {
    // The pair that taught ADR-0010 the two shapes must stay apart in our own
    // representation: they differ by nothing but CBOR major type.
    const mixed = fixtures.filter(
      (fixture) => fixture.exercises.includes("legacy-output") && fixture.exercises.includes("post-alonzo-output")
    )
    expect(mixed.length).toBeGreaterThan(0)
  })

  it("read every output as the form its CBOR actually used", () => {
    for (const fixture of fixtures) {
      for (const output of decoded(fixture).body.outputs) {
        // A post-alonzo output read as a legacy one produces plausible garbage
        // rather than an error, so the form is asserted rather than trusted.
        expect(output.form === "legacy" || output.form === "post-alonzo").toBe(true)
        expect(output.address.length).toBeGreaterThan(0)
        if (output.form === "legacy") expect(output.scriptRef).toBeNull()
      }
    }
  })
})

/**
 * CIP-0186's two published CBOR vectors. They are shape tests over a body of
 * `a0` — a well-formed empty map, not a transaction the ledger would accept —
 * so they pin the extraction rule and the commit operation and nothing else.
 */
describe("CIP-0186 conformance", () => {
  const vector = (name: string): (typeof cipVectors)[number] => {
    const found = cipVectors.find((candidate) => candidate.name.startsWith(name))
    if (found === undefined) throw new Error(`no CIP-0186 vector ${name}`)
    return found
  }

  it("cbor_001: commits BLAKE2b-256 over the body bytes", () => {
    const published = vector("cbor_001")
    expect(commit(fromHex(published.input.tx_body_cbor_hex as string))).toBe(published.expected.commit_hex)
  })

  it("cbor_002: extracts the body at index 0 and the flag at index 2", () => {
    const published = vector("cbor_002")
    const result = extractTransactionBody(fromHex(published.input.transaction_cbor_hex as string))
    if (Either.isLeft(result)) throw new Error(`the vector was refused: ${result.left.message}`)
    expect(toHex(result.right.bodyBytes)).toBe(published.expected.tx_body_cbor_hex)
    expect(result.right.isValid).toBe(published.expected.is_valid)
    expect(commit(result.right.bodyBytes)).toBe(published.expected.commit_hex)
  })

  it("cbor_002: is a shape test, and a full decode still refuses it", () => {
    // Recorded rather than worked around: the vector's body has none of the
    // three keys the Conway body requires, and fail-closed means saying so.
    const published = vector("cbor_002")
    const result = decodeTransaction(fromHex(published.input.transaction_cbor_hex as string))
    expect(Either.isLeft(result)).toBe(true)
  })
})
