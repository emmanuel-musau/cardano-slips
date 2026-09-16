/**
 * The transaction id, and the witnesses that may go into the body it names.
 * Pure: nothing here talks to a wallet, so what assembly accepts can be stated
 * as a rule rather than observed against an extension.
 */
import { extractTransactionBody } from "@cardano-slips/verifier"
import { Transaction, TransactionWitnessSet } from "@evolution-sdk/evolution"
import { blake2b } from "@noble/hashes/blake2.js"
import { Effect, Either } from "effect"

import type { CborHex } from "./cip30.js"
import { refuse, type SigningError } from "./sign-error.js"

const hex = /^[0-9a-fA-F]*$/

const bytesOf = (value: CborHex): Uint8Array | undefined => {
  if (value.length % 2 !== 0 || !hex.test(value)) return undefined
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  )
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

/**
 * BLAKE2b-256 over the body's original bytes, never a re-encode: this is the id
 * the chain computes, and it is CIP-0186's commit — what binds a returned
 * witness set to the body whose effects a person was shown.
 */
export const transactionIdOf = (transaction: CborHex): Effect.Effect<string, SigningError> => {
  const bytes = bytesOf(transaction)
  if (bytes === undefined) {
    return Effect.fail(refuse("UnreadableTransaction", "This transaction is not readable as CBOR."))
  }
  const body = extractTransactionBody(bytes)
  if (Either.isLeft(body)) {
    return Effect.fail(
      refuse("UnreadableTransaction", `This transaction is not readable: ${body.left.message}`, { cause: body.left })
    )
  }
  return Effect.succeed(toHex(blake2b(body.right.bodyBytes, { dkLen: 32 })))
}

/**
 * What a version 1 transaction is never signed with. We build nothing that
 * spends from a script, so any of these in a returned set is material the body
 * was not judged with, and merging it would let a wallet add to a transaction
 * after the moment it was shown.
 */
const unexpected = (set: TransactionWitnessSet.TransactionWitnessSet): string | undefined => {
  if ((set.nativeScripts ?? []).length > 0) return "native scripts"
  if ((set.bootstrapWitnesses ?? []).length > 0) return "bootstrap witnesses"
  if ((set.plutusV1Scripts ?? []).length > 0) return "Plutus v1 scripts"
  if ((set.plutusV2Scripts ?? []).length > 0) return "Plutus v2 scripts"
  if ((set.plutusV3Scripts ?? []).length > 0) return "Plutus v3 scripts"
  if ((set.plutusData ?? []).length > 0) return "datums"
  if (set.redeemers !== undefined) return "redeemers"
  return undefined
}

const readWitnessSet = (witnesses: CborHex): Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, SigningError> =>
  Effect.try({
    try: () => TransactionWitnessSet.fromCBORHex(witnesses),
    catch: (cause) =>
      refuse("UnreadableWitnesses", "The wallet answered with something that is not a witness set.", { cause })
  })

/**
 * Refuses unless this is the body the effects were derived from. Asked twice —
 * before the wallet is given anything, and again as assembly begins — because
 * either moment is one where the transaction can stop being the one on screen.
 */
export const requireSameBody = (transaction: CborHex, transactionId: string): Effect.Effect<void, SigningError> =>
  Effect.flatMap(transactionIdOf(transaction), (held) =>
    held === transactionId
      ? Effect.void
      : Effect.fail(
          refuse("WrongBody", "This is not the transaction the effects were derived from, so it will not be signed.")
        )
  )

/**
 * Appends a returned witness set to the body it was asked for, or says why not.
 * `transactionId` is the id the effects were derived from: witnesses go into
 * that body or into none, which is what makes what a person was shown the thing
 * they signed.
 */
export const assembleWitnesses = (
  transaction: CborHex,
  witnesses: CborHex,
  transactionId: string
): Effect.Effect<CborHex, SigningError> =>
  Effect.gen(function* () {
    yield* requireSameBody(transaction, transactionId)

    const set = yield* readWitnessSet(witnesses)

    const material = unexpected(set)
    if (material !== undefined) {
      return yield* Effect.fail(
        refuse(
          "UnexpectedWitnessMaterial",
          `The wallet answered with ${material}, which this transaction never asked for.`
        )
      )
    }

    // evolution-sdk returns the transaction untouched for an empty set, so
    // without this an unsigned transaction would go to `submitTx` looking signed.
    if ((set.vkeyWitnesses ?? []).length === 0) {
      return yield* Effect.fail(refuse("NoWitnesses", "The wallet answered without a signature."))
    }

    // Appends to `vkeyWitnesses` and re-encodes from the format the transaction
    // arrived in, so a co-signer's witness survives and the body keeps its bytes.
    const assembled = yield* Effect.try({
      try: () => Transaction.addVKeyWitnessesHex(transaction, witnesses),
      catch: (cause) =>
        refuse("UnreadableWitnesses", "The wallet's witnesses could not be assembled into the transaction.", { cause })
    })

    // The body is what the id is taken over, so an id that moved means the
    // bytes moved — and the person would be signing something else.
    const after = yield* transactionIdOf(assembled)
    if (after !== transactionId) {
      return yield* Effect.fail(
        refuse("WrongBody", "Assembling the signature changed the transaction, so it will not be submitted.")
      )
    }

    return assembled
  })
