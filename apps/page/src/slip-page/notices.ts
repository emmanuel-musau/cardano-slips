/**
 * What the page says when it cannot show a card: `8 · Page states` d–m. Each
 * notice names whose failure it was, says nothing was signed, and offers one
 * move matched to the failure's class.
 */
import type { ExchangeError } from "@cardano-slips/flow"

/** `bad` and `hold` are the sheet's red and amber edges; `plain` is an ordinary card. */
export type Tone = "bad" | "hold" | "plain"

/**
 * A retry where the same request may succeed, the publisher's own site where
 * nothing here can help, back to the card where the person can change their
 * answer, or the wallets that would work where none is installed.
 */
export type Move = "retry" | "site" | "back" | "wallets" | "none"

export type Notice = {
  readonly tone: Tone
  readonly title: string
  readonly text: string
  /** The endpoint's own message, which the spec has a client render on every failure it can read. */
  readonly said?: string
  /** For the integrator, in the caption. Never in the sentence. */
  readonly code?: string
  readonly move: Move
  /** Where the sheet names the move more precisely than "Try again". */
  readonly moveLabel?: string
}

const saidBy = (failure: ExchangeError): { readonly said?: string } =>
  failure.endpointMessage === undefined ? {} : { said: failure.endpointMessage }

const codeOf = (failure: ExchangeError): { readonly code?: string } =>
  failure.code === undefined ? {} : { code: failure.code }

const notFound = (failure: ExchangeError): boolean =>
  failure.code === "NOT_FOUND" || (failure.code === undefined && (failure.status === 404 || failure.status === 410))

export const noticeFor = (failure: ExchangeError, host: string): Notice => {
  const shared = { ...saidBy(failure), ...codeOf(failure) }

  if (notFound(failure)) {
    return {
      tone: "bad",
      title: "This link doesn't point to anything",
      text: `${host} has no action at this address. It may have been removed, or the link may be mistyped.`,
      move: "site",
      ...shared
    }
  }

  if (failure.code === "RATE_LIMITED") {
    return {
      tone: "plain",
      title: "Too many requests just now",
      text: `${host} is asking us to slow down. Nothing was signed. This usually clears in a moment.`,
      move: "retry",
      ...shared
    }
  }

  if (failure.code === "UNSUPPORTED_VERSION") {
    return {
      tone: "plain",
      title: "This link speaks a newer version",
      text: `${host} is using a newer version of this protocol. This page understands version 1, and guessing at the difference isn't safe.`,
      move: "site",
      ...shared
    }
  }

  if (failure.code === "MALFORMED_RESPONSE") {
    return {
      tone: "bad",
      title: `${host} sent something this page can't read`,
      text: "Nothing was sent and nothing was signed. The link may be broken on their side.",
      move: "site",
      ...shared
    }
  }

  if (failure.errorClass === "transient") {
    return {
      tone: "bad",
      title: `${host} didn't respond`,
      text: "Nothing was sent and nothing was signed.",
      move: "retry",
      ...shared
    }
  }

  return {
    tone: "bad",
    title: `${host} couldn't open this action`,
    text: "Nothing was sent and nothing was signed.",
    move: "site",
    ...shared
  }
}

export const insecureLink: Notice = {
  tone: "bad",
  title: "This isn't a link this page can open",
  text: "Slip links start with https://, so the page can tell who is answering. Nothing was sent and nothing was signed.",
  move: "none"
}

export const noLink: Notice = {
  tone: "plain",
  title: "Nothing to open yet",
  text: "This page opens Cardano Slip links. Follow one from wherever it was shared, and it will open here.",
  move: "none"
}

/** Attempts before the retry is withdrawn: bounded, as the spec requires. */
export const maxRetries = 5

/**
 * Seconds before the next attempt may go: the endpoint's `Retry-After`, at
 * least a second, and doubling each time so a struggling publisher is not hammered.
 */
export const retryDelay = (retriesSoFar: number, retryAfter: number | undefined): number =>
  Math.max(retryAfter ?? 1, 2 ** retriesSoFar)

/** `8 · f`: only after an action is chosen, and it never blames the person or the link. */
export const noWallet: Notice = {
  tone: "hold",
  title: "No Cardano wallet in this browser",
  text: "You'll need a CIP-30 wallet extension to sign. The action itself is fine — nothing here has failed.",
  move: "wallets"
}

/** `8 · k`: the card still renders; the refusal is the build, and it is a statement about this page. */
export const serverBuild: Notice = {
  tone: "plain",
  title: "This link builds on a server",
  text: "It asks to assemble the transaction for you. This page only builds in your browser, so nothing was sent.",
  code: "UNSUPPORTED_BUILD_MODE",
  move: "back"
}
