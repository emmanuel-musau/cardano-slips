import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePartialIntent, type Intent } from "@cardano-slips/core"
import { decodeBech32, decodeTransaction } from "@cardano-slips/verifier"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import type { Cip30Api } from "../src/cip30.js"
import { type Attempt, type CompletionRequest, completeIntent, type Progress, type Receipt } from "../src/complete.js"
import { type CompletionError, completionRefusals, type CompletionRefusal } from "../src/complete-error.js"
import { transactionIdOf } from "../src/witness.js"
import { fails, mockWallet, toHex } from "./mock-wallet.js"
import { enterpriseAddress, mainnetAddress, testnetAddress } from "./stub-wallet.js"
import {
  asCip30Hex,
  mainnetParameters,
  preprodParameters,
  testnetShop,
  type UtxoSpec,
  walletUtxo
} from "./wallet-utxos.js"

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

/** Where payment.json sends its 12 ADA. */
const shop = "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"

const held = (lovelace: bigint, seed: number, index = 0n): UtxoSpec => ({
  bech32: mainnetAddress.bech32,
  lovelace,
  seed,
  index
})

const asHex = (specs: ReadonlyArray<UtxoSpec>): ReadonlyArray<string> =>
  specs.map((spec) => asCip30Hex(walletUtxo(spec)))

