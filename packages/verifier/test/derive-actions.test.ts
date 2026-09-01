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
  it("reads the same certificates the chain does, at the positions the chain gives them", () => {
    // The chain records each certificate's own position in the body, and this
    // is where our order is held to it: a decoder that emitted them in a
    // different order would put the wrong type at a position below.
    const derived = certificates(one)
    expect(one.chain.certificates.map((c) => c.index)).toEqual(derived.map((_, position) => position))

    for (const said of one.chain.certificates) {
      const effect = derived[said.index]
      expect(effect, `nothing at position ${said.index}`).toBeDefined()
      expect(chainWords[effect.kind], `no chain word for ${effect.kind}`).toBeDefined()
      expect(chainWords[effect.kind], `${effect.kind} at ${said.index}`).toContain(said.type)
    }
  })

  it("names the DRep the chain names", () => {
    for (const effect of certificates(one)) {
      const said = one.chain.certificates[effect.index]
      if (effect.drep === null) continue
      if (effect.drep._tag === "Abstain" || effect.drep._tag === "NoConfidence") {
        expect(said.drep).toBe(effect.drep._tag === "Abstain" ? "drep_always_abstain" : "drep_always_no_confidence")
        continue
      }
      // A DRep the chain writes as a CIP-129 id: a header byte, then the
      // credential we read straight out of the certificate.
      expect(said.drepCredential).not.toBeNull()
      expect({ kind: effect.drep._tag === "KeyHash" ? "key" : "script", hash: toHex(effect.drep.hash) }).toEqual(
        said.drepCredential
      )
    }
  })

  it("attaches the deposit the chain says the certificate carries", () => {
    for (const effect of certificates(one)) {
      const said = one.chain.certificates[effect.index].deposit
      if (said === null) continue
      expect(effect.deposit ?? effect.refund, `certificate ${effect.index}`).not.toBeNull()
      expect(String((effect.deposit ?? effect.refund)!.amount)).toBe(said)
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

  it("knows the credential is the signer's own, from the base address alone", () => {
    // This wallet reported no reward account — only the 57-byte address it
    // spends from, whose second half is the very credential being delegated.
    const [address] = derivationOf(one).userAddresses
    expect(address).toHaveLength(57)
    expect(toHex(address.subarray(29))).toBe(one.chain.certificates[0].credential!.hash)
    expect(certificates(one).every((effect) => effect.ours)).toBe(true)
  })

  it("reads it from a reward account too", () => {
    const account = fromHex(`e1${one.chain.certificates[0].credential!.hash}`)
    const derived = deriveCertificates({ ...derivationOf(one), userAddresses: [account] })
    expect(Either.isRight(derived)).toBe(true)
    if (Either.isRight(derived)) expect(derived.right.every((effect) => effect.ours)).toBe(true)
  })

  it("is someone else's when the wallet reported neither", () => {
    const derived = deriveCertificates({ ...derivationOf(one), userAddresses: [] })
    expect(Either.isRight(derived)).toBe(true)
    if (Either.isRight(derived)) expect(derived.right.every((effect) => !effect.ours)).toBe(true)
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

describe("a vote delegated to a real DRep", () => {
  const one = fixture("vote-delegation-to-drep")

  it("carries the DRep's own credential, not an abstention", () => {
    const [effect] = certificates(one)
    expect(effect.kind).toBe("VoteDelegation")
    expect(effect.drep).toMatchObject({ _tag: "KeyHash" })
    expect(toHex((effect.drep as { hash: Uint8Array }).hash)).toBe(one.chain.certificates[0].drepCredential!.hash)
  })

  it("acts on a stake credential, and says which namespace that is", () => {
    // The credential delegating and the DRep being delegated to are different
    // things in the same certificate, and only the first is the signer's stake.
    const [effect] = certificates(one)
    expect(effect.role).toBe("stake")
    expect(toHex(effect.credential!.hash)).toBe(one.chain.certificates[0].credential!.hash)
    expect(toHex(effect.credential!.hash)).not.toBe(one.chain.certificates[0].drepCredential!.hash)
  })
})

describe("the pool registration the chain charged nothing for", () => {
  it("is the one place our deposit and the chain's disagree, on purpose", () => {
    // A re-registration pays nothing and a first registration pays 500 ADA, and
    // the body reads the same either way. `basis` is where we say so.
    const one = fixture("pool-registration")
    expect(one.chain.certificates[0].deposit).toBeNull()
    expect(certificates(one)[0].deposit).toMatchObject({ basis: "assumed", amount: mainnetParameters.poolDeposit })
  })
})

describe("certificates the chain window did not hold", () => {
  // Committee certificates do not appear in the fixtures, and a mint map with
  // one policy written twice is not something the ledger writes — both are
  // built here rather than left untested.
  const base = derivationOf(fixture("payment-legacy-outputs"))
  const hash = fromHex("ab".repeat(28))
  const account = fromHex(`e1${"ab".repeat(28)}`)
  const credential = { _tag: "KeyHash" as const, hash }

  const rolesOf = (certificates: ReadonlyArray<Certificate>, addresses: ReadonlyArray<Uint8Array>) => {
    const result = deriveCertificates({
      ...base,
      transaction: transaction({ ...base.transaction.body, certificates }),
      userAddresses: addresses
    })
    if (Either.isLeft(result)) throw new Error(result.left.message)
    return result.right
  }

  it("says which namespace each credential comes from", () => {
    const derived = rolesOf(
      [
        { _tag: "StakeDeregistration", credential },
        { _tag: "UpdateDrep", credential, anchor: null },
        { _tag: "AuthorizeCommitteeHot", cold: credential, hot: credential },
        { _tag: "PoolRetirement", poolKeyHash: hash, epoch: 651n }
      ],
      []
    )
    expect(derived.map((effect) => effect.role)).toEqual(["stake", "drep", "committee-cold", null])
    expect(derived[3].credential).toBeNull()
  })

  it("still calls a credential the wallet reported its own, whatever the namespace", () => {
    const derived = rolesOf(
      [
        { _tag: "UpdateDrep", credential, anchor: null },
        { _tag: "ResignCommitteeCold", cold: credential, anchor: null }
      ],
      [account]
    )
    expect(derived.map((effect) => effect.ours)).toEqual([true, true])
  })

  it("adds a policy written twice in the mint into one line", () => {
    const policyId = fromHex("cd".repeat(28))
    const name = fromHex("01")
    const derived = deriveMint({
      ...base,
      transaction: transaction({
        ...base.transaction.body,
        mint: [
          { policyId, assets: [{ name, quantity: 1n }] },
          { policyId, assets: [{ name, quantity: 999n }] }
        ]
      })
    })
    expect(Either.isRight(derived)).toBe(true)
    if (Either.isRight(derived)) {
      expect(derived.right).toHaveLength(1)
      expect(derived.right[0].quantity).toBe(1000n)
    }
  })

  it("does not turn a policy that nets to nothing into a mint and a burn", () => {
    const policyId = fromHex("cd".repeat(28))
    const name = fromHex("01")
    const derived = deriveMint({
      ...base,
      transaction: transaction({
        ...base.transaction.body,
        mint: [
          { policyId, assets: [{ name, quantity: 1000n }] },
          { policyId, assets: [{ name, quantity: -1000n }] }
        ]
      })
    })
    expect(Either.isRight(derived)).toBe(true)
    if (Either.isRight(derived)) expect(derived.right.map((asset) => asset.quantity)).toEqual([0n])
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
    expect(all.some((effect) => effect.drep?._tag === "KeyHash")).toBe(true)
    expect(all.some((effect) => effect.drep?._tag === "Abstain")).toBe(true)
    expect(new Set(all.map((effect) => effect.role))).toEqual(new Set(["stake", "drep", null]))
    expect(all.some((effect) => effect.deposit !== null)).toBe(true)
    expect(all.some((effect) => effect.refund !== null)).toBe(true)
  })
})
