/**
 * What a transaction does — to a person's lovelace, to their native assets, and
 * everything it does besides move value — derived from the body, the values of
 * the inputs it spends and the protocol parameters in force. Nothing here asks
 * anything of the network: every term arrives as an argument.
 */
import { Either, Function } from "effect"

import { toHex } from "./bytes.js"
import type {
  Certificate,
  Credential,
  DecodedTransaction,
  DRep,
  MultiAsset,
  TransactionInput,
  Value
} from "./decode.js"
import type { DerivationError } from "./derive-error.js"
import { cannotDerive } from "./derive-error.js"
import type { Deposit } from "./deposits.js"
import { readDeposits, totalOf } from "./deposits.js"
import type { ProtocolParameters } from "./parameters.js"
import { timeOfSlot } from "./parameters.js"

/** An input the body names, with the output it points at. The body carries the reference only. */
export type ResolvedInput = {
  readonly input: TransactionInput
  readonly address: Uint8Array
  readonly value: Value
}

export type Derivation = {
  readonly transaction: DecodedTransaction
  /**
   * Every address the connected wallet reports as its own — used, unused,
   * change, and the reward account. An address that is not in here is
   * someone else's, which overstates what leaves and understates what returns.
   */
  readonly userAddresses: ReadonlyArray<Uint8Array>
  readonly resolvedInputs: ReadonlyArray<ResolvedInput>
  readonly protocolParameters: ProtocolParameters
}

export type UserLovelace = {
  /** Lovelace the body spends out of the user's own outputs. */
  readonly spent: bigint
  /** Lovelace the body pays back to the user's addresses, change included. */
  readonly received: bigint
  /**
   * `spent - received`, the direction the spec states: positive is lovelace
   * leaving. A deposit is in here, and is still refundable — read `deposits`
   * before showing this figure as a cost.
   */
  readonly ada: bigint
  /** Rewards the body moves out of the user's own reward accounts. */
  readonly withdrawn: bigint
}

/** The whole transaction's side of the ledger's own equation, whoever the money belongs to. */
export type TotalLovelace = {
  readonly inputs: bigint
  readonly outputs: bigint
  readonly withdrawn: bigint
  readonly deposited: bigint
  readonly refunded: bigint
}

/**
 * Collateral is deliberately absent. It is consumed only when a script fails,
 * which is the is-valid-false case this derivation refuses, so it takes no part
 * in the arithmetic here — but a transaction can still put collateral at risk
 * without that showing up in any figure below. Rendering that risk is not
 * modelled yet.
 */
export type LovelaceEffects = {
  /** The fee the body states, exactly. Never an estimate. */
  readonly fee: bigint
  readonly donation: bigint
  readonly deposits: ReadonlyArray<Deposit>
  readonly refunds: ReadonlyArray<Deposit>
  readonly user: UserLovelace
  readonly total: TotalLovelace
  /**
   * What the ledger consumes less what it produces, under this reading. Zero
   * for a transaction the engine understands completely, and anything else is
   * the engine saying so: the arithmetic a person is shown does not add up.
   */
  readonly unaccounted: bigint
}

const outpoint = (input: TransactionInput): string => `${toHex(input.transactionId)}#${input.index}`

/** A policy, an asset name, and a signed quantity of it. */
export type AssetAmount = {
  readonly policyId: Uint8Array
  readonly name: Uint8Array
  readonly quantity: bigint
}

export type AssetDelta = {
  readonly policyId: Uint8Array
  readonly name: Uint8Array
  /** Held by the inputs the body spends out of the user's own outputs. */
  readonly spent: bigint
  /** Held by the outputs the body pays back to the user's addresses, change included. */
  readonly received: bigint
  /** `spent - received`, the same direction as `user.ada`: positive is the asset leaving. */
  readonly delta: bigint
}