const request = (api: Cip30Api, overrides: Partial<CompletionRequest> = {}): CompletionRequest => ({
  api,
  intent: specIntent("payment.json"),
  network: "mainnet",
  changeAddress: mainnetAddress.bech32,
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

const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"))

const spentBy = (cbor: string): ReadonlyArray<string> => {
  const transaction = decodeTransaction(fromHex(cbor))
  if (Either.isLeft(transaction)) throw new Error("the submitted transaction cannot be read")
  return transaction.right.body.inputs.map((input) => `${toHex(input.transactionId)}#${input.index}`)
}

const transactionOf = (seed: number): string => String(seed).padStart(64, "a")

const outRefOf = (seed: number, index = 0): string => `${transactionOf(seed)}#${index}`

/** The ledger's own words for an input that is no longer there. */
const inputsGone = { code: 2, info: "ValueNotConservedUTxO BadInputsUTxO" }

describe("a Slip that completes", () => {
  it("builds, judges, signs and submits, and answers with the transaction id", async () => {
    const { api, log } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
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
    const { api, log } = mockWallet({
      utxos: [[asCip30Hex(walletUtxo({ ...held(100_000_000n, 1), assets: [usdm] }))]]
    })
    const receipt = await complete(api, { intent: specIntent("token-payment.json") })

    expect(receipt.attempts).toBe(1)
    expect(log.submitted).toHaveLength(1)
  })

  it("reports each attempt before the wallet is asked to sign it", async () => {
    const { api } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const seen: Array<string> = []
    const receipt = await complete(api, { onAttempt: (attempt) => seen.push(attempt.transactionId) })

    expect(seen).toEqual([receipt.transactionId])
  })
})

describe("what each attempt carries for the person to read", () => {
  it("what leaves the wallet, which for a payment is the amount and the fee", async () => {
    const { api } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const attempts: Array<Attempt> = []
    await complete(api, { onAttempt: (attempt) => attempts.push(attempt) })

    const [attempt] = attempts
    expect(attempt?.lovelace.fee).toBe(attempt?.effects.fee)
    expect(attempt?.lovelace.user.ada).toBe(12_000_000n + (attempt?.lovelace.fee ?? 0n))
    expect(attempt?.lovelace.deposits).toEqual([])
    expect(attempt?.assets.user).toEqual([])
  })

  it("each asset that leaves, in base units", async () => {
    const usdm = {
      policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128",
      assetName: "5553444d",
      quantity: 20_000_000n
    }
    const { api } = mockWallet({
      utxos: [[asCip30Hex(walletUtxo({ ...held(100_000_000n, 1), assets: [usdm] }))]]
    })
    const attempts: Array<Attempt> = []
    await complete(api, { intent: specIntent("token-payment.json"), onAttempt: (attempt) => attempts.push(attempt) })

    expect(attempts[0]?.assets.user.map((asset) => asset.delta)).toEqual([12_000_000n])
  })
})

describe("when the funds move between building and submitting", () => {
  it("rebuilds from the wallet's fresh outputs and submits the new transaction", async () => {
    // The first output is spent elsewhere the moment it is signed; the second
    // attempt is a different transaction, not a resend of the first.
    const { api, log } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)])],
      submits: [fails(inputsGone), "accept"]
    })
    const receipt = await complete(api)

    expect(receipt.attempts).toBe(2)
    expect(log.signed).toHaveLength(2)
    expect(log.signed[0]).not.toBe(log.signed[1])
    expect(receipt.transactionId).toBe(Effect.runSync(transactionIdOf(log.submitted[1] ?? "")))
  })

  it("derives the effects again before asking for the second signature", async () => {
    const { api } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)])],
      submits: [fails(inputsGone), "accept"]
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

  it("leaves out every input of the attempt that failed when the node does not name them", async () => {
    const { api, log } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(100_000_000n, 1), held(90_000_000n, 2)])],
      submits: [fails(inputsGone), "accept"]
    })
    const receipt = await complete(api)

    expect(receipt.attempts).toBe(2)
    expect(spentBy(log.submitted[1] ?? "")).toEqual([outRefOf(2)])
  })

  it("leaves out only the inputs the node names, and builds from the rest", async () => {
    const named = {
      code: 2,
      info: `BadInputsUTxO (fromList [TxIn (TxId {unTxId = SafeHash "${outRefOf(1).slice(0, 64)}"}) (TxIx 0)])`
    }
    const { api, log } = mockWallet({
      utxos: [
        asHex([held(8_000_000n, 1), held(8_000_000n, 2)]),
        asHex([held(8_000_000n, 1), held(8_000_000n, 2), held(8_000_000n, 3)])
      ],
      submits: [fails(named), "accept"]
    })
    const receipt = await complete(api)

    expect(spentBy(log.submitted[0] ?? "")).toEqual(expect.arrayContaining([outRefOf(1), outRefOf(2)]))
    expect(receipt.attempts).toBe(2)
    expect([...spentBy(log.submitted[1] ?? "")].sort()).toEqual([outRefOf(2), outRefOf(3)])
  })

  it.each([
    [
      "the ledger's own words",
      `BadInputsUTxO (fromList [TxIn (TxId {unTxId = SafeHash "${transactionOf(1)}"}) (TxIx {unTxIx = 1})])`
    ],
    [
      "an older ledger's words",
      `BadInputsUTxO (fromList [TxIn (TxId {unTxId = SafeHash "${transactionOf(1)}"}) (TxIx 1)])`
    ],
    ["an output reference", `ConwayUtxowFailure (UtxoFailure (BadInputsUTxO [${outRefOf(1, 1)}]))`]
  ])("keeps a sibling output the node did not name, in %s", async (_, info) => {
    const { api, log } = mockWallet({
      utxos: [
        asHex([held(8_000_000n, 1, 0n), held(8_000_000n, 1, 1n)]),
        asHex([held(8_000_000n, 1, 0n), held(8_000_000n, 1, 1n), held(8_000_000n, 2)])
      ],
      submits: [fails({ code: 2, info }), "accept"]
    })
    const receipt = await complete(api)

    expect(receipt.attempts).toBe(2)
    expect([...spentBy(log.submitted[1] ?? "")].sort()).toEqual([outRefOf(1, 0), outRefOf(2)])
  })

  it("says the wallet is behind, not short, when only what was just spent would have paid", async () => {
    const { api, log } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(100_000_000n, 1), held(2_000_000n, 2)])],
      submits: [fails(inputsGone)]
    })

    await failure(api, {}, "WalletBehind")
    expect(log.signed).toHaveLength(1)
  })

  it("asks for no second signature when the wallet lists nothing but what was just spent", async () => {
    const { api, log } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)])],
      submits: [fails(inputsGone)]
    })

    const error = await failure(api, {}, "WalletBehind")
    expect(log.signed).toHaveLength(1)
    expect(error.message).toContain("just spent")
  })

  it("gives up after a bounded number of rebuilds rather than asking forever", async () => {
    const { api, log } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)]), asHex([held(80_000_000n, 3)])],
      submits: [fails(inputsGone)]
    })

    const error = await failure(api, { attempts: 3 }, "OutOfAttempts")
    expect(log.signed).toHaveLength(3)
    expect(error.message).toContain("moved")
  })

  it("does not rebuild for a failure that is not the funds moving", async () => {
    const { api, log } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)])],
      submits: [fails({ code: 2, info: "the node is unreachable" })]
    })
    const result = await Effect.runPromise(Effect.either(completeIntent(request(api))))

    // Rebuilding here would put a second signature in front of a person for a
    // failure a rebuild cannot fix.
    expect(Either.isLeft(result)).toBe(true)
    expect(log.signed).toHaveLength(1)
  })
})

