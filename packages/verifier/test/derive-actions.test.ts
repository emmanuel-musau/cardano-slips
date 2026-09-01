/**
 * Everything a transaction does besides move value: its certificates, its
 * withdrawals, what it creates or destroys, and when it stops being good. Each
 * one is checked against the chain's own reading of the same transaction — the
 * type it gives the certificate, the pool and DRep it names, and, for the
 * validity interval, the wall-clock time it minted the block at.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { Certificate } from "../src/decode.js"
import type { CertificateEffect, ValidityWindow, WithdrawalEffect } from "../src/derive.js"
import { deriveCertificates, deriveMint, deriveValidity, deriveWithdrawals } from "../src/derive.js"
import type { AssetAmount } from "../src/derive.js"
import { fromHex, toHex } from "./support/bytes.js"
import { derivationOf, mainnetParameters } from "./support/derivation.js"
import type { Fixture } from "./support/fixtures.js"
import { fixture, fixtures } from "./support/fixtures.js"
import { transaction } from "./support/transactions.js"

const right = <A>(result: Either.Either<A, { message: string }>, name: string): A => {
  if (Either.isLeft(result)) throw new Error(`${name} was refused: ${result.left.message}`)
  return result.right
}

const certificates = (one: Fixture): ReadonlyArray<CertificateEffect> =>
  right(deriveCertificates(derivationOf(one)), one.name)
const withdrawals = (one: Fixture): ReadonlyArray<WithdrawalEffect> =>
  right(deriveWithdrawals(derivationOf(one)), one.name)
const mint = (one: Fixture): ReadonlyArray<AssetAmount> => right(deriveMint(derivationOf(one)), one.name)
const validity = (one: Fixture): ValidityWindow => right(deriveValidity(derivationOf(one)), one.name)

/**
 * The chain collapses shapes we keep apart: a legacy registration and a Conway
 * one are both `stake_registration`, and it calls a pool re-registration an
 * update. So each of our kinds maps to the words the chain may use for it.
 */
const chainWords: Partial<Record<Certificate["_tag"], ReadonlyArray<string>>> = {
  StakeRegistration: ["stake_registration"],
  Registration: ["stake_registration"],
  StakeDeregistration: ["stake_deregistration"],
  Deregistration: ["stake_deregistration"],
  StakeDelegation: ["pool_delegation"],
  VoteDelegation: ["vote_delegation"],
  PoolRegistration: ["pool_registration", "pool_update"],
  PoolRetirement: ["pool_retire"],
  RegisterDrep: ["drep_registration"],
  UnregisterDrep: ["drep_retire"],
  UpdateDrep: ["drep_update"]
}

describe.each(fixtures.map((one) => [one.name, one] as const))("%s", (_name, one) => {
  it("reads the same certificates the chain does, in the same order", () => {
    const derived = certificates(one)
    expect(derived.map((effect) => effect.index)).toEqual(one.chain.certificates.map((c) => c.index))
    for (const [position, effect] of derived.entries()) {
      const said = one.chain.certificates[position]
      expect(chainWords[effect.kind], `no chain word for ${effect.kind}`).toBeDefined()
      expect(chainWords[effect.kind], `${effect.kind} at ${effect.index}`).toContain(said.type)
    }
  })

  it("acts on the credential the chain says it does", () => {
    for (const effect of certificates(one)) {
      // A DRep certificate acts on the DRep's own credential, which the chain
      // reports as an id rather than as a stake address.
      const chainCertificate = one.chain.certificates[effect.index]
      const said = chainCertificate.credential ?? chainCertificate.drepCredential
      if (said === null) {
        expect(effect.credential).toBeNull()
        continue
      }
      expect(effect.credential).not.toBeNull()
      expect(toHex(effect.credential!.hash)).toBe(said.hash)
      expect(effect.credential!._tag).toBe(said.kind === "key" ? "KeyHash" : "ScriptHash")
    }
  })

  it("names the pool the chain names", () => {
    for (const effect of certificates(one)) {
      const said = one.chain.certificates[effect.index].pool
      expect(effect.pool === null ? null : toHex(effect.pool)).toBe(said)
    }
  })

  it("sums the withdrawals the chain reports, per reward account", () => {
    expect(
      withdrawals(one).map((effect) => ({ rewardAccount: toHex(effect.rewardAccount), amount: String(effect.amount) }))
    ).toEqual(one.chain.withdrawals)
  })

  it("lists what the chain says was minted and burned", () => {
    expect(
      mint(one).map((asset) => ({
        policyId: toHex(asset.policyId),
        name: toHex(asset.name),
        quantity: String(asset.quantity)
      }))
    ).toEqual(one.chain.mint)
  })

  it("converts the validity interval to the chain's own clock", () => {
    // The block's own slot and timestamp are the oracle: the mapping that puts
    // this transaction's window in the right place has to put its block there
    // too, and a wrong era anchor moves both by hours.
    const { slots } = mainnetParameters
    const blockTime = slots.time + (BigInt(one.chain.absoluteSlot) - slots.slot) * slots.slotLength
    expect(blockTime).toBe(BigInt(one.chain.timestamp) * 1000n)

    const window = validity(one)
    expect(window.validFrom?.slot.toString() ?? null).toBe(one.chain.invalidBefore)
    expect(window.validUntil?.slot.toString() ?? null).toBe(one.chain.invalidAfter)
    for (const end of [window.validFrom, window.validUntil]) {
      if (end !== null && end !== undefined) {
        expect(end.time).toBe(slots.time + (end.slot - slots.slot) * slots.slotLength)
      }
    }
  })
})