export type AssetEffects = {
  /**
   * Net per policy and asset name across the user's addresses, ordered by
   * policy then name. An asset that comes in and goes back out unchanged is
   * absent: a delta of zero is not an effect, and a wallet holding a hundred
   * tokens would otherwise render ninety-nine lines of nothing.
   */
  readonly user: ReadonlyArray<AssetDelta>
  /**
   * Assets the reading cannot place: what the inputs hold plus what the body
   * mints, less what the outputs hold. Empty for a transaction the engine reads
   * completely, and the asset-side counterpart of `unaccounted` on the
   * lovelace. The mint is read here for that sum alone — rendering what a
   * transaction creates or destroys is not this function's job.
   */
  readonly unaccounted: ReadonlyArray<AssetAmount>
}

/** A policy and an asset name together, which is what a delta is counted per. */
const assetKey = (policyId: Uint8Array, name: Uint8Array): string => `${toHex(policyId)}.${toHex(name)}`

const assetKeys = (assets: MultiAsset): string =>
  assets
    .flatMap((policy) => policy.assets.map((asset) => `${assetKey(policy.policyId, asset.name)}=${asset.quantity}`))
    .sort()
    .join(",")

/**
 * Whole contents, not only the lovelace: the asset bundle is the term the
 * per-policy deltas are derived from, and a disagreement about it is a
 * disagreement about what the person is shown.
 */
const sameReading = (
  left: { address: Uint8Array; value: Value },
  right: { address: Uint8Array; value: Value }
): boolean =>
  left.value.coin === right.value.coin &&
  toHex(left.address) === toHex(right.address) &&
  assetKeys(left.value.assets) === assetKeys(right.value.assets)

/**
 * Resolved inputs the body does not spend are ignored — a wallet may hand over
 * its whole unspent set — but two readings of one outpoint are refused, because
 * picking either means the other disagrees with what the person is shown.
 */
const byOutpoint = (
  resolved: ReadonlyArray<ResolvedInput>
): Either.Either<ReadonlyMap<string, ResolvedInput>, DerivationError> => {
  const found = new Map<string, ResolvedInput>()
  for (const one of resolved) {
    const at = outpoint(one.input)
    const already = found.get(at)
    if (already !== undefined && !sameReading(already, one)) {
      return Either.left(cannotDerive("ConflictingResolvedInput", `${at} was supplied twice, with different contents`))
    }
    found.set(at, one)
  }
  return Either.right(found)
}

/**
 * What the body actually spends, in body order, and whose each address is.
 * Both derivations start here: refusing rather than guessing is the whole point
 * of the step, so neither may have its own version of it.
 */
const spending = ({
  resolvedInputs,
  transaction,
  userAddresses
}: Derivation): Either.Either<
  { readonly spends: ReadonlyArray<ResolvedInput>; readonly ours: (address: Uint8Array) => boolean },
  DerivationError
> => {
  if (!transaction.isValid) {
    return Either.left(
      cannotDerive(
        "ScriptsExpectedToFail",
        "the is-valid flag is false, so the ledger consumes collateral rather than the inputs"
      )
    )
  }

  const resolved = byOutpoint(resolvedInputs)
  if (Either.isLeft(resolved)) return Either.left(resolved.left)

  const spends: Array<ResolvedInput> = []
  for (const input of transaction.body.inputs) {
    const found = resolved.right.get(outpoint(input))
    if (found === undefined) {
      return Either.left(cannotDerive("UnresolvedInput", `no value was supplied for ${outpoint(input)}`))
    }
    spends.push(found)
  }

  const owned = new Set(userAddresses.map(toHex))
  return Either.right({ spends, ours: (address) => owned.has(toHex(address)) })
}

/**
 * The lovelace. Refuses rather than guesses: an input with no supplied value
 * would otherwise count as zero, which is exactly how a spend gets hidden.
 */