describe("when the node refuses the validity window", () => {
  const outsideWindow = { code: 2, info: "OutsideValidityIntervalUTxO" }

  /** Forty minutes before payment.json expires, so the window is open by any honest clock. */
  const wellBeforeExpiry = Date.parse("2026-08-22T19:00:00Z")

  const refusalOf = async (api: Cip30Api, overrides: Partial<CompletionRequest>) => {
    const result = await Effect.runPromise(Effect.either(completeIntent(request(api, overrides))))
    return Either.isLeft(result) && "refusal" in result.left ? result.left.refusal : "completed"
  }

  it("names a testnet wallet as on the other testnet when the window is still open here", async () => {
    const { api, log } = mockWallet({
      networkId: 0,
      changeAddress: testnetAddress.hex,
      usedAddresses: [testnetAddress.hex],
      rewardAddresses: [],
      utxos: [[asCip30Hex(walletUtxo({ bech32: testnetAddress.bech32, lovelace: 100_000_000n }))]],
      submits: [fails(outsideWindow)]
    })
    const error = await failure(
      api,
      {
        intent: { ...specIntent("payment.json"), outputs: [{ address: testnetShop, lovelace: "12000000" }] },
        network: "preprod",
        changeAddress: testnetAddress.bech32,
        parameters: preprodParameters,
        now: () => wellBeforeExpiry
      },
      "WrongNetwork"
    )

    expect(error.code).toBe("WRONG_NETWORK")
    expect(log.signed).toHaveLength(1)
  })

  /** Where a preprod node's clock stands at `time`, on preprod's own slot mapping. */
  const preprodSlotAt = (time: number): bigint => 86_400n + BigInt(Math.floor((time - 1_655_769_600_000) / 1_000))

  /** Where a preview node's clock stands at `time`. */
  const previewSlotAt = (time: number): bigint => BigInt(Math.floor((time - 1_666_656_000_000) / 1_000))

  const testnetWallet = (info: string) =>
    mockWallet({
      networkId: 0,
      changeAddress: testnetAddress.hex,
      usedAddresses: [testnetAddress.hex],
      rewardAddresses: [],
      utxos: [[asCip30Hex(walletUtxo({ bech32: testnetAddress.bech32, lovelace: 100_000_000n }))]],
      submits: [fails({ code: 2, info })]
    })

  const onPreprod: Partial<CompletionRequest> = {
    intent: { ...specIntent("payment.json"), outputs: [{ address: testnetShop, lovelace: "12000000" }] },
    network: "preprod",
    changeAddress: testnetAddress.bech32,
    parameters: preprodParameters,
    now: () => wellBeforeExpiry
  }

  const afterExpiry = Date.parse("2026-08-22T19:45:00Z")

  it.each([
    [
      "the ledger's own words",
      (slot: bigint) =>
        `OutsideValidityIntervalUTxO (ValidityInterval {invalidBefore = SNothing, invalidHereafter = SJust (SlotNo 1)}) (SlotNo ${slot})`
    ],
    [
      "a wallet's or Ogmios's words",
      (slot: bigint) =>
        `OutsideValidityIntervalUTxO {invalidBefore: SNothing, invalidHereafter: SJust (SlotNo 1), slot: SlotNo ${slot}}`
    ]
  ])("trusts the node's slot over a slow device clock, in %s", async (_, info) => {
    const { api } = testnetWallet(info(preprodSlotAt(afterExpiry)))

    expect(await refusalOf(api, onPreprod)).toBe("IntervalPassed")
  })

  it("names the other testnet when the node's slot is on another chain's clock", async () => {
    const { api } = testnetWallet(
      `OutsideValidityIntervalUTxO (ValidityInterval {invalidBefore = SNothing, invalidHereafter = SJust (SlotNo 1)}) (SlotNo ${previewSlotAt(wellBeforeExpiry)})`
    )

    expect(await refusalOf(api, onPreprod)).toBe("WrongNetwork")
  })

  it("never names a mainnet wallet as on another network, which connecting already ruled out", async () => {
    const { api } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])], submits: [fails(outsideWindow)] })

    expect(await refusalOf(api, { now: () => wellBeforeExpiry })).toBe("IntervalPassed")
  })

  it("leaves a refusal at the end of the window as the window having passed", async () => {
    const { api } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])], submits: [fails(outsideWindow)] })

    expect(await refusalOf(api, {})).toBe("IntervalPassed")
  })
})

