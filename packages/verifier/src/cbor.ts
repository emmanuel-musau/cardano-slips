/**
 * A CBOR reader that remembers where every value came from. It hands back byte
 * ranges because the commit is taken over original bytes, and raises on
 * anything unmodelled where a library would carry on — ADR-0010.
 */
import { refuse, TransactionDecodeError } from "./decode-error.js"

export type Span = { readonly start: number; readonly end: number }

export type CborEntry = { readonly key: CborValue; readonly value: CborValue }

export type CborValue =
  | { readonly _tag: "Integer"; readonly value: bigint; readonly span: Span }
  | { readonly _tag: "Bytes"; readonly value: Uint8Array; readonly span: Span }
  | { readonly _tag: "Text"; readonly value: string; readonly span: Span }
  | { readonly _tag: "Array"; readonly items: ReadonlyArray<CborValue>; readonly span: Span }
  | { readonly _tag: "Map"; readonly entries: ReadonlyArray<CborEntry>; readonly span: Span }
  | { readonly _tag: "Tagged"; readonly tag: bigint; readonly value: CborValue; readonly span: Span }
  | { readonly _tag: "Bool"; readonly value: boolean; readonly span: Span }
  | { readonly _tag: "Null"; readonly span: Span }

export type ReadOptions = {
  /**
   * Tags accepted anywhere in this subtree. `"any"` is for the parts of a
   * transaction we derive nothing from — refusing an unknown tag in a witness
   * set would reject a valid transaction to no purpose.
   */
  readonly tags: ReadonlySet<bigint> | "any"
  /** Whether major type 7 may carry more than true, false and null. */
  readonly simpleValues: "modelled" | "any"
}

export const permissive: ReadOptions = { tags: "any", simpleValues: "any" }

const MAJOR_UNSIGNED = 0
const MAJOR_NEGATIVE = 1
const MAJOR_BYTES = 2
const MAJOR_TEXT = 3
const MAJOR_ARRAY = 4
const MAJOR_MAP = 5
const MAJOR_TAG = 6
const MAJOR_SIMPLE = 7

const SIMPLE_FALSE = 20
const SIMPLE_TRUE = 21
const SIMPLE_NULL = 22
const SIMPLE_UNDEFINED = 23

const INDEFINITE = 31
const BREAK = 0xff

const utf8 = new TextDecoder("utf-8", { fatal: true })

type Cursor = { readonly bytes: Uint8Array; at: number; readonly options: ReadOptions }

const need = (cursor: Cursor, count: number, what: string): void => {
  if (cursor.at + count > cursor.bytes.length) {
    throw refuse("Truncated", cursor.at, `${what} needs ${count} more byte(s), ${cursor.bytes.length - cursor.at} left`)
  }
}

const readByte = (cursor: Cursor, what: string): number => {
  need(cursor, 1, what)
  return cursor.bytes[cursor.at++]
}

/** The additional-information argument, or `"indefinite"` for additional information 31. */
const readArgument = (cursor: Cursor, information: number): bigint | "indefinite" => {
  if (information < 24) return BigInt(information)
  const width = information === 24 ? 1 : information === 25 ? 2 : information === 26 ? 4 : information === 27 ? 8 : 0
  if (width === 0) {
    if (information === INDEFINITE) return "indefinite"
    throw refuse("MalformedHead", cursor.at - 1, `additional information ${information} is not defined`)
  }
  need(cursor, width, "an integer argument")
  let value = 0n
  for (let index = 0; index < width; index++) value = (value << 8n) | BigInt(cursor.bytes[cursor.at + index])
  cursor.at += width
  return value
}

/** A length the reader can act on. Anything past the end of the buffer is truncation, whatever it claims. */
const asLength = (cursor: Cursor, argument: bigint, what: string): number => {
  if (argument > BigInt(cursor.bytes.length)) {
    throw refuse("Truncated", cursor.at, `${what} claims a length of ${argument}, past the end of the transaction`)
  }
  return Number(argument)
}

