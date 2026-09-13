/**
 * Why an intent did not become a transaction. Every refusal carries a spec
 * error code, because each one is a failure of the exchange the spec describes
 * rather than a state of a browser extension (`wallet-error.ts` is the other
 * half, and deliberately has refusals that carry no code).
 */
import { type ClientErrorCode } from "@cardano-slips/core"
import { Data } from "effect"

export type BalanceRefusal =
  /** `validUntil` has already passed. A fresh POST returns a fresh intent. */
  | "IntentExpired"
  /** An address in the intent encodes a different network from the Slip's. */
  | "ForeignAddress"
  /** A certificate or withdrawal needs the wallet's stake credential and the address carries none. */
  | "NoStakeCredential"
  /** The change address the wallet gave is not an address these bytes can be read as. */
  | "UnreadableChangeAddress"
  /** The intent withdraws rewards and nobody said what the reward balance is. */
  | "RewardBalanceUnknown"
  /** The wallet cannot cover the intent, the minimum ADA its outputs require, and the fee. */
  | "InsufficientFunds"
  /** The intent cannot be built into a valid transaction for any other reason. */
  | "CannotBalance"

/**
 * Exhaustive by type: adding a refusal above without listing it here fails to
 * compile, and `test/balance.test.ts` fails if any of them stops being reachable.
 */
export const balanceRefusals: Readonly<Record<BalanceRefusal, true>> = {
  IntentExpired: true,
  ForeignAddress: true,
  NoStakeCredential: true,
  UnreadableChangeAddress: true,
  RewardBalanceUnknown: true,
  InsufficientFunds: true,
  CannotBalance: true
}

/**
 * A wrong-network address is `MALFORMED_RESPONSE` and not `WRONG_NETWORK`:
 * the latter is a disagreement the person can act on by switching wallets, and
 * an endpoint that sent an address on another chain is not one of those.
 */
export const slipErrorCodeFor = (refusal: BalanceRefusal): ClientErrorCode => {
  switch (refusal) {
    case "IntentExpired":
      return "INTENT_EXPIRED"
    case "ForeignAddress":
      return "MALFORMED_RESPONSE"
    case "InsufficientFunds":
      return "INSUFFICIENT_FUNDS"
    case "NoStakeCredential":
    case "UnreadableChangeAddress":
    case "RewardBalanceUnknown":
    case "CannotBalance":
      return "CANNOT_BALANCE"
  }
}

/** `cause` keeps what evolution-sdk said, so a build failure stays diagnosable. */
export class BalanceError extends Data.TaggedError("BalanceError")<{
  readonly refusal: BalanceRefusal
  readonly detail: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return this.detail
  }

  get code(): ClientErrorCode {
    return slipErrorCodeFor(this.refusal)
  }
}

export const refuse = (refusal: BalanceRefusal, detail: string, cause?: unknown): BalanceError =>
  new BalanceError({ refusal, detail, ...(cause === undefined ? {} : { cause }) })
