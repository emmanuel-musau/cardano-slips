/**
 * `signTx` → witness assembly → `submitTx`. CIP-30 returns a **witness set**,
 * never a signed transaction (invariant 4), so the body a person was shown and
 * the body that reaches the chain are joined here or nowhere.
 */
import { Effect } from "effect"

import { type CborHex, type Cip30Api, readApiError, REFUSED, USER_DECLINED } from "./cip30.js"
import { refuse, type SigningError } from "./sign-error.js"
import { assembleWitnesses, requireSameBody } from "./witness.js"

export type SignRequest = {
  readonly api: Cip30Api
  /** The complete unsigned transaction. */
  readonly transaction: CborHex
  /**
   * The id of the body the effects were derived from, from `transactionIdOf`.
   * Required, not derived here: a signature is bound to the body a person was
   * shown, and a function that recomputed the id from the bytes in front of it
   * would bind it to whatever it was handed.
   */
  readonly transactionId: string
}

export type SignedTransaction = {
  /** The body with the witnesses in it: what `submitTx` takes. */
  readonly cbor: CborHex
  /** Unchanged by signing, because witnesses live outside the body. */
  readonly transactionId: string
}

/** What the wallet said, kept whole so a message names its own cause. */
const said = (cause: unknown): string => {
  const error = readApiError(cause)
  if (error === undefined) return String(cause)
  return error.info === "" ? `code ${error.code}` : error.info
}

/**
 * Signs, or says why not. Nothing is asked of the wallet until the transaction
 * is known to be the one the effects were derived from.
 */
export const signTransaction = ({
  api,
  transaction,
  transactionId
}: SignRequest): Effect.Effect<SignedTransaction, SigningError> =>
  Effect.gen(function* () {
    yield* requireSameBody(transaction, transactionId)

    const witnesses = yield* Effect.tryPromise({
      // `partialSign: true`: the wallet signs what it holds keys for and leaves
      // the rest, rather than refusing a transaction a co-signer completes.
      try: () => api.signTx(transaction, true),
      catch: (cause) => {
        const error = readApiError(cause)
        // `-3` is `APIError`'s refusal, which wallets send from `signTx` in
        // practice even though CIP-30 numbers a decline `2` here.
        if (error?.code === USER_DECLINED || error?.code === REFUSED) {
          return refuse("Declined", "The signature was declined in the wallet.", { cip30: error, cause })
        }
        return refuse("SignFailed", `The wallet could not sign this transaction: ${said(cause)}`, {
          ...(error === undefined ? {} : { cip30: error }),
          cause
        })
      }
    })

    const cbor = yield* assembleWitnesses(transaction, witnesses, transactionId)
    return { cbor, transactionId }
  })

/** The ledger's own name for an input that is no longer there — what the rebuild path watches for. */
const spentInputs = /BadInputsUTxO/i

/** The ledger's name for a transaction that arrived outside its validity interval. */
const outsideInterval = /OutsideValidityInterval/i

const submissionFailure = (cause: unknown): SigningError => {
  const error = readApiError(cause)
  const detail = said(cause)
  const extra = { ...(error === undefined ? {} : { cip30: error }), cause }

  if (spentInputs.test(detail)) {
    return refuse("InputsSpent", "The wallet's funds moved before this transaction reached the chain.", extra)
  }
  if (outsideInterval.test(detail)) {
    return refuse("IntervalPassed", "This transaction expired before it reached the chain.", extra)
  }
  return refuse("SubmitFailed", `This transaction was not accepted: ${detail}`, extra)
}

/**
 * Submits, and holds the wallet to the transaction it was given: an id other
 * than the one we assembled is a receipt for something else, and showing it
 * would tell a person their transaction is on the chain when another one is.
 */
export const submitTransaction = (api: Cip30Api, signed: SignedTransaction): Effect.Effect<string, SigningError> =>
  Effect.gen(function* () {
    const returned = yield* Effect.tryPromise({
      try: () => api.submitTx(signed.cbor),
      catch: submissionFailure
    })

    // Typed to answer with the id and under no obligation to: reading a method
    // off whatever it did answer would reach a person as a stack trace.
    if (typeof returned !== "string") {
      return yield* Effect.fail(refuse("WrongTransactionId", "The wallet did not name the transaction it submitted."))
    }

    if (returned.toLowerCase() !== signed.transactionId.toLowerCase()) {
      return yield* Effect.fail(
        refuse("WrongTransactionId", "The wallet submitted a different transaction from the one it was given.")
      )
    }

    return signed.transactionId
  })
