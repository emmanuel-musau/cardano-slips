/**
 * A wallet extension with a script: what it holds on each read, what it answers
 * each signature and submission with, and where it fails. Built on the stub
 * provider, so the flow runs through our own CIP-30 handling unchanged.
 */
import { Effect } from "effect"

import type { Cip30Api, Cip30Provider } from "../src/cip30.js"
import { transactionIdOf } from "../src/witness.js"
import { hostWith, mainnetAddress, stubApi, stubProvider } from "./stub-wallet.js"
import { rewardAccountOf } from "./wallet-utxos.js"
import { witnessSet } from "./witnesses.js"

/** A scripted call that throws what it is given, the way an extension rejects. */
export type Fails = { readonly fails: unknown }

export const fails = (error: unknown): Fails => ({ fails: error })

type Step<A> = A | Fails

export type WalletScript = {
  /** One answer per `getUtxos` call; the last is repeated once the script runs out. */
  readonly utxos: ReadonlyArray<Step<ReadonlyArray<string>>>
  /** One witness set per `signTx` call, in the same way. Defaults to a single signature. */
  readonly signs?: ReadonlyArray<Step<string>>
  /** One answer per `submitTx` call, in the same way. `"accept"` answers with the transaction's id. */
  readonly submits?: ReadonlyArray<Step<"accept">>
  /** Hex, as CIP-30 hands them over. Default to the stub's one address and the reward account behind it. */
  readonly usedAddresses?: Step<ReadonlyArray<string>>
  readonly unusedAddresses?: Step<ReadonlyArray<string>>
  readonly rewardAddresses?: Step<ReadonlyArray<string>>
  /** What `enable()` rejects with, where the connection does not go through. */
  readonly enable?: Fails
  readonly networkId?: number
  /** Hex, as CIP-30 hands it over. */
  readonly changeAddress?: string
}

export type WalletLog = {
  /** Every method called, in order, so a test can say what happened before what. */
  readonly calls: Array<string>
  readonly signed: Array<string>
  readonly submitted: Array<string>
}

export type MockWallet = {
  readonly provider: Cip30Provider
  readonly api: Cip30Api
  /** A window-shaped host with the wallet installed under `key`. */
  readonly host: { readonly cardano: Record<string, unknown> }
  readonly key: string
  readonly log: WalletLog
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

export const mainnetRewardAccount = toHex(rewardAccountOf(mainnetAddress.bech32))

const stepOf = <A>(steps: ReadonlyArray<Step<A>>, call: number): Step<A> | undefined =>
  steps[Math.min(call, steps.length - 1)]

const play = <A>(step: Step<A>): A => {
  if (typeof step === "object" && step !== null && "fails" in step) throw step.fails
  return step
}

export const mockWallet = (script: WalletScript, key = "mock"): MockWallet => {
  const log: WalletLog = { calls: [], signed: [], submitted: [] }
  const counts = { utxos: 0, signs: 0, submits: 0 }

  const api = stubApi({
    getNetworkId: async () => {
      log.calls.push("getNetworkId")
      return script.networkId ?? 1
    },
    getChangeAddress: async () => {
      log.calls.push("getChangeAddress")
      return script.changeAddress ?? mainnetAddress.hex
    },
    getUsedAddresses: async () => {
      log.calls.push("getUsedAddresses")
      return script.usedAddresses === undefined ? [mainnetAddress.hex] : play(script.usedAddresses)
    },
    getUnusedAddresses: async () => {
      log.calls.push("getUnusedAddresses")
      return script.unusedAddresses === undefined ? [] : play(script.unusedAddresses)
    },
    getRewardAddresses: async () => {
      log.calls.push("getRewardAddresses")
      return script.rewardAddresses === undefined ? [mainnetRewardAccount] : play(script.rewardAddresses)
    },
    getUtxos: async () => {
      log.calls.push("getUtxos")
      const step = stepOf(script.utxos, counts.utxos) ?? []
      counts.utxos += 1
      return [...play(step)]
    },
    signTx: async (tx) => {
      log.calls.push("signTx")
      log.signed.push(tx)
      const step = stepOf(script.signs ?? [witnessSet("1")], counts.signs) ?? witnessSet("1")
      counts.signs += 1
      return play(step)
    },
    submitTx: async (tx) => {
      log.calls.push("submitTx")
      log.submitted.push(tx)
      const step = stepOf(script.submits ?? ["accept"], counts.submits) ?? "accept"
      counts.submits += 1
      play(step)
      return Effect.runSync(transactionIdOf(tx))
    }
  })

  const provider = stubProvider(
    script.enable === undefined ? { enableResolves: api } : { enableRejects: script.enable.fails }
  )

  return { provider, api, host: hostWith({ [key]: provider }), key, log }
}