export const deriveLovelace = (derivation: Derivation): Either.Either<LovelaceEffects, DerivationError> => {
  const start = spending(derivation)
  if (Either.isLeft(start)) return Either.left(start.left)
  const { ours, spends } = start.right
  const { body } = derivation.transaction

  let spent = 0n
  let inputs = 0n
  for (const found of spends) {
    inputs += found.value.coin
    if (ours(found.address)) spent += found.value.coin
  }

  let received = 0n
  let outputs = 0n
  for (const output of body.outputs) {
    outputs += output.value.coin
    if (ours(output.address)) received += output.value.coin
  }

  let withdrawn = 0n
  let withdrawnInTotal = 0n
  for (const withdrawal of body.withdrawals) {
    withdrawnInTotal += withdrawal.amount
    if (ours(withdrawal.rewardAccount)) withdrawn += withdrawal.amount
  }

  const { deposits, refunds } = readDeposits(body, derivation.protocolParameters)
  const deposited = totalOf(deposits)
  const refunded = totalOf(refunds)
  const donation = body.donation ?? 0n

  return Either.right({
    fee: body.fee,
    donation,
    deposits,
    refunds,
    user: { spent, received, ada: spent - received, withdrawn },
    total: { inputs, outputs, withdrawn: withdrawnInTotal, deposited, refunded },
    unaccounted: inputs + withdrawnInTotal + refunded - (outputs + body.fee + deposited + donation)
  })
}

type Tally = {
  readonly policyId: Uint8Array
  readonly name: Uint8Array
  spent: bigint
  received: bigint
  /** Inputs plus mint, less outputs: zero for an asset the reading places completely. */
  loose: bigint
}

/**
 * The assets. Every quantity is a raw on-chain count — a token's decimals are a
 * display concern and belong nowhere near this arithmetic. It takes the whole
 * derivation, protocol parameters included, though no asset rule reads them:
 * the four terms are the engine's signature, not a per-function shopping list.
 */
export const deriveAssets = (derivation: Derivation): Either.Either<AssetEffects, DerivationError> => {
  const start = spending(derivation)
  if (Either.isLeft(start)) return Either.left(start.left)
  const { ours, spends } = start.right
  const { body } = derivation.transaction

  const tallies = new Map<string, Tally>()
  const at = (policyId: Uint8Array, name: Uint8Array): Tally => {
    const key = assetKey(policyId, name)
    const held = tallies.get(key) ?? { policyId, name, spent: 0n, received: 0n, loose: 0n }
    tallies.set(key, held)
    return held
  }

  const each = (assets: MultiAsset, count: (held: Tally, quantity: bigint) => void): void => {
    for (const policy of assets) {
      for (const asset of policy.assets) count(at(policy.policyId, asset.name), asset.quantity)
    }
  }

  for (const found of spends) {
    const mine = ours(found.address)
    each(found.value.assets, (held, quantity) => {
      held.loose += quantity
      if (mine) held.spent += quantity
    })
  }
  each(body.mint, (held, quantity) => {
    held.loose += quantity
  })
  for (const output of body.outputs) {
    const mine = ours(output.address)
    each(output.value.assets, (held, quantity) => {
      held.loose -= quantity
      if (mine) held.received += quantity
    })
  }

  const ordered = [...tallies]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, held]) => held)

  return Either.right({
    user: ordered
      .filter((held) => held.spent !== held.received)
      .map((held) => ({
        policyId: held.policyId,
        name: held.name,
        spent: held.spent,
        received: held.received,
        delta: held.spent - held.received
      })),
    unaccounted: ordered
      .filter((held) => held.loose !== 0n)
      .map((held) => ({ policyId: held.policyId, name: held.name, quantity: held.loose }))
  })
}

// What a transaction does besides move value

/** Whose namespace a certificate's credential comes from. They are not interchangeable. */
export type CredentialRole = "stake" | "drep" | "committee-cold"

/**
 * A certificate as a person needs to read it: what it is, whose credential it
 * acts on, the pool or DRep it names, and the deposit or refund the ledger
 * applies to it.
 */
