import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePartialIntent, type Intent } from "@cardano-slips/core"
import { render, screen } from "@testing-library/react"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import type { BalanceError } from "../src/balance-error.js"
import { type Attempt, completeIntent, type Receipt } from "../src/complete.js"
import type { CompletionError } from "../src/complete-error.js"
import { connectWallet } from "../src/connect.js"
import { EffectsPanel } from "../src/effects-panel.js"
import type { SigningError } from "../src/sign-error.js"
import type { WalletConnectError } from "../src/wallet-error.js"
import { transactionIdOf } from "../src/witness.js"
import { fails, type MockWallet, mockWallet } from "./mock-wallet.js"
import { apiError, mainnetAddress } from "./stub-wallet.js"
import { asCip30Hex, mainnetParameters, walletUtxo } from "./wallet-utxos.js"
import { witnessSet } from "./witnesses.js"

/**
 * From an installed extension to a submitted transaction, with only the wallet
 * scripted: connecting, reading funds, building, deriving, comparing, showing,
 * signing and submitting all run as they do for a person.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "partial", "valid")

const intentOf = (file: string): Intent => {
  const decoded = decodePartialIntent(JSON.parse(readFileSync(join(examples, file), "utf8")))
  if (Either.isLeft(decoded)) throw new Error(`${file} is not a partial intent`)
  return decoded.right.intent
}

const beforeExpiry = Date.parse("2026-08-22T19:39:00Z")

const holding = (lovelace: bigint, seed: number): ReadonlyArray<string> => [
  asCip30Hex(walletUtxo({ bech32: mainnetAddress.bech32, lovelace, seed }))
]

const inputsGone = apiError(2, "ValueNotConservedUTxO BadInputsUTxO")

type Walk = {
  /** An example under `spec/examples/partial/valid`. Defaults to the payment. */
  readonly intent?: string
}

type Failure = WalletConnectError | BalanceError | CompletionError | SigningError

/**
 * Connects and completes, rendering the effects panel for each attempt the way
 * the slip page does, and marking in the wallet's log where a person saw them.
 */
const walk = async (wallet: MockWallet, options: Walk = {}): Promise<Either.Either<Receipt, Failure>> => {
  const run = Effect.gen(function* () {
    const connected = yield* connectWallet(wallet.key, { network: "mainnet", host: wallet.host })
    return yield* completeIntent({
      api: connected.api,
      intent: intentOf(options.intent ?? "payment.json"),
      network: connected.network,
      changeAddress: connected.changeAddress,
      parameters: mainnetParameters,
      rewardBalance: 5_000_000n,
      now: () => beforeExpiry,
      onAttempt: (attempt: Attempt) => {
        render(
          <EffectsPanel
            claim="Pay 12 ADA to Corner Store"
            derived={attempt}
            verdict={{ _tag: "match" }}
            clock={() => beforeExpiry}
          />
        )
        wallet.log.calls.push(`shown ${attempt.number}`)
      }
    })
  })
  return Effect.runPromise(Effect.either(run))
}

const refusalOf = (result: Either.Either<Receipt, Failure>): Failure => {
  if (Either.isRight(result)) throw new Error("this was expected to fail and did not")
  return result.left
}

const connecting = ["getNetworkId", "getChangeAddress"]
const reading = ["getUtxos", "getUsedAddresses", "getUnusedAddresses", "getRewardAddresses"]

describe("the happy path", () => {
  it("connects, shows the effects, then signs and submits, in that order", async () => {
    const wallet = mockWallet({ utxos: [holding(100_000_000n, 1)] })
    const result = await walk(wallet)

    expect(wallet.log.calls).toEqual([...connecting, ...reading, "shown 1", "signTx", "submitTx"])
    expect(Either.getOrThrow(result).transactionId).toBe(Effect.runSync(transactionIdOf(wallet.log.submitted[0]!)))
    expect(screen.getByRole("button", { name: "Sign transaction" })).toBeDefined()
  })

  it("submits the body it was shown, with the wallet's witnesses in it", async () => {
    const wallet = mockWallet({ utxos: [holding(100_000_000n, 1)], signs: [witnessSet("7")] })
    await walk(wallet)

    expect(Effect.runSync(transactionIdOf(wallet.log.submitted[0]!))).toBe(
      Effect.runSync(transactionIdOf(wallet.log.signed[0]!))
    )
    expect(wallet.log.submitted[0]).toContain("7".repeat(64))
  })
})