describe("what is never signed", () => {
  const withdrawal = { intent: specIntent("rewards-withdrawal.json"), rewardBalance: 5_000_000n }

  it("blocks when the derived effects disagree with what was declared", async () => {
    // The withdrawal draws on the reward account behind the change address, and
    // the wallet does not report that account as its own.
    const { api, log } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])], rewardAddresses: [] })
    const error = await failure(api, withdrawal, "Blocked")

    expect(log.signed).toEqual([])
    expect(error.code).toBe("EFFECTS_MISMATCH")
    expect(error.reasons?.map((reason) => reason.code)).toContain("withdrawal.account")
  })

  it("carries what the blocked transaction does, so the block can show it beside what was declared", async () => {
    const { api } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])], rewardAddresses: [] })
    const error = await failure(api, withdrawal, "Blocked")

    expect(error.derived?.effects.outputs.length).toBeGreaterThan(0)
    expect(error.derived?.lovelace.fee).toBe(error.derived?.effects.fee)
    expect(error.derived?.assets.user).toEqual([])
  })

  it("refuses when the effects cannot be derived at all", async () => {
    // The same input answered twice at two values. Picking either would show a
    // figure the other reading contradicts.
    const twice = [...asHex([held(100_000_000n, 1)]), ...asHex([held(70_000_000n, 1)])]
    const { api, log } = mockWallet({ utxos: [twice] })

    await failure(api, {}, "CannotJudge")
    expect(log.signed).toEqual([])
  })

  it("refuses when the effects could not be put in front of a person", async () => {
    // The caller renders them. If that throws, nobody saw the effects, and a
    // signature asked for after that is one nobody read.
    const { api, log } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const blowUp = (): never => {
      throw new Error("the panel blew up")
    }

    await failure(api, { onAttempt: blowUp }, "NotShown")
    expect(log.signed).toEqual([])
  })

  it("refuses when the wallet holds nothing", async () => {
    const { api } = mockWallet({ utxos: [[]] })

    const error = await failure(api, {}, "NoUtxos")
    expect(error.code).toBe("INSUFFICIENT_FUNDS")
  })

  it("refuses when the wallet's answer cannot be read", async () => {
    const { api } = mockWallet({ utxos: [["not an unspent output"]] })

    await failure(api, {}, "UnreadableUtxos")
  })

  it("refuses when the wallet will not say what it holds", async () => {
    // The other way that question fails: rejected outright rather than answered
    // with something unreadable.
    const { api } = mockWallet({ utxos: [fails({ code: -2, info: "internal error" })] })

    await failure(api, {}, "UnreadableUtxos")
  })
})

describe("waiting for the person to agree", () => {
  it("asks the wallet for nothing until the person has pressed sign", async () => {
    const { api, log } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    let agree: (agreed: boolean) => void = () => undefined
    const pending = complete(api, { confirm: () => new Promise<boolean>((settle) => (agree = settle)) })

    await new Promise((later) => setTimeout(later, 10))
    expect(log.calls).not.toContain("signTx")

    agree(true)
    expect((await pending).attempts).toBe(1)
    expect(log.calls).toContain("signTx")
  })

  it("ends with nothing signed when the person closes the transaction", async () => {
    const { api, log } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })

    const error = await failure(api, { confirm: async () => false }, "Cancelled")
    expect(error.code).toBeUndefined()
    expect(log.signed).toEqual([])
  })

  it("signs nothing when the question could not be put", async () => {
    const { api, log } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })

    await failure(api, { confirm: () => Promise.reject(new Error("the button never rendered")) }, "NotShown")
    expect(log.signed).toEqual([])
  })

  it("asks again for a rebuilt transaction, naming the new one", async () => {
    const { api } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)])],
      submits: [fails(inputsGone), "accept"]
    })
    const asked: Array<string> = []
    await complete(api, { confirm: async (attempt) => (asked.push(attempt.transactionId), true) })

    expect(asked).toHaveLength(2)
    expect(asked[0]).not.toBe(asked[1])
  })

  it("reports signing, submitting and rebuilding in the order they happen", async () => {
    const { api } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)])],
      submits: [fails(inputsGone), "accept"]
    })
    const seen: Array<Progress> = []
    const receipt = await complete(api, { onProgress: (progress) => seen.push(progress) })

    expect(seen.map((progress) => progress._tag)).toEqual([
      "Signing",
      "Submitting",
      "Rebuilding",
      "Signing",
      "Submitting"
    ])
    expect(seen[2]).toEqual({ _tag: "Rebuilding", number: 2, of: 3 })
    expect(seen[4]).toEqual({ _tag: "Submitting", transactionId: receipt.transactionId })
  })

  it("carries on when a progress report throws", async () => {
    const { api } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const receipt = await complete(api, {
      onProgress: () => {
        throw new Error("the screen fell over")
      }
    })

    expect(receipt.attempts).toBe(1)
  })
})

