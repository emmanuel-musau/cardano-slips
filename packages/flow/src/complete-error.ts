/**
 * Why a Slip did not reach the chain, for the failures that belong to the whole
 * path rather than to building, signing or submitting alone. `Blocked` is the
 * one that matters: it is invariant 3 in the error channel, and there is no
 * field on it that lets anyone past.
 */
import { type ClientErrorCode } from "@cardano-slips/core"
import type { Reason } from "@cardano-slips/verifier"
import { Data } from "effect"

export type CompletionRefusal =
  /** The wallet reported no unspent outputs, so there is nothing to build from. */
  | "NoUtxos"
  /** What `getUtxos` answered is not something these bytes can be read as. */
  | "UnreadableUtxos"
  /** The effects could not be derived from the transaction, or compared with the declaration. */
  | "CannotJudge"
  /** The derived effects disagree with what the endpoint declared. Nothing signs after this. */
  | "Blocked"
  /** The caller could not put the effects in front of a person, so nothing may be signed. */
  | "NotShown"
  /** The funds kept moving, and the transaction has been rebuilt as often as it will be. */
  | "OutOfAttempts"

/**
 * Exhaustive by type: adding a refusal above without listing it here fails to
 * compile, and `test/complete.test.ts` fails if any of them stops being reachable.
 */
export const completionRefusals: Readonly<Record<CompletionRefusal, true>> = {
  NoUtxos: true,
  UnreadableUtxos: true,
  CannotJudge: true,
  Blocked: true,
  NotShown: true,
  OutOfAttempts: true
}

export const slipErrorCodeFor = (refusal: CompletionRefusal): ClientErrorCode | undefined => {
  switch (refusal) {
    case "Blocked":
      return "EFFECTS_MISMATCH"
    case "NoUtxos":
      return "INSUFFICIENT_FUNDS"
    case "CannotJudge":
      return "CANNOT_BALANCE"
    case "UnreadableUtxos":
    case "NotShown":
    case "OutOfAttempts":
      return undefined
  }
}

/**
 * `reasons` is what the transaction actually does against what was declared,
 * for the block to render. There is no way to carry on from one — a mismatch
 * hard-blocks, with no override, no allowlist and no confirmation.
 */
export class CompletionError extends Data.TaggedError("CompletionError")<{
  readonly refusal: CompletionRefusal
  readonly detail: string
  readonly reasons?: ReadonlyArray<Reason>
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
  refusal: CompletionRefusal,
  detail: string,
  extra: { readonly reasons?: ReadonlyArray<Reason>; readonly cause?: unknown } = {}
): CompletionError =>
  new CompletionError({
    refusal,
    detail,
    ...(extra.reasons === undefined ? {} : { reasons: extra.reasons }),
    ...(extra.cause === undefined ? {} : { cause: extra.cause })
  })
