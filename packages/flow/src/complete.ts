/**
 * The whole path: build against what the wallet holds, judge it with the
 * verifier's own engine, sign, submit. When the funds move underneath, every
 * one of those happens again — a rebuilt transaction is a different transaction,
 * and asking for a signature on it without deriving its effects first would put
 * a person's name on something nobody read.
 */
import type { Intent, Network } from "@cardano-slips/core"
import {
  compare,
  decodeBech32,
  decodeTransaction,
  deriveAssets,
  deriveEffects,
  deriveLovelace,
  type Effects,
  type ResolvedInput
} from "@cardano-slips/verifier"
import { Effect, Either } from "effect"

import { readOwnAddress } from "./address.js"
import { balanceIntent, type BalancingParameters } from "./balance.js"
import type { BalanceError } from "./balance-error.js"
import { type Cip30Api, describeApiError, readApiError } from "./cip30.js"
import { type CompletionError, refuse } from "./complete-error.js"
import { networkIdFor } from "./connect.js"
import type { Derived } from "./derived.js"
import { asResolvedInputs } from "./resolve.js"
import { signTransaction, submitTransaction } from "./sign.js"
import type { SigningError } from "./sign-error.js"
import { readWalletUtxos } from "./utxo.js"
import { transactionIdOf } from "./witness.js"

/** Enough rebuilds to outlast an unlucky moment, few enough that nobody is asked forever. */
const defaultAttempts = 3

export type Attempt = Derived & {
  /** Counting from one, so a rendered "attempt 2 of 3" reads as a person would say it. */
  readonly number: number
  readonly transactionId: string
}

/** Where the path has got to after the person agreed, for a screen that says so. */
export type Progress =
  /** The wallet has been asked for a signature on this transaction. */
  | { readonly _tag: "Signing"; readonly transactionId: string }
  /** The witnesses are in the body and the wallet has been asked to submit it. */
  | { readonly _tag: "Submitting"; readonly transactionId: string }
  /** The funds moved under the last transaction; attempt `number` of `of` is being built. */
  | { readonly _tag: "Rebuilding"; readonly number: number; readonly of: number }

