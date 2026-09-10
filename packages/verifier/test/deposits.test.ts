/**
 * Which certificate locks lovelace up, which hands it back, and where the
 * number came from. A deposit shown as a cost is wrong; one left out of what a
 * person is about to part with is worse.
 */
import { describe, expect, it } from "vitest"

import type { Certificate, Credential } from "../src/decode.js"
import { readDeposits, totalOf } from "../src/deposits.js"
import { mainnetParameters } from "./support/derivation.js"
import { body } from "./support/transactions.js"

const credential: Credential = { _tag: "KeyHash", hash: new Uint8Array(28) }
const hash = new Uint8Array(28)

const from = (...certificates: ReadonlyArray<Certificate>) => readDeposits(body({ certificates }), mainnetParameters)

describe("a certificate that carries no amount", () => {
  it("takes the stake deposit from the protocol parameter", () => {
    expect(from({ _tag: "StakeRegistration", credential }).deposits).toEqual([
      { kind: "stake", amount: mainnetParameters.stakeDeposit, basis: "parameter", source: "certificate", index: 0 }
    ])
  })

  it("returns the same parameter, but does not call it settled", () => {
    // The ledger refunds what the credential was registered under. This
    // certificate does not say what that was, so the figure is right only
    // while the parameter has not changed since.
    expect(from({ _tag: "StakeDeregistration", credential }).refunds).toEqual([
      { kind: "stake", amount: mainnetParameters.stakeDeposit, basis: "assumed", source: "certificate", index: 0 }
    ])
  })
})

describe("a certificate that states its own amount", () => {
  // The ledger charges what the certificate says. Reading the parameter here
  // instead would agree only while the two happen to be equal.
  const stated = 3_000_000n

  it("reads the registration's deposit off the certificate", () => {
    expect(from({ _tag: "Registration", credential, deposit: stated }).deposits).toEqual([
      { kind: "stake", amount: stated, basis: "stated", source: "certificate", index: 0 }
    ])
  })

  it("reads the deregistration's refund off the certificate", () => {
    expect(from({ _tag: "Deregistration", credential, refund: stated }).refunds).toEqual([
      { kind: "stake", amount: stated, basis: "stated", source: "certificate", index: 0 }
    ])
  })

  it("reads each registration-and-delegation's deposit off the certificate", () => {
    const { deposits } = from(
      { _tag: "StakeRegistrationDelegation", credential, poolKeyHash: hash, deposit: stated },
      { _tag: "VoteRegistrationDelegation", credential, drep: { _tag: "Abstain" }, deposit: stated },
      {
        _tag: "StakeVoteRegistrationDelegation",
        credential,
        poolKeyHash: hash,
        drep: { _tag: "Abstain" },
        deposit: stated
      }
    )
    expect(deposits.map((one) => one.amount)).toEqual([stated, stated, stated])
    expect(deposits.map((one) => one.basis)).toEqual(["stated", "stated", "stated"])
  })

  it("reads a DRep's deposit and refund off the certificate", () => {
    expect(from({ _tag: "RegisterDrep", credential, deposit: 400n, anchor: null }).deposits[0].amount).toBe(400n)
    expect(from({ _tag: "UnregisterDrep", credential, refund: 400n }).refunds[0].amount).toBe(400n)
  })
})

describe("a pool", () => {
  const params = {
    operator: hash,
    vrfKeyHash: new Uint8Array(32),
    pledge: 0n,
    cost: 340_000_000n,
    margin: { numerator: 1n, denominator: 50n },
    rewardAccount: new Uint8Array(29),
    owners: [hash],
    relays: [],
    metadata: null
  }

  it("is charged the parameter, marked as an assumption", () => {
    // Re-registering a pool that is already registered is free, and the body is
    // the same either way. `unaccounted` is what says so out loud.
    expect(from({ _tag: "PoolRegistration", params }).deposits).toEqual([
      { kind: "pool", amount: mainnetParameters.poolDeposit, basis: "assumed", source: "certificate", index: 0 }
    ])
  })

  it("returns nothing when it retires, because the ledger refunds that at the epoch boundary", () => {
    expect(from({ _tag: "PoolRetirement", poolKeyHash: hash, epoch: 651n })).toEqual({ deposits: [], refunds: [] })
  })
})

describe("the certificates that move no deposit", () => {
  it("reads none from any of them", () => {
    const none = from(
      { _tag: "StakeDelegation", credential, poolKeyHash: hash },
      { _tag: "VoteDelegation", credential, drep: { _tag: "NoConfidence" } },
      { _tag: "StakeVoteDelegation", credential, poolKeyHash: hash, drep: { _tag: "Abstain" } },
      { _tag: "AuthorizeCommitteeHot", cold: credential, hot: credential },
      { _tag: "ResignCommitteeCold", cold: credential, anchor: null },
      { _tag: "UpdateDrep", credential, anchor: null }
    )
    expect(none).toEqual({ deposits: [], refunds: [] })
  })
})

describe("a governance proposal", () => {
  it("states its own deposit, one per proposal", () => {
    const proposal = {
      deposit: mainnetParameters.governanceActionDeposit,
      rewardAccount: new Uint8Array(29),
      action: { kind: "info" as const, arguments: [] },
      anchor: { url: "https://example.invalid/a", dataHash: new Uint8Array(32) }
    }
    const { deposits } = readDeposits(body({ proposalProcedures: [proposal, proposal] }), mainnetParameters)
    expect(deposits).toEqual([
      { kind: "governance-action", amount: proposal.deposit, basis: "stated", source: "proposal", index: 0 },
      { kind: "governance-action", amount: proposal.deposit, basis: "stated", source: "proposal", index: 1 }
    ])
  })
})

describe("what a deposit points back at", () => {
  it("says which list its position is in, so two deposits at position zero stay apart", () => {
    // A certificate deposit and a proposal deposit share one array and can
    // share an index. Reading `body.certificates[index]` for both would show a
    // governance deposit as belonging to a stake registration.
    const { deposits } = readDeposits(
      body({
        certificates: [{ _tag: "StakeRegistration", credential }],
        proposalProcedures: [
          {
            deposit: mainnetParameters.governanceActionDeposit,
            rewardAccount: new Uint8Array(29),
            action: { kind: "info" as const, arguments: [] },
            anchor: { url: "https://example.invalid/a", dataHash: new Uint8Array(32) }
          }
        ]
      }),
      mainnetParameters
    )
    expect(deposits.map((one) => ({ source: one.source, index: one.index }))).toEqual([
      { source: "certificate", index: 0 },
      { source: "proposal", index: 0 }
    ])
  })

  it("carries the position of the certificate it came from", () => {
    const { deposits, refunds } = from(
      { _tag: "StakeDelegation", credential, poolKeyHash: hash },
      { _tag: "StakeRegistration", credential },
      { _tag: "StakeDeregistration", credential }
    )
    expect(deposits.map((one) => one.index)).toEqual([1])
    expect(refunds.map((one) => one.index)).toEqual([2])
  })
})

describe("adding them up", () => {
  it("sums an empty list to zero", () => {
    expect(totalOf([])).toBe(0n)
  })

  it("sums deposits and refunds apart, never against each other", () => {
    const { deposits, refunds } = from(
      { _tag: "StakeRegistration", credential },
      { _tag: "StakeDeregistration", credential }
    )
    expect(totalOf(deposits)).toBe(mainnetParameters.stakeDeposit)
    expect(totalOf(refunds)).toBe(mainnetParameters.stakeDeposit)
  })
})
