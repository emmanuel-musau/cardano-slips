/**
 * Which lovelace a transaction locks up and which it hands back. Showing a
 * deposit as a cost is wrong — it comes back — and leaving it out of what a
 * person is about to part with is worse.
 */
import { Function } from "effect"

import type { Certificate, TransactionBody } from "./decode.js"
import type { ProtocolParameters } from "./parameters.js"

export type DepositKind = "stake" | "pool" | "drep" | "governance-action"

/**
 * Where the amount came from. `stated` is the certificate's or proposal's own
 * field, which is what the ledger charges. `parameter` is the protocol
 * parameter, and the ledger will charge it. `assumed` is the same parameter
 * where the body cannot settle whether it applies — a pool already registered
 * pays nothing to re-register, and a credential registered before the parameter
 * last changed is refunded what it paid rather than what the parameter says
 * now. The spec requires a deposit to equal the parameter exactly, so `stated`
 * is what lets the comparison hold a transaction to that.
 */
export type DepositBasis = "stated" | "parameter" | "assumed"

export type Deposit = {
  readonly kind: DepositKind
  /** Always positive. A refund is the same shape in the other list. */
  readonly amount: bigint
  readonly basis: DepositBasis
  /** Which list `index` points into. Deposits from both lists sit in one array. */
  readonly source: "certificate" | "proposal"
  /** The position this came from, in the list `source` names. */
  readonly index: number
}

export type Deposits = {
  readonly deposits: ReadonlyArray<Deposit>
  readonly refunds: ReadonlyArray<Deposit>
}

type Entry = {
  readonly side: "deposit" | "refund"
  readonly kind: DepositKind
  readonly amount: bigint
  readonly basis: DepositBasis
}

const deposit = (kind: DepositKind, amount: bigint, basis: DepositBasis): Entry => ({
  side: "deposit",
  kind,
  amount,
  basis
})
const refund = (kind: DepositKind, amount: bigint, basis: DepositBasis): Entry => ({
  side: "refund",
  kind,
  amount,
  basis
})

/**
 * Exhaustive by type: a certificate added to the decoder without a line here
 * fails to compile, which is the only way a deposit stays impossible to forget.
 * Pool retirement is absent on purpose — the ledger returns that deposit at the
 * epoch boundary, not in this transaction.
 */
const entryFor = (certificate: Certificate, parameters: ProtocolParameters): Entry | null => {
  switch (certificate._tag) {
    case "StakeRegistration":
      return deposit("stake", parameters.stakeDeposit, "parameter")
    case "StakeDeregistration":
      // The ledger returns what the credential was registered under, and this
      // certificate does not say what that was. Right while the parameter is
      // unchanged, which is why it is not marked as settled.
      return refund("stake", parameters.stakeDeposit, "assumed")
    case "Registration":
      return deposit("stake", certificate.deposit, "stated")
    case "Deregistration":
      return refund("stake", certificate.refund, "stated")
    case "StakeRegistrationDelegation":
    case "VoteRegistrationDelegation":
    case "StakeVoteRegistrationDelegation":
      return deposit("stake", certificate.deposit, "stated")
    case "PoolRegistration":
      return deposit("pool", parameters.poolDeposit, "assumed")
    case "RegisterDrep":
      return deposit("drep", certificate.deposit, "stated")
    case "UnregisterDrep":
      return refund("drep", certificate.refund, "stated")
    case "StakeDelegation":
    case "PoolRetirement":
    case "VoteDelegation":
    case "StakeVoteDelegation":
    case "AuthorizeCommitteeHot":
    case "ResignCommitteeCold":
    case "UpdateDrep":
      return null
    default:
      return Function.absurd(certificate)
  }
}

/** Every deposit the body locks up and every refund it returns, in the order the body writes them. */
export const readDeposits = (body: TransactionBody, parameters: ProtocolParameters): Deposits => {
  const deposits: Array<Deposit> = []
  const refunds: Array<Deposit> = []

  body.certificates.forEach((certificate, index) => {
    const entry = entryFor(certificate, parameters)
    if (entry === null) return
    const read = { kind: entry.kind, amount: entry.amount, basis: entry.basis, source: "certificate" as const, index }
    ;(entry.side === "deposit" ? deposits : refunds).push(read)
  })

  body.proposalProcedures.forEach((proposal, index) => {
    deposits.push({ kind: "governance-action", amount: proposal.deposit, basis: "stated", source: "proposal", index })
  })

  return { deposits, refunds }
}

export const totalOf = (deposits: ReadonlyArray<Deposit>): bigint =>
  deposits.reduce((running, one) => running + one.amount, 0n)
