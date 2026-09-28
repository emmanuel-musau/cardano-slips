/**
 * CIP-30 hands addresses back as hex; the endpoint is sent bech32, because that
 * is what a `BuildRequest` carries and what a person can recognise. The
 * conversion is also the second statement of network — the header byte says
 * which chain the address is for, and a wallet whose `getNetworkId` disagrees
 * with its own address has answered two ways.
 */
import { PaymentAddress } from "@cardano-slips/core"
import { encodeBech32 } from "@cardano-slips/verifier"
import { Either, Schema } from "effect"

/** CIP-30's `getNetworkId`: 1 is mainnet, 0 is every test network. */
export type NetworkId = 0 | 1

export type WalletAddress = {
  readonly bech32: string
  readonly networkId: NetworkId
}

const decodePaymentAddress = Schema.decodeUnknownEither(PaymentAddress)

const refuse = (detail: string): Either.Either<never, string> => Either.left(detail)

const fromHex = (hex: string): Uint8Array | undefined => {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return undefined
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

/**
 * CIP-30 calls the value "the CBOR of the address" and wallets ship the address
 * bytes bare. Both are accepted, and they cannot be confused: `0x58` as a first
 * byte is a CBOR byte string of up to 255 bytes, and as an address header it
 * would claim network 8, which does not exist.
 */
const unwrapCbor = (bytes: Uint8Array): Uint8Array =>
  bytes.length > 2 && bytes[0] === 0x58 && bytes[1] === bytes.length - 2 ? bytes.subarray(2) : bytes

/** CIP-19: the header's high nibble is the address type, the low nibble the network. Types 0-7 can hold a payment. */
const LAST_PAYMENT_TYPE = 7

/**
 * Reads what CIP-30 returned. `Either` and not a throw: this runs on whatever a
 * browser extension chose to send, and every refusal reaches a person as words.
 */
export const readWalletAddress = (hex: string): Either.Either<WalletAddress, string> => {
  const raw = fromHex(hex.trim())
  if (raw === undefined) return refuse(`${hex.slice(0, 16)}… is not hex`)

  const bytes = unwrapCbor(raw)
  const header = bytes[0]

  const networkId = header & 0x0f
  if (networkId !== 0 && networkId !== 1) return refuse(`the address header names network ${networkId}`)

  const type = header >> 4
  if (type > LAST_PAYMENT_TYPE) {
    // A reward address (14, 15) or a Byron address (8) cannot receive change.
    return refuse(`address type ${type} cannot hold a payment`)
  }

  const bech32 = encodeBech32(networkId === 1 ? "addr" : "addr_test", bytes)
  return Either.match(decodePaymentAddress(bech32), {
    onLeft: () => refuse(`${bech32.slice(0, 16)}… is not a payment address`),
    onRight: () => Either.right({ bech32, networkId: networkId as NetworkId })
  })
}

export type OwnAddress = {
  /** Raw, as the verifier compares them against the body's addresses. */
  readonly bytes: Uint8Array
  /** Absent for a Byron address, whose header carries no network. */
  readonly networkId?: NetworkId
}

const BYRON_TYPE = 8
const FIRST_REWARD_TYPE = 14
const LAST_REWARD_TYPE = 15

/** A header byte and one or two 28-byte hashes. */
const shelleyLengths: Readonly<Record<number, ReadonlyArray<number>>> = {
  0: [57],
  1: [57],
  2: [57],
  3: [57],
  6: [29],
  7: [29],
  14: [29],
  15: [29]
}

/**
 * Reads an address the wallet calls its own: any payment address, a reward
 * account, or a Byron address an old wallet still reports as used. Refusing
 * the Byron one would stop the whole flow over an address nothing here spends.
 */
export const readOwnAddress = (hex: unknown): Either.Either<OwnAddress, string> => {
  // Typed as hex by CIP-30, and sent by an extension under no obligation to.
  const raw = typeof hex === "string" ? fromHex(hex.trim()) : undefined
  if (raw === undefined) return refuse(`${String(hex).slice(0, 16)}… is not hex`)

  const bytes = unwrapCbor(raw)
  const header = bytes[0]
  const type = header >> 4
  if (type === BYRON_TYPE) return Either.right({ bytes })

  const networkId = header & 0x0f
  if (networkId !== 0 && networkId !== 1) return refuse(`the address header names network ${networkId}`)

  const payment = type <= LAST_PAYMENT_TYPE
  const reward = type >= FIRST_REWARD_TYPE && type <= LAST_REWARD_TYPE
  if (!payment && !reward) return refuse(`address type ${type} is not one a wallet holds`)

  // Pointer addresses (4, 5) end in variable-length integers, so only a floor applies.
  const lengths = shelleyLengths[type]
  const fits = lengths === undefined ? bytes.length > 29 : lengths.includes(bytes.length)
  if (!fits) return refuse(`${bytes.length} bytes is the wrong length for address type ${type}`)

  return Either.right({ bytes, networkId: networkId as NetworkId })
}
