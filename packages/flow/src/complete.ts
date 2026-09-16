/**
 * The whole path: build against what the wallet holds, judge it with the
 * verifier's own engine, sign, submit. When the funds move underneath, every
 * one of those happens again — a rebuilt transaction is a different transaction,
 * and asking for a signature on it without deriving its effects first would put
 * a person's name on something nobody read.
 */
import type { Intent, Network } from "@cardano-slips/core"
import { compare, decodeTransaction, deriveEffects, type Effects } from "@cardano-slips/verifier"
import { Effect, Either } from "effect"

import { balanceIntent, type BalancingParameters } from "./balance.js"
import type { BalanceError } from "./balance-error.js"
import type { Cip30Api } from "./cip30.js"
import { type CompletionError, refuse } from "./complete-error.js"
import { asResolvedInputs } from "./resolve.js"
import { signTransaction, submitTransaction } from "./sign.js"
import type { SigningError } from "./sign-error.js"
import { readWalletUtxos } from "./utxo.js"
import { transactionIdOf } from "./witness.js"

/** Enough rebuilds to outlast an unlucky moment, few enough that nobody is asked forever. */
const defaultAttempts = 3

export type Attempt = {
  /** Counting from one, so a rendered "attempt 2 of 3" reads as a person would say it. */
  readonly number: number
  readonly transactionId: string
  /** What this transaction does, derived from its own bytes. */
  readonly effects: Effects
}

export type CompletionRequest = {
  readonly api: Cip30Api
  /** What the endpoint declared, and what the transaction is judged against. */
  readonly intent: Intent
  readonly network: Network
  readonly changeAddress: string
  /**
   * Every address the wallet calls its own, its reward account included. An
   * address missing from here is read as a stranger's, which turns the wallet's
   * own change into an undeclared payment and blocks the Slip.
   */
  readonly userAddresses: ReadonlyArray<Uint8Array>
  readonly parameters: BalancingParameters
  readonly rewardBalance?: bigint
  /** Read once per attempt: a rebuilt transaction gets its own validity window. */
  readonly now?: () => number
  /** How many times the transaction may be built. Beyond this the funds are moving faster than we can follow. */
  readonly attempts?: number
  /** Called once per attempt, after the effects are derived and before the wallet is asked to sign. */
  readonly onAttempt?: (attempt: Attempt) => void
}

export type Receipt = {
  readonly transactionId: string
  readonly effects: Effects
  /** How many transactions it took, which is how many times the funds moved plus one. */
  readonly attempts: number
}

type Failure = BalanceError | CompletionError | SigningError

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))

const walletUtxos = (api: Cip30Api) =>
  Effect.gen(function* () {
    const answered = yield* Effect.tryPromise({
      try: () => api.getUtxos(),
      catch: (cause) => refuse("UnreadableUtxos", "The wallet could not say what it holds.", { cause })
    })

    // `null` is CIP-30's own answer for a wallet with nothing to give.
    const hexes = answered ?? []
    const read = readWalletUtxos(hexes)
    if (Either.isLeft(read)) {
      return yield* Effect.fail(
        refuse("UnreadableUtxos", `The wallet's unspent outputs could not be read: ${read.left}`)
      )
    }
    if (read.right.length === 0) {
      return yield* Effect.fail(refuse("NoUtxos", "This wallet holds nothing to pay with."))
    }
    return read.right
  })

/**
 * One transaction, from the wallet's outputs to a verdict. The judging happens
 * here rather than at the caller so that no path reaches `signTransaction`
 * without having passed it.
 */
const buildAndJudge = (request: CompletionRequest, number: number) =>
  Effect.gen(function* () {
    const utxos = yield* walletUtxos(request.api)
    const now = (request.now ?? Date.now)()

    const built = yield* balanceIntent({
      intent: request.intent,
      network: request.network,
      changeAddress: request.changeAddress,
      utxos,
      parameters: request.parameters,
      ...(request.rewardBalance === undefined ? {} : { rewardBalance: request.rewardBalance }),
      now
    })

    const transaction = decodeTransaction(fromHex(built.cbor))
    if (Either.isLeft(transaction)) {
      return yield* Effect.fail(
        refuse("CannotJudge", `This transaction could not be read back: ${transaction.left.message}`)
      )
    }

    const effects = deriveEffects({
      transaction: transaction.right,
      userAddresses: request.userAddresses,
      resolvedInputs: asResolvedInputs(utxos),
      protocolParameters: request.parameters
    })
    if (Either.isLeft(effects)) {
      return yield* Effect.fail(
        refuse("CannotJudge", `What this transaction does could not be worked out: ${effects.left.message}`)
      )
    }

    const verdict = compare({
      effects: effects.right,
      declared: request.intent,
      changeAddress: request.changeAddress,
      now: BigInt(now),
      protocolParameters: request.parameters
    })
    if (Either.isLeft(verdict)) {
      return yield* Effect.fail(
        refuse(
          "CannotJudge",
          `This transaction could not be checked against what was declared: ${verdict.left.message}`
        )
      )
    }

    if (verdict.right._tag === "mismatch") {
      return yield* Effect.fail(
        refuse("Blocked", "This transaction does not do what the Slip said it would, so it will not be signed.", {
          reasons: verdict.right.reasons
        })
      )
    }

    const transactionId = yield* transactionIdOf(built.cbor)
    const attempt: Attempt = { number, transactionId, effects: effects.right }

    // The caller is what puts these effects in front of a person. If that
    // throws, the person has not seen them, so this fails closed rather than
    // carrying on to a signature — and as a refusal rather than a stack trace.
    yield* Effect.try({
      try: () => request.onAttempt?.(attempt),
      catch: (cause) => refuse("NotShown", "This transaction could not be shown, so it will not be signed.", { cause })
    })

    return { cbor: built.cbor, attempt }
  })

/**
 * Completes the Slip, or says why not. A submission that failed because an
 * input was spent is the one failure worth repeating: everything else either
 * cannot be helped by a rebuild or is a person having said no.
 */
export const completeIntent = (request: CompletionRequest): Effect.Effect<Receipt, Failure> =>
  Effect.gen(function* () {
    const allowed = Math.max(1, request.attempts ?? defaultAttempts)

    for (let number = 1; number <= allowed; number += 1) {
      const { attempt, cbor } = yield* buildAndJudge(request, number)

      const signed = yield* signTransaction({
        api: request.api,
        transaction: cbor,
        transactionId: attempt.transactionId
      })

      const submitted = yield* Effect.either(submitTransaction(request.api, signed))
      if (Either.isRight(submitted)) {
        return { transactionId: submitted.right, effects: attempt.effects, attempts: number }
      }
      if (submitted.left.refusal !== "InputsSpent") {
        return yield* Effect.fail(submitted.left)
      }
    }

    return yield* Effect.fail(
      refuse(
        "OutOfAttempts",
        `The wallet's funds moved every time this was built, ${allowed} times over. Try again in a moment.`
      )
    )
  })
