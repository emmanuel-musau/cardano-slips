import {
  BalanceError,
  type BalanceRefusal,
  balanceRefusals,
  CompletionError,
  type CompletionRefusal,
  completionRefusals,
  type ConnectRefusal,
  connectRefusals,
  type Derived,
  ExchangeError,
  SigningError,
  type SignRefusal,
  signRefusals,
  WalletConnectError
} from "@cardano-slips/flow"
import { describe, expect, it } from "vitest"

import { ParametersError } from "../src/slip-page/parameters.js"
import { type FlowFailure, type Screen, screenFor } from "../src/slip-page/screens.js"

/**
 * Every refusal the flow can produce, walked from flow's own closed sets: a
 * refusal added there without a screen here fails the first test below.
 */

const context = { host: "linktap.example", network: "mainnet" } as const

const everyFailure: ReadonlyArray<FlowFailure> = [
  new ParametersError({ network: "mainnet", detail: "answered 502" }),
  ...(Object.keys(connectRefusals) as Array<ConnectRefusal>).map(
    (refusal) => new WalletConnectError({ refusal, key: "lace", detail: refusal })
  ),
  ...(Object.keys(balanceRefusals) as Array<BalanceRefusal>).map(
    (refusal) => new BalanceError({ refusal, detail: refusal })
  ),
  ...(Object.keys(completionRefusals) as Array<CompletionRefusal>).map(
    (refusal) => new CompletionError({ refusal, detail: refusal })
  ),
  ...(Object.keys(signRefusals) as Array<SignRefusal>).map((refusal) => new SigningError({ refusal, detail: refusal }))
]

const tagOf = (failure: FlowFailure): Screen["_tag"] => screenFor(failure, context)._tag

describe("every failure the flow can produce", () => {
  it.each(everyFailure.map((failure) => [`${failure._tag} ${"refusal" in failure ? failure.refusal : ""}`, failure]))(
    "lands on a screen: %s",
    (_, failure) => {
      expect(["Card", "Refetch", "Notice", "Blocked", "Outcome"]).toContain(tagOf(failure))
    }
  )

  it("never lands a notice with nowhere to go but a dead end", () => {
    for (const failure of everyFailure) {
      const screen = screenFor(failure, context)
      if (screen._tag === "Notice") expect(screen.notice.move).not.toBe("none")
    }
  })
})