export type CompletionRequest = {
  readonly api: Cip30Api
  /** What the endpoint declared, and what the transaction is judged against. */
  readonly intent: Intent
  readonly network: Network
  readonly changeAddress: string
  readonly parameters: BalancingParameters
  readonly rewardBalance?: bigint
  /** Read once per attempt: a rebuilt transaction gets its own validity window. */
  readonly now?: () => number
  /** How many times the transaction may be built. Beyond this the funds are moving faster than we can follow. */
  readonly attempts?: number
  /** Called once per attempt, after the effects are derived and before the wallet is asked to sign. */
  readonly onAttempt?: (attempt: Attempt) => void
  /**
   * Resolves `true` once the person has pressed sign on this attempt, `false`
   * if they turned it down. Asked again for every rebuilt transaction, because
   * agreeing to one body is not agreeing to the next. Without it, showing the
   * effects is taken as agreement.
   */
  readonly confirm?: (attempt: Attempt) => Promise<boolean>
  readonly onProgress?: (progress: Progress) => void
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

const addressesFrom = (api: Cip30Api, method: "getUsedAddresses" | "getUnusedAddresses" | "getRewardAddresses") =>
  Effect.tryPromise({
    try: () => api[method](),
    catch: (cause) => {
      const cip30 = readApiError(cause)
      const said = cip30 === undefined ? String(cause) : describeApiError(cip30)
      return refuse("UnreadableAddresses", `The wallet could not say which addresses are its own: ${said}`, { cause })
    }
  }).pipe(
    Effect.filterOrFail(
      (answered): answered is ReadonlyArray<string> => Array.isArray(answered),
      () => refuse("UnreadableAddresses", `The wallet answered ${method} with something that is not a list.`)
    )
  )

/**
 * Every address the wallet vouches for: those CIP-30 lists, the change address,
 * and the address of every output it said it holds. Read with the outputs on
 * each attempt, since both can change when the funds move. One missing is read
 * as a stranger's, and its value would be shown as someone else's. The outputs'
 * addresses are ahead of the spec's list, until
 * https://github.com/emmanuel-musau/cardano-slips/issues/186 brings it into line.
 */
const ownAddresses = (request: CompletionRequest, inputs: ReadonlyArray<ResolvedInput>) =>
  Effect.gen(function* () {
    const listed = [
      ...(yield* addressesFrom(request.api, "getUsedAddresses")),
      ...(yield* addressesFrom(request.api, "getUnusedAddresses")),
      ...(yield* addressesFrom(request.api, "getRewardAddresses"))
    ]

    const network = networkIdFor(request.network)
    const read: Array<Uint8Array> = []
    for (const hex of listed) {
      const address = readOwnAddress(hex)
      if (Either.isLeft(address)) {
        return yield* Effect.fail(
          refuse("UnreadableAddresses", `The wallet named an address of its own that cannot be read: ${address.left}`)
        )
      }
      if (address.right.networkId !== undefined && address.right.networkId !== network) {
        return yield* Effect.fail(
          refuse("UnreadableAddresses", "The wallet named an address on another network as its own.")
        )
      }
      read.push(address.right.bytes)
    }

    const change = decodeBech32(request.changeAddress)
    if (Either.isLeft(change)) {
      return yield* Effect.fail(refuse("UnreadableAddresses", "The change address is not an address."))
    }

    return [...read, change.right.bytes, ...inputs.map((input) => input.address)]
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

    const resolvedInputs = asResolvedInputs(utxos)
    const derivation = {
      transaction: transaction.right,
      userAddresses: yield* ownAddresses(request, resolvedInputs),
      resolvedInputs,
      protocolParameters: request.parameters
    }
    const read = Either.all({
      effects: deriveEffects(derivation),
      lovelace: deriveLovelace(derivation),
      assets: deriveAssets(derivation)
    })
    if (Either.isLeft(read)) {
      return yield* Effect.fail(
        refuse("CannotJudge", `What this transaction does could not be worked out: ${read.left.message}`)
      )
    }
    const derived: Derived = read.right

    const verdict = compare({
      effects: derived.effects,
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
          reasons: verdict.right.reasons,
          derived
        })
      )
    }

    const transactionId = yield* transactionIdOf(built.cbor)
    const attempt: Attempt = { ...derived, number, transactionId }

    // The caller is what puts these effects in front of a person. If that
    // throws, the person has not seen them, so this fails closed rather than
    // carrying on to a signature — and as a refusal rather than a stack trace.
    yield* Effect.try({
      try: () => request.onAttempt?.(attempt),
      catch: (cause) => refuse("NotShown", "This transaction could not be shown, so it will not be signed.", { cause })
    })

    return { cbor: built.cbor, attempt }
  })

/** A progress report is a courtesy to the screen; one that throws must not stop a submission already under way. */
const report = (request: CompletionRequest, progress: Progress): void => {
  try {
    request.onProgress?.(progress)
  } catch {
    // Nothing to do: the flow carries on, and the next state the screen is given corrects it.
  }
}

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

      const { confirm } = request
      if (confirm !== undefined) {
        const agreed = yield* Effect.tryPromise({
          try: () => confirm(attempt),
          catch: (cause) =>
            refuse("NotShown", "This transaction could not be put to you, so it will not be signed.", { cause })
        })
        if (!agreed) {
          return yield* Effect.fail(refuse("Cancelled", "The transaction was closed without signing."))
        }
      }

      report(request, { _tag: "Signing", transactionId: attempt.transactionId })
      const signed = yield* signTransaction({
        api: request.api,
        transaction: cbor,
        transactionId: attempt.transactionId
      })

      report(request, { _tag: "Submitting", transactionId: attempt.transactionId })
      const submitted = yield* Effect.either(submitTransaction(request.api, signed))
      if (Either.isRight(submitted)) {
        return { transactionId: submitted.right, effects: attempt.effects, attempts: number }
      }
      if (submitted.left.refusal !== "InputsSpent") {
        return yield* Effect.fail(submitted.left)
      }
      if (number < allowed) report(request, { _tag: "Rebuilding", number: number + 1, of: allowed })
    }

    return yield* Effect.fail(
      refuse(
        "OutOfAttempts",
        `The wallet's funds moved every time this was built, ${allowed} times over. Try again in a moment.`
      )
    )
  })
