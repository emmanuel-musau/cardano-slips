/**
 * The shapes the chain did not hand us.
 *
 * Roughly seventeen hundred mainnet transactions were read while collecting
 * `test/fixtures/`, and some of the Conway CDDL never appeared in them:
 * committee certificates, the four combined registration-and-delegation
 * certificates, reference scripts in an output, a treasury donation. Those
 * readers would otherwise ship unexercised, so they are built here from the
 * CDDL instead. These are shape tests, not transactions — no commit is checked,
 * because there is no chain to check it against. Real bytes for them belong on
 * the honest-fixtures ticket.
 */
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { TransactionBody } from "../src/decode.js"
import { decodeTransaction } from "../src/decode.js"
import { fromHex, toHex } from "./support/bytes.js"
import * as write from "./support/cbor.js"

const bodyOf = (bodyHex: string): TransactionBody => {
  const result = decodeTransaction(fromHex(write.transaction(bodyHex)))
  if (Either.isLeft(result)) throw new Error(`refused: ${result.left.message}`)
  return result.right.body
}

const credential = (hash: string) => write.array(write.uint(0), write.bytes(hash))
const keyHash = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"
const otherHash = "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c"
const anchor = write.array(write.text("https://example.test/rationale"), write.filler(32, 0x5a))

const certificate = (hex: string): TransactionBody => bodyOf(write.body([write.uint(4), write.set(hex)]))

describe("certificates the chain window did not hold", () => {
  it("reads a combined stake and vote delegation", () => {
    const { certificates } = certificate(
      write.array(
        write.uint(10),
        credential(keyHash),
        write.bytes(otherHash),
        write.array(write.uint(0), write.bytes(otherHash))
      )
    )
    expect(certificates[0]).toMatchObject({ _tag: "StakeVoteDelegation" })
    expect(certificates[0]).toHaveProperty("drep._tag", "KeyHash")
  })

  it("reads a registration that delegates to a pool in the same certificate", () => {
    const { certificates } = certificate(
      write.array(write.uint(11), credential(keyHash), write.bytes(otherHash), write.uint(2_000_000))
    )
    expect(certificates[0]).toMatchObject({ _tag: "StakeRegistrationDelegation", deposit: 2_000_000n })
  })

  it("reads a registration that delegates its vote in the same certificate", () => {
    const { certificates } = certificate(
      write.array(write.uint(12), credential(keyHash), write.array(write.uint(2)), write.uint(2_000_000))
    )
    expect(certificates[0]).toMatchObject({ _tag: "VoteRegistrationDelegation", deposit: 2_000_000n })
    expect(certificates[0]).toHaveProperty("drep._tag", "Abstain")
  })

  it("reads a registration that does both at once", () => {
    const { certificates } = certificate(
      write.array(
        write.uint(13),
        credential(keyHash),
        write.bytes(otherHash),
        write.array(write.uint(3)),
        write.uint(2_000_000)
      )
    )
    expect(certificates[0]).toMatchObject({ _tag: "StakeVoteRegistrationDelegation" })
    expect(certificates[0]).toHaveProperty("drep._tag", "NoConfidence")
  })

  it("reads a committee hot key authorisation", () => {
    const { certificates } = certificate(
      write.array(write.uint(14), credential(keyHash), write.array(write.uint(1), write.bytes(otherHash)))
    )
    expect(certificates[0]).toMatchObject({ _tag: "AuthorizeCommitteeHot" })
    expect(certificates[0]).toHaveProperty("hot._tag", "ScriptHash")
  })

  it("reads a committee cold resignation, with and without a reason", () => {
    const withReason = certificate(write.array(write.uint(15), credential(keyHash), anchor))
    expect(withReason.certificates[0]).toHaveProperty("anchor.url", "https://example.test/rationale")

    const without = certificate(write.array(write.uint(15), credential(keyHash), write.NULL))
    expect(without.certificates[0]).toMatchObject({ _tag: "ResignCommitteeCold", anchor: null })
  })

  it("reads a pool registration, margin and relays and all", () => {
    const { certificates } = certificate(
      write.array(
        write.uint(3),
        write.bytes(keyHash),
        write.filler(32, 0x77),
        write.uint(100_000_000_000),
        write.uint(340_000_000),
        write.tagged(30, write.array(write.uint(3), write.uint(100))),
        write.filler(29, 0xe1),
        write.set(write.bytes(otherHash)),
        write.array(
          write.array(write.uint(0), write.uint(3001), write.bytes("c0a80101"), write.NULL),
          write.array(write.uint(1), write.NULL, write.text("relay.example.test")),
          write.array(write.uint(2), write.text("_relays.example.test"))
        ),
        write.array(write.text("https://example.test/pool.json"), write.filler(32, 0x5a))
      )
    )
    const registration = certificates[0]
    expect(registration._tag).toBe("PoolRegistration")
    if (registration._tag !== "PoolRegistration") return
    expect(registration.params.margin).toEqual({ numerator: 3n, denominator: 100n })
    expect(registration.params.pledge).toBe(100_000_000_000n)
    expect(registration.params.relays.map((relay) => relay._tag)).toEqual([
      "SingleHostAddress",
      "SingleHostName",
      "MultiHostName"
    ])
    expect(registration.params.metadata?.url).toBe("https://example.test/pool.json")
  })

  it("reads a pool registration with no metadata", () => {
    const { certificates } = certificate(
      write.array(
        write.uint(3),
        write.bytes(keyHash),
        write.filler(32, 0x77),
        write.uint(0),
        write.uint(340_000_000),
        write.tagged(30, write.array(write.uint(0), write.uint(1))),
        write.filler(29, 0xe1),
        write.set(),
        write.array(),
        write.NULL
      )
    )
    expect(certificates[0]).toHaveProperty("params.metadata", null)
  })
})

