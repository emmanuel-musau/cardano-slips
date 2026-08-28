/**
 * A CBOR writer for tests only, and deliberately not in `src`: ADR-0010 keeps
 * an encoder out of the package, because a commit taken over a re-encode is the
 * bug the byte range exists to prevent.
 *
 * It is here to build the shapes mainnet did not hand us — a committee
 * certificate, a reference script, a hard-fork proposal — so those readers are
 * exercised rather than assumed.
 */
import { toHex } from "./bytes.js"

type Written = string

const head = (major: number, argument: number | bigint): string => {
  const value = BigInt(argument)
  const prefix = major << 5
  if (value < 24n) return (prefix + Number(value)).toString(16).padStart(2, "0")
  const width = value < 0x100n ? 1 : value < 0x10000n ? 2 : value < 0x100000000n ? 4 : 8
  const information = width === 1 ? 24 : width === 2 ? 25 : width === 4 ? 26 : 27
  return (prefix + information).toString(16).padStart(2, "0") + value.toString(16).padStart(width * 2, "0")
}

export const uint = (value: number | bigint): Written => head(0, value)

export const nint = (value: number | bigint): Written => head(1, -1n - BigInt(value))

export const int = (value: number | bigint): Written => (BigInt(value) < 0n ? nint(value) : uint(value))

export const bytes = (hex: string): Written => head(2, hex.length / 2) + hex

/** `count` bytes of a recognisable filler, for a hash whose value never matters. */
export const filler = (count: number, seed = 0xab): Written => bytes(seed.toString(16).padStart(2, "0").repeat(count))

export const text = (value: string): Written => {
  const encoded = toHex(new TextEncoder().encode(value))
  return head(3, encoded.length / 2) + encoded
}

export const array = (...items: ReadonlyArray<Written>): Written => head(4, items.length) + items.join("")

export const map = (...entries: ReadonlyArray<readonly [Written, Written]>): Written =>
  head(5, entries.length) + entries.map(([key, value]) => key + value).join("")

export const tagged = (tag: number | bigint, value: Written): Written => head(6, tag) + value

export const set = (...items: ReadonlyArray<Written>): Written => tagged(258, array(...items))

export const TRUE = "f5"
export const FALSE = "f4"
export const NULL = "f6"
export const UNDEFINED = "f7"
/** A half-precision zero: the shortest float CBOR can write. */
export const FLOAT = "f90000"

/** A body with just the three required keys, so a test can add the one key it is about. */
export const body = (...extra: ReadonlyArray<readonly [Written, Written]>): Written =>
  map(
    [uint(0), set(array(filler(32, 0x11), uint(0)))],
    [uint(1), array(array(filler(29, 0x60), uint(1_000_000)))],
    [uint(2), uint(170_000)],
    ...extra
  )

/** `[body, witness set, is-valid, auxiliary data]` — the Conway envelope. */
export const transaction = (bodyHex: Written): Written => array(bodyHex, map(), TRUE, NULL)
