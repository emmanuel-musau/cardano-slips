/**
 * What a transaction does to a person's lovelace, derived from the body, the
 * values of the inputs it spends and the protocol parameters in force. Nothing
 * here asks anything of the network: every term arrives as an argument.
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

const assetKeys = (assets: MultiAsset): string =>
  assets
    .flatMap((policy) =>
      policy.assets.map((asset) => `${toHex(policy.policyId)}.${toHex(asset.name)}=${asset.quantity}`)
    )
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
 * The one way in. Refuses rather than guesses: an input with no supplied value
 * would otherwise count as zero, which is exactly how a spend gets hidden.
 */
export const deriveLovelace = ({
  protocolParameters,
  resolvedInputs,
  transaction,
  userAddresses
}: Derivation): Either.Either<LovelaceEffects, DerivationError> => {
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

  const ours = new Set(userAddresses.map(toHex))
  const { body } = transaction

  let spent = 0n
  let inputs = 0n
  for (const input of body.inputs) {
    const found = resolved.right.get(outpoint(input))
    if (found === undefined) {
      return Either.left(cannotDerive("UnresolvedInput", `no value was supplied for ${outpoint(input)}`))
    }
    inputs += found.value.coin
    if (ours.has(toHex(found.address))) spent += found.value.coin
  }

  let received = 0n
  let outputs = 0n
  for (const output of body.outputs) {
    outputs += output.value.coin
    if (ours.has(toHex(output.address))) received += output.value.coin
  }

  let withdrawn = 0n
  let withdrawnInTotal = 0n
  for (const withdrawal of body.withdrawals) {
    withdrawnInTotal += withdrawal.amount
    if (ours.has(toHex(withdrawal.rewardAccount))) withdrawn += withdrawal.amount
  }

  const { deposits, refunds } = readDeposits(body, protocolParameters)
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