export type CertificateEffect = {
  readonly kind: Certificate["_tag"]
  /**
   * The credential the certificate acts on. Null where it acts on none, which
   * is the two that only name a pool. Read `role` before rendering it: three
   * different namespaces arrive in this field and a DRep or committee key shown
   * as a stake address is an address the person does not hold.
   */
  readonly credential: Credential | null
  /** Which namespace `credential` belongs to. Null exactly where the credential is. */
  readonly role: CredentialRole | null
  /**
   * True where the wallet reported that credential, in a reward account or in
   * the stake half of one of its addresses — whichever namespace `role` says
   * the certificate uses it in.
   */
  readonly ours: boolean
  /** The pool it names — the one delegated to, or the one being registered or retired. */
  readonly pool: Uint8Array | null
  readonly drep: DRep | null
  readonly deposit: Deposit | null
  readonly refund: Deposit | null
  /** Its position in the body, which is the order a person is shown them in. */
  readonly index: number
}

export type WithdrawalEffect = {
  readonly rewardAccount: Uint8Array
  /** Every entry for this account added together. The ledger writes one; the bytes can carry more. */
  readonly amount: bigint
  readonly ours: boolean
}

/** A slot, and the wall-clock instant it begins. */
export type SlotTime = {
  readonly slot: bigint
  /** Unix milliseconds. */
  readonly time: bigint
}

export type ValidityWindow = {
  /** `invalid_before`: the transaction cannot be accepted until this instant. */
  readonly validFrom: SlotTime | null
  /**
   * `invalid_hereafter`: the transaction is invalid from this instant on, so
   * this is the moment it expires rather than the last moment it is good for.
   */
  readonly validUntil: SlotTime | null
}

/**
 * The stake credentials the wallet reported, from two places. A reward account
 * is 29 bytes, a header then the credential, and bit 0x10 of the header says
 * the credential is a script. A base address is 57 bytes and carries the same
 * credential in its second half, with bit 0x20 saying the same thing — read
 * because a wallet that reports its addresses but not its reward account would
 * otherwise be told its own delegation belongs to a stranger.
 *
 * Nothing else counts. A credential we cannot confirm is someone else's, the
 * same rule the addresses follow.
 */
const stakeCredentials = (userAddresses: ReadonlyArray<Uint8Array>): ReadonlySet<string> => {
  const found = new Set<string>()
  const add = (isScript: boolean, hash: Uint8Array): void => {
    found.add(`${isScript ? "script" : "key"}.${toHex(hash)}`)
  }
  for (const address of userAddresses) {
    const header = address[0] & 0xf0
    if (address.length === 29 && header >= 0xe0) add((address[0] & 0x10) !== 0, address.subarray(1))
    if (address.length === 57 && header <= 0x30) add((address[0] & 0x20) !== 0, address.subarray(29))
  }
  return found
}

const credentialKey = (credential: Credential): string =>
  `${credential._tag === "KeyHash" ? "key" : "script"}.${toHex(credential.hash)}`

/** Exhaustive by type: a certificate the decoder learns to read must be answered for here too. */
const acts = (
  certificate: Certificate
): {
  readonly credential: Credential | null
  readonly role: CredentialRole | null
  readonly pool: Uint8Array | null
  readonly drep: DRep | null
} => {
  switch (certificate._tag) {
    case "StakeRegistration":
    case "StakeDeregistration":
    case "Registration":
    case "Deregistration":
      return { credential: certificate.credential, role: "stake", pool: null, drep: null }
    case "RegisterDrep":
    case "UnregisterDrep":
    case "UpdateDrep":
      return { credential: certificate.credential, role: "drep", pool: null, drep: null }
    case "StakeDelegation":
    case "StakeRegistrationDelegation":
      return { credential: certificate.credential, role: "stake", pool: certificate.poolKeyHash, drep: null }
    case "VoteDelegation":
    case "VoteRegistrationDelegation":
      return { credential: certificate.credential, role: "stake", pool: null, drep: certificate.drep }
    case "StakeVoteDelegation":
    case "StakeVoteRegistrationDelegation":
      return {
        credential: certificate.credential,
        role: "stake",
        pool: certificate.poolKeyHash,
        drep: certificate.drep
      }
    case "PoolRegistration":
      return { credential: null, role: null, pool: certificate.params.operator, drep: null }
    case "PoolRetirement":
      return { credential: null, role: null, pool: certificate.poolKeyHash, drep: null }
    case "AuthorizeCommitteeHot":
    case "ResignCommitteeCold":
      return { credential: certificate.cold, role: "committee-cold", pool: null, drep: null }
    default:
      return Function.absurd(certificate)
  }
}

