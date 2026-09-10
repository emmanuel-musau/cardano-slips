/**
 * Why a wallet did not reach a usable connection. One error, a closed set of
 * refusals, because the client renders a state per refusal and a state nothing
 * can produce is a screen nobody sees.
 */
import { type ClientErrorCode } from "@cardano-slips/core"
import { Data } from "effect"

import { type Cip30ApiError } from "./cip30.js"

export type ConnectRefusal =
  /** Nothing is injected under this key. The wallet was uninstalled, or never there. */
  | "NotInjected"
  /** Something is under the key that does not implement the connector. */
  | "NotCip30"
  /** The person declined the connection — CIP-30 `APIError` `-3`. Not a fault. */
  | "Refused"
  /** `enable()` rejected for another reason, or returned something that is not the API. */
  | "EnableFailed"
  /** A question the wallet did not answer, or answered with something that is not what it claims. */
  | "Unreadable"
  /** The wallet is on a different network from the one the Slip declares. */
  | "WrongNetwork"

/**
 * Exhaustive by type: adding a refusal above without listing it here fails to
 * compile, and `test/connect.test.ts` fails if any of them stops being reachable.
 */
export const connectRefusals: Readonly<Record<ConnectRefusal, true>> = {
  NotInjected: true,
  NotCip30: true,
  Refused: true,
  EnableFailed: true,
  Unreadable: true,
  WrongNetwork: true
}

/**
 * Only the network disagreement has a spec code, because only it is a failure
 * of the exchange the spec describes. The rest are states of a browser
 * extension, and dressing them in a protocol code would say the endpoint
 * answered when nothing was ever sent.
 */
export const slipErrorCodeFor = (refusal: ConnectRefusal): ClientErrorCode | undefined =>
  refusal === "WrongNetwork" ? "WRONG_NETWORK" : undefined

/** `cip30` is the wallet's own `{ code, info }`, kept so a `-3` stays distinguishable from a crash. */
export class WalletConnectError extends Data.TaggedError("WalletConnectError")<{
  readonly refusal: ConnectRefusal
  readonly key: string
  readonly detail: string
  readonly cip30?: Cip30ApiError
}> {
  override get message(): string {
    return `${this.key}: ${this.detail}`
  }

  get code(): ClientErrorCode | undefined {
    return slipErrorCodeFor(this.refusal)
  }
}

export const refuse = (
  refusal: ConnectRefusal,
  key: string,
  detail: string,
  cip30?: Cip30ApiError
): WalletConnectError => new WalletConnectError({ refusal, key, detail, ...(cip30 === undefined ? {} : { cip30 }) })