describe("a person saying no", () => {
  it("at the connection, before anything about their funds is read", async () => {
    const wallet = mockWallet({ utxos: [holding(100_000_000n, 1)], enable: fails(apiError(-3, "user declined")) })
    const failure = refusalOf(await walk(wallet))

    expect(failure).toMatchObject({ _tag: "WalletConnectError", refusal: "Refused" })
    expect(wallet.log.calls).toEqual([])
  })

  it("at the signature, which ends the flow with nothing submitted and nothing rebuilt", async () => {
    const wallet = mockWallet({
      utxos: [holding(100_000_000n, 1)],
      signs: [fails(apiError(2, "user declined"))]
    })
    const failure = refusalOf(await walk(wallet))

    expect(failure).toMatchObject({ _tag: "SigningError", refusal: "Declined" })
    expect(wallet.log.calls).toEqual([...connecting, ...reading, "shown 1", "signTx"])
  })

  it("at the signature on a rebuilt transaction, having accepted the first", async () => {
    // Agreeing to the first body is not agreeing to the second: a decline there is final.
    const wallet = mockWallet({
      utxos: [holding(100_000_000n, 1), holding(90_000_000n, 2)],
      signs: [witnessSet("1"), fails(apiError(2, "user declined"))],
      submits: [fails(inputsGone)]
    })
    const failure = refusalOf(await walk(wallet))

    expect(failure).toMatchObject({ _tag: "SigningError", refusal: "Declined" })
    expect(wallet.log.submitted).toHaveLength(1)
  })
})

describe("the funds moving mid-flow", () => {
  it("reads the wallet again, shows the new effects, and asks for a second signature", async () => {
    const wallet = mockWallet({
      utxos: [holding(100_000_000n, 1), holding(90_000_000n, 2)],
      submits: [fails(inputsGone), "accept"]
    })
    const receipt = Either.getOrThrow(await walk(wallet))

    expect(wallet.log.calls).toEqual([
      ...connecting,
      ...reading,
      ...["shown 1", "signTx", "submitTx"],
      ...reading,
      ...["shown 2", "signTx", "submitTx"]
    ])
    expect(receipt.attempts).toBe(2)
    expect(receipt.transactionId).toBe(Effect.runSync(transactionIdOf(wallet.log.submitted[1]!)))
    expect(wallet.log.signed[0]).not.toBe(wallet.log.signed[1])
  })

  it("stops after the attempts run out, with every one of them shown before it was signed", async () => {
    const wallet = mockWallet({ utxos: [holding(100_000_000n, 1)], submits: [fails(inputsGone)] })
    const failure = refusalOf(await walk(wallet))

    expect(failure).toMatchObject({ _tag: "CompletionError", refusal: "OutOfAttempts" })
    const shown = wallet.log.calls.filter((call) => call.startsWith("shown"))
    expect(shown).toEqual(["shown 1", "shown 2", "shown 3"])
    expect(wallet.log.signed).toHaveLength(3)
  })
})

/** A withdrawal from a wallet that does not report the reward account the withdrawal draws on. */
const unvouched = { utxos: [holding(100_000_000n, 1)], rewardAddresses: [] }

describe("the mismatch block", () => {
  it("stops before anything is shown as signable, and never reaches the wallet's signTx", async () => {
    const wallet = mockWallet(unvouched)
    const failure = refusalOf(await walk(wallet, { intent: "rewards-withdrawal.json" }))

    expect(failure).toMatchObject({ _tag: "CompletionError", refusal: "Blocked" })
    expect(wallet.log.calls).toEqual([...connecting, ...reading])
  })

  it("renders the block from the failure, with no way to sign", async () => {
    const wallet = mockWallet(unvouched)
    const failure = refusalOf(await walk(wallet, { intent: "rewards-withdrawal.json" })) as CompletionError

    const { container } = render(
      <EffectsPanel
        claim="Withdraw your rewards"
        derived={failure.derived!}
        verdict={{ _tag: "mismatch", reasons: failure.reasons ?? [] }}
        clock={() => beforeExpiry}
      />
    )

    expect(screen.queryByRole("button", { name: "Sign transaction" })).toBeNull()
    expect(container.querySelectorAll("[data-mark]").length).toBeGreaterThan(0)
  })
})