describe("where each kind of failure goes", () => {
  it("returns to the card when the person said no to the connection or closed the preview", () => {
    expect(tagOf(new WalletConnectError({ refusal: "Refused", key: "lace", detail: "" }))).toBe("Card")
    expect(tagOf(new CompletionError({ refusal: "Cancelled", detail: "" }))).toBe("Card")
  })

  it("blocks with what the transaction does, and never offers a way past it", () => {
    const derived = { effects: {}, lovelace: {}, assets: {} } as unknown as Derived
    const blocked = new CompletionError({ refusal: "Blocked", detail: "", derived, reasons: [] })
    expect(screenFor(blocked, context)).toMatchObject({ _tag: "Blocked", derived })

    // A block that somehow lost its evidence is still no signature.
    const bare = screenFor(new CompletionError({ refusal: "Blocked", detail: "" }), context)
    expect(bare._tag).toBe("Notice")
    expect(bare._tag === "Notice" && bare.notice.move).toBe("back")
  })

  it("takes a decline as an outcome, and a refused submission as the node's own words", () => {
    expect(screenFor(new SigningError({ refusal: "Declined", detail: "" }), context)).toEqual({
      _tag: "Outcome",
      outcome: { _tag: "Declined" }
    })
    const refused = new SigningError({
      refusal: "SubmitFailed",
      detail: "not accepted",
      cip30: { code: 2, info: "FeeTooSmallUTxO" }
    })
    expect(screenFor(refused, context)).toEqual({
      _tag: "Outcome",
      outcome: { _tag: "Refused", reason: "FeeTooSmallUTxO" }
    })
  })

  it("says a wallet behind the chain has not caught up, rather than that the funds kept moving", () => {
    const screen = screenFor(new CompletionError({ refusal: "WalletBehind", detail: "just spent" }), context)
    expect(screen._tag).toBe("Notice")
    if (screen._tag !== "Notice") return
    expect(screen.notice.title).toBe("Your wallet hasn't caught up yet")
    expect(screen.notice.move).toBe("retry")
  })

  it("says an expired transaction ran out of time in plain words, and offers to start again", () => {
    const expired = new SigningError({
      refusal: "IntervalPassed",
      detail: "expired",
      cip30: { code: 2, info: "OutsideValidityIntervalUTxO (ValidityInterval {invalidBefore = SNothing})" }
    })
    const screen = screenFor(expired, context)
    expect(screen._tag).toBe("Notice")
    if (screen._tag !== "Notice") return
    expect(screen.notice.title).toBe("This transaction ran out of time")
    expect(screen.notice.text).not.toMatch(/ValidityInterval/)
    expect(screen.notice.code).toBe("INTENT_EXPIRED")
    expect(screen.notice.move).toBe("retry")
    expect(screen.notice.moveLabel).toBe("Start again")
  })

  // The wallet took the transaction before naming another, so it may be on the chain; "Start again" could pay twice.
  it("never says nothing left the wallet once the wallet may have submitted", () => {
    const screen = screenFor(new SigningError({ refusal: "WrongTransactionId", detail: "different id" }), context)
    expect(screen._tag).toBe("Notice")
    if (screen._tag !== "Notice") return
    expect(screen.notice.text).not.toMatch(/nothing left your wallet|nothing was sent/i)
    expect(screen.notice.text).toMatch(/history/)
    expect(screen.notice.move).toBe("back")
  })

  it("puts a rejected value back on its field", () => {
    const rejected = new ExchangeError({
      code: "INVALID_PARAMETER",
      errorClass: "request",
      field: "amount",
      endpointMessage: "Too much.",
      detail: ""
    })
    expect(screenFor(rejected, { ...context, fields: ["amount"] })).toEqual({
      _tag: "Card",
      rejected: { amount: { message: "Too much." } }
    })
  })

  // The card draws a refusal only beside a field it shows; anywhere else it would vanish.
  it("says who turned it down when the rejected field is not one the person filled in", () => {
    const rejected = new ExchangeError({
      code: "INVALID_PARAMETER",
      errorClass: "request",
      field: "account",
      endpointMessage: "Unknown account.",
      detail: ""
    })
    const screen = screenFor(rejected, { ...context, fields: ["amount"] })
    expect(screen).toMatchObject({
      _tag: "Notice",
      notice: { title: "linktap.example turned this down", said: "Unknown account.", code: "INVALID_PARAMETER" }
    })
    expect(screenFor(rejected, context)._tag).toBe("Notice")
  })

  it.each(["UNAVAILABLE", "EXPIRED"])("reads the Slip again on %s, as the spec requires", (code) => {
    expect(tagOf(new ExchangeError({ code, errorClass: "terminal", detail: "" }))).toBe("Refetch")
  })

  it("carries the endpoint's Retry-After to the retry", () => {
    const limited = new ExchangeError({ code: "RATE_LIMITED", errorClass: "transient", retryAfter: 12, detail: "" })
    expect(screenFor(limited, context)).toMatchObject({ _tag: "Notice", retryAfter: 12 })
  })

  it("names which side is on which network", () => {
    const onMainnet = screenFor(new WalletConnectError({ refusal: "WrongNetwork", key: "lace", detail: "" }), {
      ...context,
      network: "preprod"
    })
    expect(onMainnet._tag === "Notice" && onMainnet.notice.title).toBe("Your wallet is on mainnet")
  })

  it("sends a node that refused the window to the wrong-network notice, not the node's own words", () => {
    const refused = screenFor(new CompletionError({ refusal: "WrongNetwork", detail: "" }), {
      ...context,
      network: "preprod"
    })
    expect(refused).toMatchObject({ _tag: "Notice", notice: { code: "WRONG_NETWORK", move: "retry" } })
    expect(refused._tag === "Notice" && refused.notice.title).toBe("Your wallet is on another test network")
  })

  it("tells running short apart from a wallet that cannot be shaped into the transaction", () => {
    const short = screenFor(new BalanceError({ refusal: "InsufficientFunds", detail: "" }), context)
    const shapeless = screenFor(new BalanceError({ refusal: "CannotBalance", detail: "" }), context)
    expect(short._tag === "Notice" && short.notice.code).toBe("INSUFFICIENT_FUNDS")
    expect(shapeless._tag === "Notice" && shapeless.notice.code).toBe("CANNOT_BALANCE")
  })
})

describe("protocol parameters the page could not read", () => {
  it("is a notice offering another try, with nothing built", () => {
    const screen = screenFor(new ParametersError({ network: "mainnet", detail: "answered 502" }), context)
    expect(screen).toMatchObject({ _tag: "Notice", notice: { move: "retry" } })
  })
})
