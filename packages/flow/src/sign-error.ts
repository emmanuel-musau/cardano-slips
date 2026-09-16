/**
 * Why a transaction was not signed, or not submitted. One error, a closed set
 * of refusals, because the client renders a state per refusal and a state
 * nothing can produce is a screen nobody sees.
 */
import { type ClientErrorCode } from "@cardano-slips/core"
import { Data } from "effect"

import { type Cip30ApiError } from "./cip30.js"

export type SignRefusal =
  /** The bytes we hold are not a transaction these bytes can be read as. */
  | "UnreadableTransaction"
  /** This is not the body the effects were derived from, so nothing may be signed into it. */
  | "WrongBody"
  /** The person said no in the wallet. Not a fault. */
  | "Declined"
  /** The wallet tried to sign and could not, or rejected for a reason of its own. */
  | "SignFailed"
  /** What came back is not a witness set — a whole transaction included. */
  | "UnreadableWitnesses"
  /** The set carries script or datum material the body was never judged with. */
  | "UnexpectedWitnessMaterial"
  /** The set carries no signature, so assembling it would leave the transaction unsigned. */
  | "NoWitnesses"
  /** Submission failed because an input was spent between building and signing. */
  | "InputsSpent"
  /** The validity interval passed before the transaction reached the chain. */
  | "IntervalPassed"
  /** Submission failed for any other reason. */
  | "SubmitFailed"
  /** The wallet submitted, and named a transaction other than the one we assembled. */
  | "WrongTransactionId"

/**
 * Exhaustive by type: adding a refusal above without listing it here fails to
 * compile, and `test/sign.test.ts` fails if any of them stops being reachable.
 */
export const signRefusals: Readonly<Record<SignRefusal, true>> = {
  UnreadableTransaction: true,
  WrongBody: true,
  Declined: true,
  SignFailed: true,
  UnreadableWitnesses: true,
  UnexpectedWitnessMaterial: true,
  NoWitnesses: true,
  InputsSpent: true,
  IntervalPassed: true,
  SubmitFailed: true,
  WrongTransactionId: true
}

/**
 * Only the passed interval has a spec code, because only it is a failure of the
 * exchange the spec describes — the intent outlived its own `validUntil`. The
 * rest are states of a wallet or of the chain, and a protocol code on one of
 * those would say the endpoint answered when nothing was ever asked of it
 * (`wallet-error.ts` draws the same line).
 */
export const slipErrorCodeFor = (refusal: SignRefusal): ClientErrorCode | undefined =>
  refusal === "IntervalPassed" ? "INTENT_EXPIRED" : undefined

/** `cip30` is the wallet's own `{ code, info }`, kept so a decline stays distinguishable from a crash. */
export class SigningError extends Data.TaggedError("SigningError")<{
  readonly refusal: SignRefusal
  readonly detail: string
  readonly cip30?: Cip30ApiError
  readonly cause?: unknown
}> {
  override get message(): string {
    return this.detail
  }

  get code(): ClientErrorCode | undefined {
    return slipErrorCodeFor(this.refusal)
  }
}

export const refuse = (
  refusal: SignRefusal,
  detail: string,
  extra: { readonly cip30?: Cip30ApiError; readonly cause?: unknown } = {}
): SigningError =>
  new SigningError({
    refusal,
    detail,
    ...(extra.cip30 === undefined ? {} : { cip30: extra.cip30 }),
    ...(extra.cause === undefined ? {} : { cause: extra.cause })
  })
