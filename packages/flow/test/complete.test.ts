import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePartialIntent, type Intent } from "@cardano-slips/core"
import { decodeBech32 } from "@cardano-slips/verifier"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import type { Cip30Api } from "../src/cip30.js"
import { type CompletionRequest, completeIntent, type Receipt } from "../src/complete.js"
import { type CompletionError, completionRefusals, type CompletionRefusal } from "../src/complete-error.js"
import { transactionIdOf } from "../src/witness.js"
import { mainnetAddress, stubApi } from "./stub-wallet.js"
import { asCip30Hex, mainnetParameters, rewardAccountOf, type UtxoSpec, walletUtxo } from "./wallet-utxos.js"
import { witnessSet } from "./witnesses.js"

/**
 * The whole path a person walks: build against what the wallet holds, judge it
 * with the verifier's own engine, sign, submit — and when the funds moved
 * underneath, do all of it again rather than any part of it.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "partial", "valid")

const specIntent = (file: string): Intent => {
  const decoded = decodePartialIntent(JSON.parse(readFileSync(join(examples, file), "utf8")))
  if (Either.isLeft(decoded)) throw new Error(`${file} is not a partial intent`)
  return decoded.right.intent
}

const beforeExpiry = Date.parse("2026-08-22T19:39:00Z")

const addressBytes = (bech32: string): Uint8Array => {
  const result = decodeBech32(bech32)
  if (Either.isLeft(result)) throw new Error(`${bech32} is not bech32`)
  return result.right.bytes
}

/** What this wallet calls its own: its address and the reward account behind it. */
const walletAddresses = [addressBytes(mainnetAddress.bech32), rewardAccountOf(mainnetAddress.bech32)]

const held = (lovelace: bigint, seed: number): UtxoSpec => ({ bech32: mainnetAddress.bech32, lovelace, seed })

const asHex = (specs: ReadonlyArray<UtxoSpec>): ReadonlyArray<string> =>
  specs.map((spec) => asCip30Hex(walletUtxo(spec)))

type WalletScript = {
  /** One answer per `getUtxos` call; the last is repeated once the script runs out. */
  readonly utxos: ReadonlyArray<ReadonlyArray<string>>
  /** One answer per `submitTx` call, in the same way. `true` accepts it. */
  readonly submits?: ReadonlyArray<true | unknown>
}

type WalletLog = { readonly signed: Array<string>; readonly submitted: Array<string> }

/** A wallet whose answers change between attempts, which is the whole case under test. */
const scriptedWallet = (script: WalletScript): { api: Cip30Api; log: WalletLog } => {
  const log: WalletLog = { signed: [], submitted: [] }
  let utxoCalls = 0
  let submitCalls = 0

  const api = stubApi({
    getUtxos: async () => {
      const answer = script.utxos[Math.min(utxoCalls, script.utxos.length - 1)] ?? []
      utxoCalls += 1
      return answer
    },
    signTx: async (tx) => {
      log.signed.push(tx)
      return witnessSet("1")
    },
    submitTx: async (tx) => {
      const answer = script.submits?.[Math.min(submitCalls, script.submits.length - 1)] ?? true
      submitCalls += 1
      log.submitted.push(tx)
      if (answer !== true) throw answer
      // The wallet names what it submitted, which is what `submitTransaction` holds it to.
      return Effect.runSync(transactionIdOf(tx))
    }
  })

  return { api, log }
}

const request = (api: Cip30Api, overrides: Partial<CompletionRequest> = {}): CompletionRequest => ({
  api,
  intent: specIntent("payment.json"),
  network: "mainnet",
  changeAddress: mainnetAddress.bech32,
  userAddresses: walletAddresses,
  parameters: mainnetParameters,
  now: () => beforeExpiry,
  ...overrides
})

const complete = (api: Cip30Api, overrides: Partial<CompletionRequest> = {}): Promise<Receipt> =>
  Effect.runPromise(completeIntent(request(api, overrides)))

/** Every refusal this suite has reached, so the closed set can be checked at the end. */
const reached = new Set<CompletionRefusal>()

const failure = async (
  api: Cip30Api,
  overrides: Partial<CompletionRequest>,
  refusal: CompletionRefusal
): Promise<CompletionError> => {
  const result = await Effect.runPromise(Effect.either(completeIntent(request(api, overrides))))
  if (Either.isRight(result)) throw new Error("this was expected to fail and did not")
  const error = result.left as CompletionError
  expect(error.refusal).toBe(refusal)
  reached.add(error.refusal)
  return error
}

/** The ledger's own words for an input that is no longer there. */
const inputsGone = { code: 2, info: "ValueNotConservedUTxO BadInputsUTxO" }

