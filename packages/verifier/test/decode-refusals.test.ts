/**
 * One case per fail-closed rule in ADR-0010, plus the rest of the refusal
 * vocabulary.
 *
 * This is the file that keeps the engine armed. A decoder that quietly starts
 * tolerating an unknown certificate type or an unmodelled body key derives
 * effects from a transaction it only partly understood, and the mismatch block
 * downstream never fires because nothing ever contradicts anything. Every rule
 * that stops being enforced shows up here as a green test that should be red.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { DecodeRefusal } from "../src/decode-error.js"
import { decodeRefusals } from "../src/decode-error.js"
import { decodeTransaction } from "../src/decode.js"
import { fromHex, rewriteOnce, toHex } from "./support/bytes.js"
import * as write from "./support/cbor.js"
import { fixture } from "./support/fixtures.js"

/** A real Conway stake deregistration, used whenever a case wants real bytes to spoil. */
const real = (): Uint8Array => fromHex(fixture("stake-deregistration").cbor)

/** `[1, [0, <that credential>]]` — the certificate inside that transaction, and unique within it. */
const theCertificate = "82018200581c5cbcec5c03015abda124c0e403661cc9b42783da9a5d94c079eb1a6b"
/** The certificates key and the set that follows it, anchored on the same credential. */
const theCertificatesKey = `04d9010281${theCertificate}`

type Case = {
  readonly rule: string
  readonly refusal: DecodeRefusal
  readonly bytes: Uint8Array
}

const synthetic = (bodyHex: string): Uint8Array => fromHex(write.transaction(bodyHex))

const anOutput = write.map([write.uint(0), write.filler(29, 0x60)], [write.uint(1), write.uint(1_000_000)])

const cases: ReadonlyArray<Case> = [
  // "a transaction that is not a 4-item array"
  {
    rule: "a three-item transaction, which is what a pre-Alonzo era wrote",
    refusal: "NotAFourItemArray",
    bytes: fromHex(write.array(write.body(), write.map(), write.NULL))
  },
  {
    rule: "a transaction that is a map rather than an array",
    refusal: "NotAFourItemArray",
    bytes: fromHex(write.map([write.uint(0), write.body()]))
  },

  // "a body that is not a map"
  {
    rule: "a body that is an array",
    refusal: "BodyNotAMap",
    bytes: fromHex(write.array(write.array(), write.map(), write.TRUE, write.NULL))
  },

  // "trailing bytes after the transaction, or truncation"
  {
    rule: "one byte after a complete transaction",
    refusal: "TrailingBytes",
    bytes: fromHex(`${toHex(real())}00`)
  },
  {
    rule: "a real transaction with its tail cut off",
    refusal: "Truncated",
    bytes: real().slice(0, real().length - 40)
  },
  {
    rule: "a byte string claiming more bytes than the transaction holds",
    refusal: "Truncated",
    bytes: fromHex(write.array(write.map([write.uint(0), "5affffffff"]), write.map(), write.TRUE, write.NULL))
  },

  // "an integer body key that is not in the modelled set"
  {
    rule: "a body key past the ones Conway defines",
    refusal: "UnknownBodyKey",
    bytes: synthetic(write.body([write.uint(23), write.uint(1)]))
  },
  {
    rule: "a real transaction whose certificates key is moved to one Conway removed",
    refusal: "UnknownBodyKey",
    bytes: rewriteOnce(real(), theCertificatesKey, `06d9010281${theCertificate}`)
  },

  // "a duplicate body key"
  {
    rule: "the fee stated twice",
    refusal: "DuplicateBodyKey",
    bytes: synthetic(write.body([write.uint(2), write.uint(1)]))
  },

  {
    rule: "a body key that is not an integer at all",
    refusal: "BodyKeyNotAnInteger",
    bytes: fromHex(write.array(write.map([write.text("fee"), write.uint(1)]), write.map(), write.TRUE, write.NULL))
  },

  // "a certificate type not in the modelled set"
  {
    rule: "a real transaction mutated to carry a certificate type Conway removed",
    refusal: "UnknownCertificateType",
    bytes: rewriteOnce(real(), theCertificate, "82058200581c5cbcec5c03015abda124c0e403661cc9b42783da9a5d94c079eb1a6b")
  },
  {
    rule: "a certificate type from an era that has not happened yet",
    refusal: "UnknownCertificateType",
    bytes: synthetic(
      write.body([write.uint(4), write.set(write.array(write.uint(19), write.array(write.uint(0), write.filler(28))))])
    )
  },

  // "an output that is neither a legacy array nor a post-alonzo map"
  {
    rule: "an output that is a text string",
    refusal: "UnknownOutputForm",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [write.uint(1), write.array(write.text("pay me"))],
        [write.uint(2), write.uint(170_000)]
      )
    )
  },
  {
    rule: "a legacy output with a fourth item",
    refusal: "UnknownOutputForm",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [
          write.uint(1),
          write.array(write.array(write.filler(29, 0x60), write.uint(1_000_000), write.filler(32), write.filler(32)))
        ],
        [write.uint(2), write.uint(170_000)]
      )
    )
  },

  // "a post-alonzo output carrying an unknown key"
  {
    rule: "a post-alonzo output with a fifth field",
    refusal: "UnknownOutputKey",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [
          write.uint(1),
          write.array(
            write.map(
              [write.uint(0), write.filler(29, 0x60)],
              [write.uint(1), write.uint(1_000_000)],
              [write.uint(4), write.uint(1)]
            )
          )
        ],
        [write.uint(2), write.uint(170_000)]
      )
    )
  },

  // "any tag other than 258"
  {
    rule: "a fee written as a CBOR bignum, which a lenient reader would accept",
    refusal: "UnexpectedTag",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [write.uint(1), write.array(anOutput)],
        [write.uint(2), write.tagged(2, write.bytes("0186a0"))]
      )
    )
  },
  {
    rule: "the set tag off by one",
    refusal: "UnexpectedTag",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.tagged(259, write.array(write.array(write.filler(32, 0x11), write.uint(0))))],
        [write.uint(1), write.array(anOutput)],
        [write.uint(2), write.uint(170_000)]
      )
    )
  },

  // "a float or an unmodelled simple value anywhere in the body"
  {
    rule: "a fee written as a float",
    refusal: "Float",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [write.uint(1), write.array(anOutput)],
        [write.uint(2), write.FLOAT]
      )
    )
  },
  {
    rule: "undefined where a slot belongs",
    refusal: "UnmodelledSimpleValue",
    bytes: synthetic(write.body([write.uint(3), write.UNDEFINED]))
  },

  {
    rule: "a CBOR head RFC 8949 does not define",
    refusal: "MalformedHead",
    bytes: fromHex(write.array("a11c00", write.map(), write.TRUE, write.NULL))
  },
  {
    rule: "text that is not valid UTF-8",
    refusal: "MalformedText",
    bytes: fromHex(write.array("a162ffff00", write.map(), write.TRUE, write.NULL))
  },

  // A governance action index past the seven Conway defines.
  {
    rule: "a proposal for a governance action that does not exist",
    refusal: "UnknownGovernanceAction",
    bytes: synthetic(
      write.body([
        write.uint(20),
        write.set(
          write.array(
            write.uint(100_000_000_000),
            write.filler(29, 0xe1),
            write.array(write.uint(7)),
            write.array(write.text("https://example.test/why"), write.filler(32))
          )
        )
      ])
    )
  },

  {
    rule: "a negative fee",
    refusal: "MalformedField",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [write.uint(1), write.array(anOutput)],
        [write.uint(2), write.nint(-1)]
      )
    )
  },
  {
    rule: "a body with no fee at all",
    refusal: "MalformedField",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [write.uint(1), write.array(anOutput)]
      )
    )
  },
  {
    rule: "an output holding zero of a native asset",
    refusal: "MalformedField",
    bytes: synthetic(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [
          write.uint(1),
          write.array(
            write.array(
              write.filler(29, 0x60),
              write.array(
                write.uint(1_000_000),
                write.map([write.filler(28, 0x7c), write.map([write.bytes("4d494c4b"), write.uint(0)])])
              )
            )
          )
        ],
        [write.uint(2), write.uint(170_000)]
      )
    )
  },
  {
    rule: "a network id that names no network",
    refusal: "MalformedField",
    bytes: synthetic(write.body([write.uint(15), write.uint(4)]))
  }
]