const readChunks = (cursor: Cursor, major: number, what: string): Uint8Array => {
  const chunks: Array<Uint8Array> = []
  let total = 0
  for (;;) {
    need(cursor, 1, what)
    if (cursor.bytes[cursor.at] === BREAK) {
      cursor.at++
      break
    }
    const start = cursor.at
    const head = readByte(cursor, what)
    if (head >> 5 !== major) {
      throw refuse("MalformedField", start, `an indefinite-length ${what} may only hold chunks of its own type`)
    }
    const argument = readArgument(cursor, head & 0x1f)
    if (argument === "indefinite") {
      throw refuse("MalformedField", start, `an indefinite-length ${what} may not nest`)
    }
    const length = asLength(cursor, argument, what)
    need(cursor, length, what)
    chunks.push(cursor.bytes.subarray(cursor.at, cursor.at + length))
    cursor.at += length
    total += length
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

const readSimple = (cursor: Cursor, information: number, start: number): CborValue => {
  const span = { start, end: cursor.at }
  if (information === SIMPLE_FALSE) return { _tag: "Bool", value: false, span }
  if (information === SIMPLE_TRUE) return { _tag: "Bool", value: true, span }
  if (information === SIMPLE_NULL) return { _tag: "Null", span }
  if (cursor.options.simpleValues === "any") {
    // Skip the payload rather than model it: nothing outside the body is derived from.
    const width = information === 25 ? 2 : information === 26 ? 4 : information === 27 ? 8 : information === 24 ? 1 : 0
    need(cursor, width, "a simple value")
    cursor.at += width
    return { _tag: "Null", span: { start, end: cursor.at } }
  }
  if (information === 25 || information === 26 || information === 27) {
    throw refuse("Float", start, "ledger values are exact, so a float is never one of them")
  }
  const named = information === SIMPLE_UNDEFINED ? "undefined" : `simple value ${information}`
  throw refuse("UnmodelledSimpleValue", start, `${named} has no meaning in a transaction body`)
}

const readValue = (cursor: Cursor): CborValue => {
  const start = cursor.at
  const head = readByte(cursor, "a value")
  const major = head >> 5
  const information = head & 0x1f

  if (major === MAJOR_SIMPLE) return readSimple(cursor, information, start)

  const argument = readArgument(cursor, information)

  if (argument === "indefinite") {
    switch (major) {
      case MAJOR_BYTES:
        return { _tag: "Bytes", value: readChunks(cursor, MAJOR_BYTES, "byte string"), span: { start, end: cursor.at } }
      case MAJOR_TEXT: {
        const raw = readChunks(cursor, MAJOR_TEXT, "text string")
        return { _tag: "Text", value: decodeText(raw, start), span: { start, end: cursor.at } }
      }
      case MAJOR_ARRAY: {
        const items: Array<CborValue> = []
        for (;;) {
          need(cursor, 1, "an array item")
          if (cursor.bytes[cursor.at] === BREAK) {
            cursor.at++
            break
          }
          items.push(readValue(cursor))
        }
        return { _tag: "Array", items, span: { start, end: cursor.at } }
      }
      case MAJOR_MAP: {
        const entries: Array<CborEntry> = []
        for (;;) {
          need(cursor, 1, "a map entry")
          if (cursor.bytes[cursor.at] === BREAK) {
            cursor.at++
            break
          }
          const key = readValue(cursor)
          entries.push({ key, value: readValue(cursor) })
        }
        return { _tag: "Map", entries, span: { start, end: cursor.at } }
      }
      default:
        throw refuse("MalformedHead", start, `major type ${major} has no indefinite-length form`)
    }
  }

  switch (major) {
    case MAJOR_UNSIGNED:
      return { _tag: "Integer", value: argument, span: { start, end: cursor.at } }
    case MAJOR_NEGATIVE:
      return { _tag: "Integer", value: -1n - argument, span: { start, end: cursor.at } }
    case MAJOR_BYTES: {
      const length = asLength(cursor, argument, "byte string")
      need(cursor, length, "byte string")
      const value = cursor.bytes.slice(cursor.at, cursor.at + length)
      cursor.at += length
      return { _tag: "Bytes", value, span: { start, end: cursor.at } }
    }
    case MAJOR_TEXT: {
      const length = asLength(cursor, argument, "text string")
      need(cursor, length, "text string")
      const raw = cursor.bytes.subarray(cursor.at, cursor.at + length)
      cursor.at += length
      return { _tag: "Text", value: decodeText(raw, start), span: { start, end: cursor.at } }
    }
    case MAJOR_ARRAY: {
      const count = asLength(cursor, argument, "array")
      const items: Array<CborValue> = []
      for (let index = 0; index < count; index++) items.push(readValue(cursor))
      return { _tag: "Array", items, span: { start, end: cursor.at } }
    }
    case MAJOR_MAP: {
      const count = asLength(cursor, argument, "map")
      const entries: Array<CborEntry> = []
      for (let index = 0; index < count; index++) {
        const key = readValue(cursor)
        entries.push({ key, value: readValue(cursor) })
      }
      return { _tag: "Map", entries, span: { start, end: cursor.at } }
    }
    case MAJOR_TAG: {
      if (cursor.options.tags !== "any" && !cursor.options.tags.has(argument)) {
        throw refuse("UnexpectedTag", start, `tag ${argument} appears nowhere in a transaction body`)
      }
      const value = readValue(cursor)
      return { _tag: "Tagged", tag: argument, value, span: { start, end: cursor.at } }
    }
    default:
      // Major type 7 left above, so 0 through 6 are all accounted for.
      throw refuse("MalformedHead", start, `major type ${major} is not defined`)
  }
}

const decodeText = (raw: Uint8Array, start: number): string => {
  try {
    return utf8.decode(raw)
  } catch {
    throw refuse("MalformedText", start, "text is not valid UTF-8")
  }
}

/** Reads one value starting at `at`, leaving the caller to decide what follows it. */
export const readOne = (bytes: Uint8Array, at: number, options: ReadOptions): CborValue => {
  const cursor: Cursor = { bytes, at, options }
  return readValue(cursor)
}

/** Turns the reader's thrown refusals back into the typed error the public API returns. */
export const isRefusal = (error: unknown): error is TransactionDecodeError => error instanceof TransactionDecodeError
