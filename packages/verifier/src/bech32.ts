/**
 * Bech32, as CIP-19 uses it: the BIP-173 encoding with the 90-character limit
 * dropped, since a Cardano address is longer than that. Both directions are
 * here — an intent declares addresses and pool ids as bech32 and a body carries
 * bytes, and a block that names the address nobody declared has to write it
 * back out in the form the person would recognise.
 */
import { Either } from "effect"

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

export type Bech32Refusal =
  /** No separator, an empty half, or a character outside the charset. */
  | "Malformed"
  /** The checksum does not verify, so the string is not the one that was written. */
  | "BadChecksum"

export type Bech32Error = { readonly refusal: Bech32Refusal; readonly detail: string }

const refuse = (refusal: Bech32Refusal, detail: string): Either.Either<never, Bech32Error> =>
  Either.left({ refusal, detail })

const polymod = (values: ReadonlyArray<number>): number => {
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < 5; bit++) if (((top >>> bit) & 1) === 1) checksum ^= GENERATOR[bit]
  }
  return checksum
}

const expandPrefix = (prefix: string): Array<number> => {
  const high: Array<number> = []
  const low: Array<number> = []
  for (const character of prefix) {
    high.push(character.charCodeAt(0) >>> 5)
    low.push(character.charCodeAt(0) & 31)
  }
  return [...high, 0, ...low]
}

/**
 * Regroups bits. Writing pads the last group; reading refuses every case
 * BIP-173 calls invalid — a non-zero remainder, or padding wide enough to hold
 * another group. A reader that tolerates either accepts two strings for one set
 * of bytes, and an address that can be written two ways is an address a
 * comparison can be walked past.
 */
const regroup = (values: ReadonlyArray<number>, from: number, to: number, pad: boolean): Array<number> | null => {
  let accumulator = 0
  let bits = 0
  const result: Array<number> = []
  const maximum = (1 << to) - 1
  for (const value of values) {
    if (value < 0 || value >>> from !== 0) return null
    accumulator = (accumulator << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      result.push((accumulator >>> bits) & maximum)
    }
  }
  if (pad) {
    if (bits > 0) result.push((accumulator << (to - bits)) & maximum)
    return result
  }
  if (bits >= from || ((accumulator << (to - bits)) & maximum) !== 0) return null
  return result
}

export type Bech32 = { readonly prefix: string; readonly bytes: Uint8Array }

/**
 * Lowercase only. BIP-173 also defines an all-uppercase form, but every
 * Cardano identifier this protocol carries is written lowercase and the
 * partial intent's schema requires it, so accepting a second spelling would
 * only add a way to write the same address twice.
 */
export const decodeBech32 = (text: string): Either.Either<Bech32, Bech32Error> => {
  if (text !== text.toLowerCase()) return refuse("Malformed", "a bech32 string here is written in lower case")

  const separator = text.lastIndexOf("1")
  if (separator < 1) return refuse("Malformed", "there is no prefix before a separator")
  const prefix = text.slice(0, separator)
  const data = text.slice(separator + 1)
  if (data.length < 6) return refuse("Malformed", "the data part is shorter than its own checksum")

  const values: Array<number> = []
  for (const character of data) {
    const value = CHARSET.indexOf(character)
    if (value === -1) return refuse("Malformed", `${character} is not a bech32 character`)
    values.push(value)
  }

  for (const character of prefix) {
    const code = character.charCodeAt(0)
    if (code < 33 || code > 126) return refuse("Malformed", "the prefix carries a character outside 33-126")
  }

  if (polymod([...expandPrefix(prefix), ...values]) !== 1) {
    return refuse("BadChecksum", `${text.slice(0, 12)}… does not check out`)
  }

  const bytes = regroup(values.slice(0, -6), 5, 8, false)
  if (bytes === null) return refuse("Malformed", "the data part does not regroup into whole bytes")
  return Either.right({ prefix, bytes: Uint8Array.from(bytes) })
}

/** Total: every byte string has an encoding, so there is nothing here to refuse. */
export const encodeBech32 = (prefix: string, bytes: Uint8Array): string => {
  const values = regroup([...bytes], 8, 5, true) ?? []
  const checksum = polymod([...expandPrefix(prefix), ...values, 0, 0, 0, 0, 0, 0]) ^ 1
  const tail: Array<number> = []
  for (let index = 0; index < 6; index++) tail.push((checksum >>> (5 * (5 - index))) & 31)
  return `${prefix}1${[...values, ...tail].map((value) => CHARSET[value]).join("")}`
}
