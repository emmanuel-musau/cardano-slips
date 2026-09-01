/**
 * What a transaction does to a person's lovelace and to their native assets,
 * derived from the body, the values of the inputs it spends and the protocol
 * parameters in force. Nothing here asks anything of the network: every term
 * arrives as an argument.
 */
import { Either } from "effect"

import { toHex } from "./bytes.js"
import type { DecodedTransaction, MultiAsset, TransactionInput, Value } from "./decode.js"
import type { DerivationError } from "./derive-error.js"
import { cannotDerive } from "./derive-error.js"
import type { Deposit } from "./deposits.js"
import { readDeposits, totalOf } from "./deposits.js"
import type { ProtocolParameters } from "./parameters.js"

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
