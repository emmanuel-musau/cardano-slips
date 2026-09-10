/**
 * Reading what the endpoint declared into the forms the comparison matches on.
 * An intent carries addresses and identifiers as bech32 text and a deadline as
 * an instant; a transaction body carries bytes and a slot. Everything here is
 * strict, because a lenient reader accepts two spellings of one address and an
 * address that can be written twice is one a comparison can be walked past.
 */
import { Either } from "effect"

import { decodeBech32, encodeBech32 } from "./bech32.js"
import type { ComparisonError, ComparisonRefusal } from "./compare-error.js"
import { cannotCompare } from "./compare-error.js"
import { toHex } from "./bytes.js"

const read = (
  refusal: ComparisonRefusal,
  text: string,
  prefixes: ReadonlyArray<string>
): Either.Either<{ readonly prefix: string; readonly bytes: Uint8Array }, ComparisonError> => {
  const decoded = decodeBech32(text)
  if (Either.isLeft(decoded)) return Either.left(cannotCompare(refusal, decoded.left.detail))
  if (!prefixes.includes(decoded.right.prefix)) {
    return Either.left(cannotCompare(refusal, `${decoded.right.prefix} is not one of ${prefixes.join(", ")}`))
  }
  return Either.right(decoded.right)
}

/**
 * A declared address, and the same address written back out. Both sides of the
 * comparison go through `encodeBech32`, so matching is on one spelling rather
 * than on whatever the endpoint typed.
 */
export const readAddress = (
  text: string
): Either.Either<{ readonly text: string; readonly bytes: Uint8Array }, ComparisonError> => {
  const decoded = read("DeclaredAddress", text, ["addr", "addr_test"])
  if (Either.isLeft(decoded)) return Either.left(decoded.left)
  const { bytes, prefix } = decoded.right
  return Either.right({ text: encodeBech32(prefix, bytes), bytes })
}

/** A declared pool id, as the token a body certificate's pool hash encodes to. */
export const readPool = (text: string): Either.Either<string, ComparisonError> => {
  const decoded = read("DeclaredPool", text, ["pool"])
  if (Either.isLeft(decoded)) return Either.left(decoded.left)
  if (decoded.right.bytes.length !== 28) {
    return Either.left(cannotCompare("DeclaredPool", `a pool id is 28 bytes, read ${decoded.right.bytes.length}`))
  }
  return Either.right(encodeBech32("pool", decoded.right.bytes))
}

/**
 * A declared DRep, as the token the body's own DRep field reduces to. Two
 * spellings are in use: CIP-129 writes a header byte before the credential,
 * where 0x22 is a key and 0x23 a script, and CIP-105 wrote the 28-byte key hash
 * alone. Both name the same DRep, and refusing the older one would block an
 * honest delegation.
 */
export const readDRep = (text: string): Either.Either<string, ComparisonError> => {
  if (text === "abstain" || text === "noConfidence") return Either.right(text)

  const decoded = read("DeclaredDRep", text, ["drep"])
  if (Either.isLeft(decoded)) return Either.left(decoded.left)
  const { bytes } = decoded.right
  if (bytes.length === 28) return Either.right(`key.${toHex(bytes)}`)
  if (bytes.length === 29 && (bytes[0] === 0x22 || bytes[0] === 0x23)) {
    return Either.right(`${bytes[0] === 0x22 ? "key" : "script"}.${toHex(bytes.subarray(1))}`)
  }
  return Either.left(cannotCompare("DeclaredDRep", `${bytes.length} bytes is neither a CIP-129 nor a CIP-105 DRep id`))
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/**
 * Days from 1970-01-01 to a proleptic Gregorian date, by Howard Hinnant's
 * civil-calendar algorithm. Written out rather than reached for through `Date`
 * so that nothing in this package can consult a clock: `test/no-io.test.ts`
 * fails on the word.
 */
const daysFromCivil = (year: number, month: number, day: number): number => {
  const shifted = month <= 2 ? year - 1 : year
  const era = Math.floor(shifted / 400)
  const yearOfEra = shifted - era * 400
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

/** `validUntil` as Unix milliseconds. UTC to the second, the one spelling the protocol admits. */
export const readInstant = (text: string): Either.Either<bigint, ComparisonError> => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(text)
  if (parts === null) return Either.left(cannotCompare("DeclaredInstant", `${text} is not an instant in UTC`))

  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number)
  const unreal = cannotCompare("DeclaredInstant", `${text} names no real instant`)
  if (month < 1 || month > 12) return Either.left(unreal)
  const days = month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1]
  if (day < 1 || day > days || hour > 23 || minute > 59 || second > 59) return Either.left(unreal)

  return Either.right(BigInt(((daysFromCivil(year, month, day) * 24 + hour) * 60 + minute) * 60 + second) * 1000n)
}
