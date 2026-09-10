/**
 * Why a comparison could not produce a verdict. Every one of these is a
 * declaration the engine cannot read — an endpoint sending something malformed
 * rather than something untrue, which a client reports as
 * `MALFORMED_RESPONSE` and never as a mismatch. Calling an unreadable
 * declaration a mismatch would tell a person the transaction lied when what
 * happened is that nobody could tell.
 */
import { Data } from "effect"

export type ComparisonRefusal =
  /** A declared output address that is not bech32, or whose checksum fails. */
  | "DeclaredAddress"
  /** A declared pool id that is not bech32. */
  | "DeclaredPool"
  /** A declared DRep id that is neither bech32 nor one of the two predefined votes. */
  | "DeclaredDRep"
  /** A `validUntil` that is not an instant this protocol writes. */
  | "DeclaredInstant"
  /** The change address the client passed in. The one term here that is the client's own. */
  | "ChangeAddress"

/** Exhaustive by type, and `test/compare-refusals.test.ts` fails if any of them stops being reachable. */
export const comparisonRefusals: Readonly<Record<ComparisonRefusal, true>> = {
  DeclaredAddress: true,
  DeclaredPool: true,
  DeclaredDRep: true,
  DeclaredInstant: true,
  ChangeAddress: true
}

export class ComparisonError extends Data.TaggedError("ComparisonError")<{
  readonly refusal: ComparisonRefusal
  readonly detail: string
}> {
  override get message(): string {
    return `${this.refusal}: ${this.detail}`
  }
}

export const cannotCompare = (refusal: ComparisonRefusal, detail: string): ComparisonError =>
  new ComparisonError({ refusal, detail })
