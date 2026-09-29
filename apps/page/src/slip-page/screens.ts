/**
 * Where the page goes when the flow stops: back to the card, a fresh read of
 * the Slip, a notice, the mismatch block, or one of the outcomes in section 10.
 * Every failure the flow can produce lands on exactly one of them.
 */
import type { Network } from "@cardano-slips/core"
import {
  balanceErrorCodeFor,
  type BalanceError,
  type CompletionError,
  type Derived,
  type ExchangeError,
  type FieldError,
  type Outcome,
  type SigningError,
  type WalletConnectError
} from "@cardano-slips/flow"

import { type Notice, noticeFor } from "./notices.js"

export type FlowFailure = WalletConnectError | ExchangeError | BalanceError | CompletionError | SigningError

type Reasons = NonNullable<CompletionError["reasons"]>

export type Screen =
  | { readonly _tag: "Card"; readonly rejected?: Readonly<Record<string, FieldError>> }
  /** The Slip changed state between GET and POST; the spec has the client read it again. */
  | { readonly _tag: "Refetch" }
  | { readonly _tag: "Notice"; readonly notice: Notice; readonly retryAfter?: number }
  | { readonly _tag: "Blocked"; readonly derived: Derived; readonly reasons: Reasons }
  | { readonly _tag: "Outcome"; readonly outcome: Outcome }

export type ScreenContext = {
  readonly host: string
  readonly network: Network
  /** The parameters of the action that was submitted: the only fields the card can draw a refusal beside. */
  readonly fields?: ReadonlyArray<string>
}

const notice = (value: Notice): Screen => ({ _tag: "Notice", notice: value })

const notEnough: Notice = {
  tone: "plain",
  title: "Not enough in your wallet",
  text: "Your wallet doesn't hold enough for this with the network fee on top. Nothing was sent and nothing was signed.",
  code: "INSUFFICIENT_FUNDS",
  move: "retry",
  moveLabel: "Check again"
}

const cannotBalance: Notice = {
  tone: "plain",
  title: "This couldn't be built from your wallet",
  text: "You may hold enough, but not in a shape this can be assembled from. Nothing was signed.",
  code: "CANNOT_BALANCE",
  move: "site"
}

const walletTrouble: Notice = {
  tone: "bad",
  title: "Your wallet didn't answer the way this page needs",
  text: "Nothing was sent and nothing was signed. Trying again usually helps; if it doesn't, the wallet may need updating.",
  move: "retry"
}

const wrongNetwork = (network: Network): Notice => ({
  tone: "hold",
  title: network === "mainnet" ? "Your wallet is on a test network" : "Your wallet is on mainnet",
  text: `This is a ${network} action. Switch networks in your wallet, then try again.`,
  code: "WRONG_NETWORK",
  move: "retry"
})

const connectScreen = (failure: WalletConnectError, { network }: ScreenContext): Screen => {
  switch (failure.refusal) {
    // Declining the connection is an answer, not a fault: the card is where they were.
    case "Refused":
      return { _tag: "Card" }
    case "WrongNetwork":
      return notice(wrongNetwork(network))
    case "NotInjected":
    case "NotCip30":
    case "EnableFailed":
    case "Unreadable":
      return notice(walletTrouble)
  }
}

const exchangeScreen = (failure: ExchangeError, { fields = [], host }: ScreenContext): Screen => {
  if (failure.code === "INVALID_PARAMETER" && failure.field !== undefined && fields.includes(failure.field)) {
    return {
      _tag: "Card",
      rejected: { [failure.field]: { message: failure.endpointMessage ?? "This value was turned down." } }
    }
  }
  if (failure.code === "UNAVAILABLE" || failure.code === "EXPIRED") return { _tag: "Refetch" }
  if (failure.errorClass === "request") {
    return notice({
      tone: "plain",
      title: `${host} turned this down`,
      text: "Nothing was sent and nothing was signed.",
      move: "back",
      ...(failure.code === undefined ? {} : { code: failure.code }),
      ...(failure.endpointMessage === undefined ? {} : { said: failure.endpointMessage })
    })
  }
  return {
    _tag: "Notice",
    notice: noticeFor(failure, host),
    ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter })
  }
}

const balanceScreen = (failure: BalanceError, context: ScreenContext): Screen => {
  switch (balanceErrorCodeFor(failure.refusal)) {
    case "INSUFFICIENT_FUNDS":
      return notice(notEnough)
    case "WRONG_NETWORK":
      return notice(wrongNetwork(context.network))
    case "INTENT_EXPIRED":
      return notice({
        tone: "plain",
        title: "This ran out of time before it was built",
        text: "Nothing was signed. Asking again fetches a fresh one.",
        code: "INTENT_EXPIRED",
        move: "retry"
      })
    default:
      return notice(cannotBalance)
  }
}

const completionScreen = (failure: CompletionError): Screen => {
  switch (failure.refusal) {
    case "Cancelled":
      return { _tag: "Card" }
    case "Blocked":
      // Always carried on a block; its absence would be a bug in flow, and the safe reading is still a block.
      return failure.derived === undefined
        ? notice({ ...walletTrouble, title: "Signing blocked", move: "back" })
        : { _tag: "Blocked", derived: failure.derived, reasons: failure.reasons ?? [] }
    case "NoUtxos":
      return notice(notEnough)
    case "CannotJudge":
      return notice(cannotBalance)
    case "OutOfAttempts":
      return notice({
        tone: "plain",
        title: "Your funds kept moving",
        text: "Something else kept spending from your wallet while this was being built. Nothing was signed twice and nothing left your wallet.",
        move: "retry"
      })
    case "UnreadableUtxos":
    case "UnreadableAddresses":
    case "NotShown":
      return notice(walletTrouble)
  }
}

/** The node's own words where the wallet passed them on, never a paraphrase of a ledger rule. */
const nodeReason = (failure: SigningError): string => failure.cip30?.info || failure.detail

const signingScreen = (failure: SigningError): Screen => {
  switch (failure.refusal) {
    case "Declined":
      return { _tag: "Outcome", outcome: { _tag: "Declined" } }
    case "SubmitFailed":
    case "IntervalPassed":
    case "InputsSpent":
      return { _tag: "Outcome", outcome: { _tag: "Refused", reason: nodeReason(failure) } }
    // The wallet took the transaction before naming another, so it may be on the chain.
    case "WrongTransactionId":
      return notice({
        tone: "hold",
        title: "Your wallet may have sent something",
        text: "It accepted the signed transaction, then named a different one, so this page can't tell what reached the network. Check your wallet's history before trying again, or you may pay twice.",
        move: "back"
      })
    case "SignFailed":
    case "UnreadableTransaction":
    case "WrongBody":
    case "UnreadableWitnesses":
    case "UnexpectedWitnessMaterial":
    case "NoWitnesses":
      return notice({ ...walletTrouble, title: "Your wallet couldn't sign this" })
  }
}

export const screenFor = (failure: FlowFailure, context: ScreenContext): Screen => {
  switch (failure._tag) {
    case "WalletConnectError":
      return connectScreen(failure, context)
    case "ExchangeError":
      return exchangeScreen(failure, context)
    case "BalanceError":
      return balanceScreen(failure, context)
    case "CompletionError":
      return completionScreen(failure)
    case "SigningError":
      return signingScreen(failure)
  }
}
