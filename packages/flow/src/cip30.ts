/**
 * The CIP-30 surface this client calls, declared here because evolution-sdk's
 * `WalletApi` omits `getChangeAddress`, `getCollateral` and `getNetworkId`
 * while the object a wallet actually hands back carries all three (ADR-0004).
 * A typing we assert rather than one the SDK guarantees, so it is proved
 * against a stubbed provider rather than trusted.
 */

/** Hex-encoded CBOR: the only form CIP-30 speaks, and the form `verifier` decodes. */
export type CborHex = string

export type Paginate = { readonly page: number; readonly limit: number }

export type SignedData = { readonly signature: CborHex; readonly key: CborHex }

export interface Cip30Api {
  readonly getNetworkId: () => Promise<number>
  readonly getChangeAddress: () => Promise<CborHex>
  readonly getUsedAddresses: (paginate?: Paginate) => Promise<ReadonlyArray<CborHex>>
  readonly getUnusedAddresses: () => Promise<ReadonlyArray<CborHex>>
  readonly getRewardAddresses: () => Promise<ReadonlyArray<CborHex>>
  readonly getBalance: () => Promise<CborHex>
  /** `null` where the wallet has nothing to give, per CIP-30. */
  readonly getUtxos: (amount?: CborHex, paginate?: Paginate) => Promise<ReadonlyArray<CborHex> | null>
  readonly getCollateral: (params?: { readonly amount: CborHex }) => Promise<ReadonlyArray<CborHex> | null>
  /** Returns a **witness set**, never a signed transaction — invariant 4 is CIP-30's own shape. */
  readonly signTx: (tx: CborHex, partialSign?: boolean) => Promise<CborHex>
  readonly signData: (address: CborHex, payload: CborHex) => Promise<SignedData>
  readonly submitTx: (tx: CborHex) => Promise<string>
}

/** What an extension injects at `window.cardano[key]`, before anyone calls `enable()`. */
export interface Cip30Provider {
  readonly apiVersion: string
  readonly name: string
  readonly icon: string
  readonly supportedExtensions?: ReadonlyArray<{ readonly cip: number }>
  readonly enable: (extensions?: ReadonlyArray<{ readonly cip: number }>) => Promise<Cip30Api>
  readonly isEnabled: () => Promise<boolean>
}

const isFunction = (value: unknown): boolean => typeof value === "function"

/**
 * Shape, not name: `window.cardano` is a namespace anything may write to, and a
 * key that does not answer these four is not a connector whatever it is called.
 */
export const isCip30Provider = (value: unknown): value is Cip30Provider => {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isFunction(candidate.enable) &&
    isFunction(candidate.isEnabled) &&
    typeof candidate.name === "string" &&
    typeof candidate.apiVersion === "string"
  )
}

/** The methods we call. A provider may enable and still not answer them. */
const apiMethods = ["getNetworkId", "getChangeAddress", "getUsedAddresses", "getUtxos", "signTx", "submitTx"] as const

export const isCip30Api = (value: unknown): value is Cip30Api => {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return apiMethods.every((method) => isFunction(candidate[method]))
}

/** CIP-30's `APIError`, kept whole: the numeric code is what says a person declined. */
export type Cip30ApiError = { readonly code: number; readonly info: string }

/** The four `APIError` codes CIP-30 defines. Anything else is passed through as its number. */
export const apiErrorNames: Readonly<Record<number, string>> = {
  [-1]: "InvalidRequest",
  [-2]: "InternalError",
  [-3]: "Refused",
  [-4]: "AccountChange"
}

/** `-3` is the person saying no, which is not a fault and must not be shown as one. */
export const REFUSED = -3

/** A wallet rejects with a plain `{ code, info }` object, not an `Error`. */
export const readApiError = (cause: unknown): Cip30ApiError | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined
  const candidate = cause as Record<string, unknown>
  if (typeof candidate.code !== "number") return undefined
  return { code: candidate.code, info: typeof candidate.info === "string" ? candidate.info : "" }
}

export const describeApiError = (error: Cip30ApiError): string => {
  const name = apiErrorNames[error.code]
  const label = name === undefined ? `code ${error.code}` : name
  return error.info === "" ? label : `${label}: ${error.info}`
}