/**
 * Every certificate the body carries, in the order it carries them, with the
 * deposit or refund `deposits.ts` reads for it attached.
 */
export const deriveCertificates = (
  derivation: Derivation
): Either.Either<ReadonlyArray<CertificateEffect>, DerivationError> => {
  const start = spending(derivation)
  if (Either.isLeft(start)) return Either.left(start.left)
  const { body } = derivation.transaction

  const { deposits, refunds } = readDeposits(body, derivation.protocolParameters)
  const at = (of: ReadonlyArray<Deposit>, index: number): Deposit | null =>
    of.find((one) => one.source === "certificate" && one.index === index) ?? null

  const mine = stakeCredentials(derivation.userAddresses)

  return Either.right(
    body.certificates.map((certificate, index) => {
      const { credential, drep, pool, role } = acts(certificate)
      return {
        kind: certificate._tag,
        credential,
        role,
        // Namespace does not decide this: a DRep credential the wallet
        // reported is a key it holds, and calling an honest DRep registration
        // someone else's would block one.
        ours: credential !== null && mine.has(credentialKey(credential)),
        pool,
        drep,
        deposit: at(deposits, index),
        refund: at(refunds, index),
        index
      }
    })
  )
}

/** One entry per reward account, whatever the bytes wrote, ordered by account. */
export const deriveWithdrawals = (
  derivation: Derivation
): Either.Either<ReadonlyArray<WithdrawalEffect>, DerivationError> => {
  const start = spending(derivation)
  if (Either.isLeft(start)) return Either.left(start.left)
  const { ours } = start.right

  const summed = new Map<string, { rewardAccount: Uint8Array; amount: bigint }>()
  for (const withdrawal of derivation.transaction.body.withdrawals) {
    const key = toHex(withdrawal.rewardAccount)
    const held = summed.get(key) ?? { rewardAccount: withdrawal.rewardAccount, amount: 0n }
    held.amount += withdrawal.amount
    summed.set(key, held)
  }

  return Either.right(
    [...summed]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, held]) => ({ ...held, ours: ours(held.rewardAccount) }))
  )
}

/**
 * Every asset the transaction creates or destroys, signed: a burn is negative.
 * Ordered by policy then name, like every other list here.
 */
export const deriveMint = (derivation: Derivation): Either.Either<ReadonlyArray<AssetAmount>, DerivationError> => {
  const start = spending(derivation)
  if (Either.isLeft(start)) return Either.left(start.left)

  // Added together per asset, for the reason the withdrawals are: the mint is a
  // CBOR map nothing forces to be distinct, and a policy written twice would
  // otherwise render as two lines — or as a mint and a burn of an asset the
  // transaction creates none of.
  const summed = new Map<string, AssetAmount>()
  for (const policy of derivation.transaction.body.mint) {
    for (const asset of policy.assets) {
      const key = assetKey(policy.policyId, asset.name)
      const held = summed.get(key)
      summed.set(
        key,
        held === undefined
          ? { policyId: policy.policyId, name: asset.name, quantity: asset.quantity }
          : { ...held, quantity: held.quantity + asset.quantity }
      )
    }
  }

  return Either.right(
    [...summed].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, asset]) => asset)
  )
}

/** The body's validity interval, as the instants a person can be shown. */
export const deriveValidity = (derivation: Derivation): Either.Either<ValidityWindow, DerivationError> => {
  const start = spending(derivation)
  if (Either.isLeft(start)) return Either.left(start.left)
  const { body } = derivation.transaction
  const { slots } = derivation.protocolParameters

  const at = (slot: bigint | null): SlotTime | null => (slot === null ? null : { slot, time: timeOfSlot(slot, slots) })
  return Either.right({ validFrom: at(body.validityIntervalStart), validUntil: at(body.validityIntervalEnd) })
}
