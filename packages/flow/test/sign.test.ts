import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePartialIntent, type Intent } from "@cardano-slips/core"
import { Either, Effect } from "effect"
import { beforeAll, describe, expect, it } from "vitest"

import { balanceIntent } from "../src/balance.js"
import type { Cip30Api } from "../src/cip30.js"
import { type SignedTransaction, signTransaction, submitTransaction } from "../src/sign.js"
import { type SignRefusal, signRefusals, type SigningError, slipErrorCodeFor } from "../src/sign-error.js"
import { assembleWitnesses, transactionIdOf } from "../src/witness.js"
import { mainnetAddress, stubApi } from "./stub-wallet.js"
import { mainnetParameters, walletUtxo } from "./wallet-utxos.js"
import { emptyWitnessSet, vkeysIn, witnessSet, witnessSetWithScript } from "./witnesses.js"

/**
 * The transaction under test is built by the balancer rather than pasted in:
 * assembly has to survive the bytes we actually produce, and a hand-written
 * fixture would stop tracking them the moment the builder changes.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "partial", "valid")

const specIntent = (file: string): Intent => {
  const decoded = decodePartialIntent(JSON.parse(readFileSync(join(examples, file), "utf8")))
  if (Either.isLeft(decoded)) throw new Error(`${file} is not a partial intent`)
  return decoded.right.intent
}

/** One minute before the spec examples expire, so their own `validUntil` is the live one. */
const beforeExpiry = Date.parse("2026-08-22T19:39:00Z")

let unsigned: string
let unsignedId: string

beforeAll(async () => {
  const built = await Effect.runPromise(
    balanceIntent({
      intent: specIntent("payment.json"),
      network: "mainnet",
      changeAddress: mainnetAddress.bech32,
      utxos: [walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 100_000_000n })],
      parameters: mainnetParameters,
      now: beforeExpiry
    })
  )
  unsigned = built.cbor
  unsignedId = run(transactionIdOf(unsigned))
})

const run = <A>(effect: Effect.Effect<A, SigningError>): A => Effect.runSync(effect)

/** Every refusal this suite has reached, so the closed set can be checked at the end. */
const reached = new Set<SignRefusal>()

const failure = async <A>(effect: Effect.Effect<A, SigningError>, refusal: SignRefusal): Promise<SigningError> => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (Either.isRight(result)) throw new Error("this was expected to fail and did not")
  expect(result.left.refusal).toBe(refusal)
  reached.add(result.left.refusal)
  return result.left
}

/** A wallet that returns the given witness set, and records what it was asked. */
const signingWallet = (
  returns: string | (() => Promise<string>),
  asked: { tx?: string; partial?: boolean } = {}
): Cip30Api =>
  stubApi({
    signTx: async (tx, partialSign) => {
      asked.tx = tx
      asked.partial = partialSign
      return typeof returns === "string" ? returns : await returns()
    }
  })

const sign = (api: Cip30Api, transactionId = unsignedId): Effect.Effect<SignedTransaction, SigningError> =>
  signTransaction({ api, transaction: unsigned, transactionId })

/** A wallet rejection: a plain object with a numeric code, never an `Error`. */
const rejects = (error: unknown) => async (): Promise<never> => {
  throw error
}

describe("what the wallet is asked to sign", () => {
  it("asks for a partial signature, and hands over the transaction unchanged", async () => {
    const asked: { tx?: string; partial?: boolean } = {}
    await Effect.runPromise(sign(signingWallet(witnessSet("1"), asked)))

    // `partialSign: false` lets a wallet refuse anything it cannot fully sign.
    expect(asked.partial).toBe(true)
    expect(asked.tx).toBe(unsigned)
  })

  it("refuses to sign a body that is not the one the effects were derived from", async () => {
    const wallet = signingWallet(witnessSet("1"))
    const error = await failure(sign(wallet, "0".repeat(64)), "WrongBody")

    expect(error.message).toContain("not the transaction")
  })

  it("refuses a transaction whose bytes cannot be read", async () => {
    await failure(
      signTransaction({ api: signingWallet(witnessSet("1")), transaction: "not cbor", transactionId: unsignedId }),
      "UnreadableTransaction"
    )
  })
})

