/**
 * Why a derivation refused to produce a number. Each one is a case where
 * carrying on would mean guessing, and a guess at this point is shown to a
 * person as arithmetic.
 */
import { Data } from "effect"

export type DerivationRefusal =
  /** The caller supplied no value for an input the body spends. Treating it as zero hides a spend. */
  | "UnresolvedInput"
  /** Two different values for the same input. Whichever we picked, the other reading disagrees. */
  | "ConflictingResolvedInput"
  /** The is-valid flag is false: the ledger consumes collateral instead of the inputs, which this engine does not model. */
  | "ScriptsExpectedToFail"

/** Exhaustive by type, and `test/derive-refusals.test.ts` fails if any of them stops being reachable. */
export const derivationRefusals: Readonly<Record<DerivationRefusal, true>> = {
  UnresolvedInput: true,
  ConflictingResolvedInput: true,
  ScriptsExpectedToFail: true
}

export class DerivationError extends Data.TaggedError("DerivationError")<{
  readonly refusal: DerivationRefusal
  readonly detail: string
}> {
  override get message(): string {
    return `${this.refusal}: ${this.detail}`
  }
}

export const cannotDerive = (refusal: DerivationRefusal, detail: string): DerivationError =>
  new DerivationError({ refusal, detail })