describe("a delegation", () => {
  const one = fixture("registration-and-both-delegations")

  it("registers, delegates to a pool, and delegates a vote, in body order", () => {
    expect(certificates(one).map((effect) => effect.kind)).toEqual([
      "StakeRegistration",
      "VoteDelegation",
      "StakeDelegation"
    ])
  })

  it("carries the pool on the delegation and the deposit on the registration", () => {
    const [registration, vote, delegation] = certificates(one)
    expect(registration.deposit).toMatchObject({ kind: "stake", amount: mainnetParameters.stakeDeposit })
    expect(registration.pool).toBeNull()
    expect(vote.drep).toMatchObject({ _tag: "Abstain" })
    expect(toHex(delegation.pool!)).toBe(one.chain.certificates[2].pool)
    expect(delegation.deposit).toBeNull()
  })

  it("knows the credential is the signer's own", () => {
    // The wallet reported no reward account for this fixture, so nothing here
    // is confirmable and every certificate reads as someone else's.
    expect(certificates(one).every((effect) => !effect.ours)).toBe(true)

    const account = fromHex(`e1${one.chain.certificates[0].credential!.hash}`)
    const withAccount = deriveCertificates({
      ...derivationOf(one),
      userAddresses: [...derivationOf(one).userAddresses, account]
    })
    expect(Either.isRight(withAccount)).toBe(true)
    if (Either.isRight(withAccount)) expect(withAccount.right.every((effect) => effect.ours)).toBe(true)
  })
})

describe("a deregistration that takes its refund", () => {
  it("carries the refund the certificate states", () => {
    const [effect] = certificates(fixture("deregistration-with-withdrawal"))
    expect(effect.kind).toBe("Deregistration")
    expect(effect.refund).toMatchObject({ amount: 2_000_000n, basis: "stated" })
    expect(effect.deposit).toBeNull()
  })
})

describe("a mint and a burn in one transaction", () => {
  it("signs each one: created is positive, destroyed is negative", () => {
    const listed = mint(fixture("mint-and-burn"))
    expect(listed.some((asset) => asset.quantity > 0n)).toBe(true)
    expect(listed.some((asset) => asset.quantity < 0n)).toBe(true)
  })
})

describe("the withdrawal", () => {
  const one = fixture("withdrawal")

  it("is the signer's own, and says so", () => {
    expect(withdrawals(one)).toHaveLength(1)
    expect(withdrawals(one)[0].ours).toBe(true)
  })

  it("is someone else's when the wallet never reported that account", () => {
    const derived = deriveWithdrawals({ ...derivationOf(one), userAddresses: [] })
    expect(Either.isRight(derived)).toBe(true)
    if (Either.isRight(derived)) expect(derived.right[0].ours).toBe(false)
  })
})

describe("a body that writes one reward account twice", () => {
  // The ledger writes a withdrawal map, so one account appears once — but the
  // bytes are a CBOR map whose keys nothing here forces to be distinct, and two
  // entries rendered as two withdrawals would show one account's rewards twice.
  const account = fromHex(`e1${"ab".repeat(28)}`)
  const other = fromHex(`e1${"cd".repeat(28)}`)
  const base = derivationOf(fixture("payment-legacy-outputs"))

  const derived = (withdrawals: ReadonlyArray<{ rewardAccount: Uint8Array; amount: bigint }>) => {
    const result = deriveWithdrawals({
      ...base,
      transaction: transaction({ ...base.transaction.body, withdrawals }),
      userAddresses: [...base.userAddresses, account]
    })
    if (Either.isLeft(result)) throw new Error(result.left.message)
    return result.right
  }

  it("adds the two entries into one withdrawal", () => {
    const [only] = derived([
      { rewardAccount: account, amount: 3n },
      { rewardAccount: account, amount: 4n }
    ])
    expect(only.amount).toBe(7n)
    expect(
      derived([
        { rewardAccount: account, amount: 3n },
        { rewardAccount: account, amount: 4n }
      ])
    ).toHaveLength(1)
  })

  it("keeps two different accounts apart, ordered by account", () => {
    const both = derived([
      { rewardAccount: other, amount: 1n },
      { rewardAccount: account, amount: 2n }
    ])
    expect(both.map((effect) => [toHex(effect.rewardAccount).slice(2, 4), effect.amount, effect.ours])).toEqual([
      ["ab", 2n, true],
      ["cd", 1n, false]
    ])
  })
})

describe("what the fixtures cover", () => {
  it("reaches a certificate, a withdrawal, a mint and both ends of a validity interval", () => {
    expect(fixtures.some((one) => certificates(one).length > 0)).toBe(true)
    expect(fixtures.some((one) => withdrawals(one).length > 0)).toBe(true)
    expect(fixtures.some((one) => mint(one).length > 0)).toBe(true)
    expect(fixtures.some((one) => validity(one).validFrom !== null)).toBe(true)
    expect(fixtures.some((one) => validity(one).validUntil !== null)).toBe(true)
    expect(fixtures.some((one) => validity(one).validUntil === null)).toBe(true)
  })

  it("names a pool, a DRep and a deposit somewhere among them", () => {
    const all = fixtures.flatMap((one) => certificates(one))
    expect(all.some((effect) => effect.pool !== null)).toBe(true)
    expect(all.some((effect) => effect.drep !== null)).toBe(true)
    expect(all.some((effect) => effect.deposit !== null)).toBe(true)
    expect(all.some((effect) => effect.refund !== null)).toBe(true)
  })
})