describe("the addresses the wallet calls its own", () => {
  const firstAttempt = async (wallet: ReturnType<typeof mockWallet>) => {
    const attempts: Array<Attempt> = []
    await complete(wallet.api, { onAttempt: (attempt) => attempts.push(attempt) })
    return attempts[0]!
  }

  it("include the address of every output it said it holds, listed or not", async () => {
    // Funds at an address the wallet left out of its lists. Read as a stranger's,
    // the input would hide what leaves and show the change as money arriving.
    const wallet = mockWallet({ utxos: [asHex([{ bech32: enterpriseAddress.bech32, lovelace: 100_000_000n }])] })
    const attempt = await firstAttempt(wallet)

    expect(attempt.lovelace.user.ada).toBe(12_000_000n + attempt.lovelace.fee)
  })

  it("include the change address, which the change is paid to whatever the wallet lists", async () => {
    // A wallet that lists nothing, holding funds at one address and giving another for change.
    const wallet = mockWallet({
      utxos: [asHex([{ bech32: enterpriseAddress.bech32, lovelace: 100_000_000n }])],
      usedAddresses: [],
      rewardAddresses: []
    })
    const attempt = await firstAttempt(wallet)

    expect(attempt.lovelace.user.ada).toBe(12_000_000n + attempt.lovelace.fee)
  })

  it.each([
    ["used", "usedAddresses"],
    ["unused", "unusedAddresses"]
  ] as const)("include its %s addresses, so paying one of them is not money leaving", async (_, list) => {
    const wallet = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)])],
      [list]: [mainnetAddress.hex, toHex(addressBytes(shop))]
    })
    const attempt = await firstAttempt(wallet)

    expect(attempt.lovelace.user.ada).toBe(attempt.lovelace.fee)
  })

  it("include the reward account it reports, which a withdrawal from it needs", async () => {
    const wallet = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])] })
    const receipt = await complete(wallet.api, {
      intent: specIntent("rewards-withdrawal.json"),
      rewardBalance: 5_000_000n
    })

    expect(receipt.attempts).toBe(1)
  })

  it("are read again with the outputs on every attempt", async () => {
    const { api, log } = mockWallet({
      utxos: [asHex([held(100_000_000n, 1)]), asHex([held(90_000_000n, 2)])],
      submits: [fails(inputsGone), "accept"]
    })
    await complete(api)

    expect(log.calls.filter((call) => call === "getUsedAddresses")).toHaveLength(2)
  })

  it.each([
    ["the wallet rejects the question", { usedAddresses: fails({ code: -2, info: "internal error" }) }],
    ["the answer is not a list", { rewardAddresses: null as unknown as ReadonlyArray<string> }],
    ["an address is not hex", { unusedAddresses: ["zz"] }],
    ["an address is on another network", { usedAddresses: [mainnetAddress.hex, testnetAddress.hex] }]
  ])("refuse when %s", async (_, script) => {
    const { api, log } = mockWallet({ utxos: [asHex([held(100_000_000n, 1)])], ...script })

    await failure(api, {}, "UnreadableAddresses")
    expect(log.signed).toEqual([])
  })
})

describe("the refusals", () => {
  it("are every one this suite reached", () => {
    expect([...reached].sort()).toEqual(Object.keys(completionRefusals).sort())
  })
})