describe("output shapes the chain window did not hold", () => {
  it("reads a reference script", () => {
    const { outputs } = bodyOf(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [
          write.uint(1),
          write.array(
            write.map(
              [write.uint(0), write.filler(29, 0x60)],
              [write.uint(1), write.uint(1_000_000)],
              [write.uint(3), write.tagged(24, write.bytes("820158209f"))]
            )
          )
        ],
        [write.uint(2), write.uint(170_000)]
      )
    )
    expect(outputs[0].form).toBe("post-alonzo")
    expect(outputs[0].scriptRef).not.toBeNull()
    expect(toHex(outputs[0].scriptRef as Uint8Array)).toBe("820158209f")
  })

  it("reads a datum hash on a post-alonzo output", () => {
    const { outputs } = bodyOf(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [
          write.uint(1),
          write.array(
            write.map(
              [write.uint(0), write.filler(29, 0x60)],
              [write.uint(1), write.uint(1_000_000)],
              [write.uint(2), write.array(write.uint(0), write.filler(32, 0x3d))]
            )
          )
        ],
        [write.uint(2), write.uint(170_000)]
      )
    )
    expect(outputs[0].datum).toMatchObject({ _tag: "DatumHash" })
  })
})

describe("body keys the chain window did not hold", () => {
  it("reads a treasury donation and the treasury value it was measured against", () => {
    const body = bodyOf(
      write.body([write.uint(21), write.uint(1_500_000_000_000)], [write.uint(22), write.uint(5_000_000)])
    )
    expect(body.currentTreasuryValue).toBe(1_500_000_000_000n)
    expect(body.donation).toBe(5_000_000n)
  })

  it("refuses a donation of nothing", () => {
    const result = decodeTransaction(fromHex(write.transaction(write.body([write.uint(22), write.uint(0)]))))
    expect(Either.isLeft(result)).toBe(true)
  })
})

describe("governance actions the chain window did not hold", () => {
  const proposal = (action: string) =>
    bodyOf(
      write.body([
        write.uint(20),
        write.set(write.array(write.uint(100_000_000_000), write.filler(29, 0xe1), action, anchor))
      ])
    ).proposalProcedures[0]

  it("reads a hard fork initiation", () => {
    const read = proposal(write.array(write.uint(1), write.NULL, write.array(write.uint(11), write.uint(0))))
    expect(read.action.kind).toBe("hard-fork-initiation")
    expect(read.deposit).toBe(100_000_000_000n)
  })

  it("reads a motion of no confidence", () => {
    expect(proposal(write.array(write.uint(3), write.NULL)).action.kind).toBe("no-confidence")
  })

  it("reads a new constitution", () => {
    const read = proposal(
      write.array(
        write.uint(5),
        write.array(write.filler(32, 0x11), write.uint(0)),
        write.array(anchor, write.filler(28, 0x9c))
      )
    )
    expect(read.action.kind).toBe("new-constitution")
    // Nothing is dropped: the action's arguments come back as read.
    expect(read.action.arguments).toHaveLength(2)
  })
})

describe("encodings the ledger still writes", () => {
  it("accepts a set written as a bare array, which is the pre-Conway spelling", () => {
    const body = bodyOf(
      write.map(
        [write.uint(0), write.array(write.array(write.filler(32, 0x11), write.uint(0)))],
        [write.uint(1), write.array(write.array(write.filler(29, 0x60), write.uint(1_000_000)))],
        [write.uint(2), write.uint(170_000)]
      )
    )
    expect(body.inputs).toHaveLength(1)
  })

  it("accepts indefinite-length arrays and maps", () => {
    // `9f … ff` and `bf … ff`. The commit is taken over the bytes as given, so
    // an encoding we would not have chosen still hashes to the right id.
    const input = write.array(write.filler(32, 0x11), write.uint(0))
    const output = write.array(write.filler(29, 0x60), write.uint(1_000_000))
    const indefinite = `bf00d90102${`9f${input}ff`}01${`9f${output}ff`}021a000298a0ff`
    const body = bodyOf(indefinite)
    expect(body.inputs).toHaveLength(1)
    expect(body.outputs).toHaveLength(1)
    expect(body.fee).toBe(170_144n)
  })

  it("accepts an indefinite-length byte string", () => {
    const chunked = `5f${write.bytes("0102030405060708090a0b0c0d0e0f10")}${write.bytes("1112131415161718191a1b1c")}ff`
    const body = bodyOf(
      write.map(
        [write.uint(0), write.set(write.array(write.filler(32, 0x11), write.uint(0)))],
        [write.uint(1), write.array(write.array(write.filler(29, 0x60), write.uint(1_000_000)))],
        [write.uint(2), write.uint(170_000)],
        [write.uint(14), write.set(chunked)]
      )
    )
    expect(toHex(body.requiredSigners[0])).toBe(keyHash)
  })
})