describe.each(cases.map((entry) => [entry.rule, entry] as const))("refuses %s", (_rule, entry) => {
  it(`with ${entry.refusal}`, () => {
    const result = decodeTransaction(entry.bytes)
    if (Either.isRight(result)) throw new Error("the transaction was accepted")
    expect(result.left.refusal).toBe(entry.refusal)
  })

  it("says where in the bytes", () => {
    const result = decodeTransaction(entry.bytes)
    if (Either.isRight(result)) throw new Error("the transaction was accepted")
    expect(result.left.at).toBeGreaterThanOrEqual(0)
    expect(result.left.at).toBeLessThanOrEqual(entry.bytes.length)
    expect(result.left.message).toContain(entry.refusal)
  })
})

describe("the refusal vocabulary", () => {
  it("is reachable in full", () => {
    // The bar `core` sets for its error codes: a rule no test can trip is a
    // comment. Adding a refusal without a case for it fails here.
    const reached = new Set(cases.map((entry) => entry.refusal))
    expect([...Object.keys(decodeRefusals)].filter((refusal) => !reached.has(refusal as DecodeRefusal))).toEqual([])
  })
})

describe("the mutations", () => {
  it("changed the real transaction rather than silently matching nothing", () => {
    const mutated = rewriteOnce(
      real(),
      theCertificate,
      "82058200581c5cbcec5c03015abda124c0e403661cc9b42783da9a5d94c079eb1a6b"
    )
    expect(mutated.length).toBe(real().length)
    expect(toHex(mutated)).not.toBe(toHex(real()))
  })

  it("starts from a transaction that decodes", () => {
    // Otherwise the mutation tests would prove nothing: the refusal has to be
    // caused by the change, not by the transaction it was made to.
    expect(Either.isRight(decodeTransaction(real()))).toBe(true)
  })

  it("refuses to rewrite a run that is not there, or is there twice", () => {
    expect(() => rewriteOnce(real(), "abcdef0123456789abcdef", "00")).toThrow(/does not appear/)
    expect(() => rewriteOnce(real(), "00", "01")).toThrow(/more than once/)
  })
})
