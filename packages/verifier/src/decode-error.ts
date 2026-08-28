/**
 * Why a transaction was refused, and where in the bytes it happened. Every
 * reason raises rather than skips (ADR-0010): an effect the decoder never saw
 * is an effect the user never sees either.
 */
import { Data } from "effect"

export type DecodeRefusal =
  /** The bytes ran out mid-value. */
  | "Truncated"
  /** A complete transaction, then more bytes after it. */
  | "TrailingBytes"
  /** Conway transactions are `[body, witness set, is-valid, auxiliary data]`. */
  | "NotAFourItemArray"
  /** The first item of that array was not a CBOR map. */
  | "BodyNotAMap"
  /** An integer body key outside the modelled set. This is what era drift looks like from in here. */
  | "UnknownBodyKey"
  /** The same body key twice: two readers could disagree about which one counts. */
  | "DuplicateBodyKey"
  /** A body key whose CBOR key was not an integer at all. */
  | "BodyKeyNotAnInteger"
  /** A certificate type outside the modelled set. */
  | "UnknownCertificateType"
  /** An output that is neither a legacy array nor a post-alonzo map. */
  | "UnknownOutputForm"
  /** A post-alonzo output carrying a key we do not model. */
  | "UnknownOutputKey"
  /** A governance action whose index we do not model. */
  | "UnknownGovernanceAction"
  /** A tag somewhere the CDDL puts no tag, or a tag we do not model. */
  | "UnexpectedTag"
  /** A float anywhere in the body. Ledger values are exact; a float is never one of them. */
  | "Float"
  /** `undefined`, or a simple value beyond true, false and null. */
  | "UnmodelledSimpleValue"
  /** A CBOR head that RFC 8949 does not define, such as additional information 28. */
  | "MalformedHead"
  /** Text that is not valid UTF-8. */
  | "MalformedText"
  /** A modelled field carrying the wrong CBOR shape, or a value outside its declared range. */
  | "MalformedField"

/**
 * Exhaustive by type: adding a refusal above without listing it here fails to
 * compile, and `test/decode-refusals.test.ts` fails if any of them stops being
 * reachable. A rule nothing can trip is a comment, not a guarantee.
 */
export const decodeRefusals: Readonly<Record<DecodeRefusal, true>> = {
  Truncated: true,
  TrailingBytes: true,
  NotAFourItemArray: true,
  BodyNotAMap: true,
  UnknownBodyKey: true,
  DuplicateBodyKey: true,
  BodyKeyNotAnInteger: true,
  UnknownCertificateType: true,
  UnknownOutputForm: true,
  UnknownOutputKey: true,
  UnknownGovernanceAction: true,
  UnexpectedTag: true,
  Float: true,
  UnmodelledSimpleValue: true,
  MalformedHead: true,
  MalformedText: true,
  MalformedField: true
}

/**
 * `at` is a byte offset into the transaction the caller handed us, so a refusal
 * can be pointed at rather than described.
 */
export class TransactionDecodeError extends Data.TaggedError("TransactionDecodeError")<{
  readonly refusal: DecodeRefusal
  readonly at: number
  readonly detail: string
}> {
  override get message(): string {
    return `${this.refusal} at byte ${this.at}: ${this.detail}`
  }
}

export const refuse = (refusal: DecodeRefusal, at: number, detail: string): TransactionDecodeError =>
  new TransactionDecodeError({ refusal, at, detail })