describe("a Slip that completes", () => {
  it("builds, judges, signs and submits, and answers with the transaction id", async () => {
    const { api, log } = scriptedWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const receipt = await complete(api)

    expect(receipt.attempts).toBe(1)
    expect(log.signed).toHaveLength(1)
    expect(receipt.transactionId).toBe(Effect.runSync(transactionIdOf(log.submitted[0] ?? "")))
    // What the person was shown is what reached the chain.
    expect(receipt.effects.fee).toBeGreaterThan(0n)
  })

  it("completes a token payment, where the value carries assets as well as lovelace", async () => {
    // The USDM case: the resolved inputs the derivation is handed have to carry
    // the assets an input holds, or what leaves the wallet is understated.
    const usdm = {
      policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128",
      assetName: "5553444d",
      quantity: 20_000_000n
    }
    const { api, log } = scriptedWallet({
      utxos: [[asCip30Hex(walletUtxo({ ...held(100_000_000n, 1), assets: [usdm] }))]]
    })
    const receipt = await complete(api, { intent: specIntent("token-payment.json") })

    expect(receipt.attempts).toBe(1)
    expect(log.submitted).toHaveLength(1)
  })

  it("reports each attempt before the wallet is asked to sign it", async () => {
    const { api } = scriptedWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const seen: Array<string> = []
    const receipt = await complete(api, { onAttempt: (attempt) => seen.push(attempt.transactionId) })

    expect(seen).toEqual([receipt.transactionId])
  })
})

describe("when the funds move between building and submitting", () => {
  it("rebuilds from the wallet's fresh outputs and submits the new transaction", async () => {
    // The first output is spent elsewhere the moment it is signed; the second
    // attempt is a different transaction, not a resend of the first.
    const { api, log } = scriptedWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)])],
      submits: [inputsGone, true]
    })
    const receipt = await complete(api)

    expect(receipt.attempts).toBe(2)
    expect(log.signed).toHaveLength(2)
    expect(log.signed[0]).not.toBe(log.signed[1])
    expect(receipt.transactionId).toBe(Effect.runSync(transactionIdOf(log.submitted[1] ?? "")))
  })

  it("derives the effects again before asking for the second signature", async () => {
    const { api } = scriptedWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)])],
      submits: [inputsGone, true]
    })
    const attempts: Array<{ number: number; transactionId: string; fee: bigint }> = []
    await complete(api, {
      onAttempt: (attempt) =>
        attempts.push({ number: attempt.number, transactionId: attempt.transactionId, fee: attempt.effects.fee })
    })

    // Two derivations over two different bodies: a second signature prompted
    // against effects derived from the first body would be a signature for
    // something nobody read.
    expect(attempts.map((attempt) => attempt.number)).toEqual([1, 2])
    expect(attempts[0]?.transactionId).not.toBe(attempts[1]?.transactionId)
  })

  it("gives up after a bounded number of rebuilds rather than asking forever", async () => {
    const { api, log } = scriptedWallet({
      utxos: [asHex([held(100_000_000n, 1)])],
      submits: [inputsGone]
    })

    const error = await failure(api, { attempts: 3 }, "OutOfAttempts")
    expect(log.signed).toHaveLength(3)
    expect(error.message).toContain("moved")
  })

  it("does not rebuild for a failure that is not the funds moving", async () => {
    const { api, log } = scriptedWallet({
      utxos: [asHex([held(100_000_000n, 1)])],
      submits: [{ code: 2, info: "the node is unreachable" }]
    })
    const result = await Effect.runPromise(Effect.either(completeIntent(request(api))))

    // Rebuilding here would put a second signature in front of a person for a
    // failure a rebuild cannot fix.
    expect(Either.isLeft(result)).toBe(true)
    expect(log.signed).toHaveLength(1)
  })
})

describe("what is never signed", () => {
  it("blocks when the derived effects disagree with what was declared", async () => {
    // A wallet that does not report its own change address: the change output
    // then reads as a payment to a stranger that the intent never declared.
    const { api, log } = scriptedWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const error = await failure(api, { userAddresses: [] }, "Blocked")

    expect(log.signed).toEqual([])
    expect(error.code).toBe("EFFECTS_MISMATCH")
    expect(error.reasons?.map((reason) => reason.code)).toContain("output.undeclared")
  })

  it("refuses when the effects cannot be derived at all", async () => {
    // The same input answered twice at two values. Picking either would show a
    // figure the other reading contradicts.
    const twice = [...asHex([held(100_000_000n, 1)]), ...asHex([held(70_000_000n, 1)])]
    const { api, log } = scriptedWallet({ utxos: [twice] })

    await failure(api, {}, "CannotJudge")
    expect(log.signed).toEqual([])
  })

  it("refuses when the effects could not be put in front of a person", async () => {
    // The caller renders them. If that throws, nobody saw the effects, and a
    // signature asked for after that is one nobody read.
    const { api, log } = scriptedWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const blowUp = (): never => {
      throw new Error("the panel blew up")
    }

    await failure(api, { onAttempt: blowUp }, "NotShown")
    expect(log.signed).toEqual([])
  })

  it("refuses when the wallet holds nothing", async () => {
    const { api } = scriptedWallet({ utxos: [[]] })

    const error = await failure(api, {}, "NoUtxos")
    expect(error.code).toBe("INSUFFICIENT_FUNDS")
  })

  it("refuses when the wallet's answer cannot be read", async () => {
    const { api } = scriptedWallet({ utxos: [["not an unspent output"]] })

    await failure(api, {}, "UnreadableUtxos")
  })

  it("refuses when the wallet will not say what it holds", async () => {
    // The other way that question fails: rejected outright rather than answered
    // with something unreadable.
    const api = stubApi({
      getUtxos: async () => {
        throw { code: -2, info: "internal error" }
      }
    })

    await failure(api, {}, "UnreadableUtxos")
  })
})

describe("the refusals", () => {
  it("are every one this suite reached", () => {
    expect([...reached].sort()).toEqual(Object.keys(completionRefusals).sort())
  })
})
