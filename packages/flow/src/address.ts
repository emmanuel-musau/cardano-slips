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