describe("the witness set a wallet returns", () => {
  it("is assembled into the body, which keeps its transaction id", async () => {
    const signed = await Effect.runPromise(sign(signingWallet(witnessSet("1"))))

    // The id is what the person was shown and what the chain will call this
    // transaction; assembly that changed it would make those two different things.
    expect(signed.transactionId).toBe(unsignedId)
    expect(run(transactionIdOf(signed.cbor))).toBe(unsignedId)
    expect(vkeysIn(signed.cbor)).toEqual(["1".repeat(64)])
  })

  it("is appended to witnesses already present, never replacing them", async () => {
    // A co-signer's witness is already in the set. Replace semantics would drop
    // it silently and the transaction would reach the chain unsignable.
    const withFirst = run(assembleWitnesses(unsigned, witnessSet("1"), unsignedId))
    const withBoth = run(assembleWitnesses(withFirst, witnessSet("2"), unsignedId))

    expect(vkeysIn(withBoth)).toEqual(["1".repeat(64), "2".repeat(64)])
  })

  it("is refused when it carries script material the body was never judged with", async () => {
    const error = await failure(sign(signingWallet(witnessSetWithScript("1"))), "UnexpectedWitnessMaterial")

    expect(error.message).toContain("native scripts")
  })

  it("is refused when it carries no signature at all", async () => {
    // evolution-sdk returns the transaction untouched for an empty set, so an
    // unsigned transaction would otherwise go to `submitTx` looking signed.
    await failure(sign(signingWallet(emptyWitnessSet())), "NoWitnesses")
  })

  it("is refused when it is not a witness set", async () => {
    await failure(sign(signingWallet("nonsense")), "UnreadableWitnesses")
  })

  it("is refused when it is not a string at all", async () => {
    // The same footgun as `submitTx` answering with something that is not an
    // id, on the side where the answer reaches CBOR decoding.
    const api = stubApi({ signTx: async () => undefined as unknown as string })

    await failure(signTransaction({ api, transaction: unsigned, transactionId: unsignedId }), "UnreadableWitnesses")
  })

  it("is refused when the wallet returns a whole transaction instead", async () => {
    // Invariant 4: `signTx` returns a witness set. A wallet that returns a
    // signed transaction is not one we assemble from, whatever it hands back.
    await failure(sign(signingWallet(unsigned)), "UnreadableWitnesses")
  })
})

describe("a person declining", () => {
  it("is read from CIP-30's TxSignError, which numbers UserDeclined 2", async () => {
    const error = await failure(sign(signingWallet(rejects({ code: 2, info: "user declined" }))), "Declined")

    // Not a fault: the code stays undefined so nothing renders this as one.
    expect(error.code).toBeUndefined()
    expect(error.message).not.toContain("failed")
  })

  it("is also read from an APIError -3, which wallets send here in practice", async () => {
    await failure(sign(signingWallet(rejects({ code: -3, info: "refused" }))), "Declined")
  })

  it("is told apart from a wallet that could not produce the signature", async () => {
    // TxSignError 1 is ProofGeneration: the wallet tried and could not.
    const error = await failure(sign(signingWallet(rejects({ code: 1, info: "no key" }))), "SignFailed")

    expect(error.message).toContain("no key")
  })
})

describe("submission", () => {
  const signedOnce = async (): Promise<SignedTransaction> => Effect.runPromise(sign(signingWallet(witnessSet("1"))))

  it("sends the assembled transaction and returns the id the chain will know it by", async () => {
    const signed = await signedOnce()
    let sent: string | undefined
    const api = stubApi({
      submitTx: async (tx) => {
        sent = tx
        return unsignedId
      }
    })

    expect(await Effect.runPromise(submitTransaction(api, signed))).toBe(unsignedId)
    expect(sent).toBe(signed.cbor)
  })

  it("refuses an id that is not the transaction we assembled", async () => {
    const signed = await signedOnce()
    const api = stubApi({ submitTx: async () => "f".repeat(64) })

    const error = await failure(submitTransaction(api, signed), "WrongTransactionId")
    expect(error.message).toContain("a different transaction")
  })

  it("refuses an answer that is not an id at all", async () => {
    const signed = await signedOnce()
    // Typed as a string and under no obligation to be one: reading a method off
    // it is how a wallet's answer becomes a stack trace in front of a person.
    const api = stubApi({ submitTx: async () => ({ hash: "submitted" }) as unknown as string })

    const error = await failure(submitTransaction(api, signed), "WrongTransactionId")
    expect(error.message).toContain("did not name")
  })

  it("names spent inputs as their own refusal, which is what the rebuild path watches for", async () => {
    const signed = await signedOnce()
    const api = stubApi({ submitTx: rejects({ code: 2, info: "ValueNotConserved BadInputsUTxO" }) })

    const error = await failure(submitTransaction(api, signed), "InputsSpent")
    expect(error.message).toContain("moved")
  })

  it("names a passed validity interval, which no retry can help", async () => {
    const signed = await signedOnce()
    const api = stubApi({ submitTx: rejects({ code: 2, info: "OutsideValidityIntervalUTxO" }) })

    const error = await failure(submitTransaction(api, signed), "IntervalPassed")
    expect(error.code).toBe("INTENT_EXPIRED")
  })

  it("maps anything else to a message that says what the wallet said", async () => {
    const signed = await signedOnce()
    const api = stubApi({ submitTx: rejects({ code: 2, info: "the node is unreachable" }) })

    const error = await failure(submitTransaction(api, signed), "SubmitFailed")
    expect(error.message).toContain("the node is unreachable")
  })
})

describe("the refusals", () => {
  it("are every one this suite reached", () => {
    // A refusal nothing can reach is a state nobody sees, and the client
    // renders one screen per refusal.
    expect([...reached].sort()).toEqual(Object.keys(signRefusals).sort())
  })

  it("carry a spec error code only where the exchange itself failed", () => {
    // A declined signature and an unreachable node are states of a wallet, not
    // failures of the exchange the spec describes; dressing them in a protocol
    // code would say the endpoint answered when nothing was ever asked of it.
    const coded = Object.keys(signRefusals).filter((refusal) => slipErrorCodeFor(refusal as SignRefusal) !== undefined)

    expect(coded).toEqual(["IntervalPassed"])
  })
})
