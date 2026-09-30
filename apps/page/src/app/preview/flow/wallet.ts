/**
 * A scripted CIP-30 wallet for walking the flow on a development build. It holds
 * example outputs, signs with a witness that proves nothing, and submits
 * nowhere: the "transaction id" it answers with is computed, not broadcast.
 * The hex was produced with `packages/flow/test`'s own codecs.
 */
import type { Cip30Api, Cip30Provider } from "@cardano-slips/flow"
import { transactionIdOf } from "@cardano-slips/flow"
import { Effect } from "effect"

export const previewHex = {
  /** A mainnet base address, as `getChangeAddress` returns it. */
  address:
    "01f52f4b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c491273afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d",
  testnetAddress:
    "007de95d293df3b26372d5aa159fe9b12dd3cf4891190907379325322de2473fb11d227c765bcf5fcb0d8c32709f63b54decf85c8809615faf",
  rewardAccount: "e173afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d",
  /** 100 ADA at that address. */
  firstOutput:
    "82825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa100a200583901f52f4b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c491273afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d011a05f5e100",
  /** 90 ADA at the same address, what the wallet holds once the first has been spent elsewhere. */
  secondOutput:
    "82825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa200a200583901f52f4b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c491273afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d011a055d4a80",
  witnesses:
    "a100d90102818258201111111111111111111111111111111111111111111111111111111111111111584011111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
}

export const scenarios = ["signs", "declines", "funds-move", "refuses", "empty", "testnet"] as const
export type Scenario = (typeof scenarios)[number]

export const isScenario = (value: string | undefined): value is Scenario =>
  value !== undefined && (scenarios as ReadonlyArray<string>).includes(value)

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** A wallet takes a moment to open; without one, the waiting state would flash past unseen. */
const walletDelay = 1_200

export const previewApi = (scenario: Scenario, delay = walletDelay): Cip30Api => {
  let reads = 0
  let submits = 0
  return {
    getNetworkId: async () => (scenario === "testnet" ? 0 : 1),
    getChangeAddress: async () => (scenario === "testnet" ? previewHex.testnetAddress : previewHex.address),
    getUsedAddresses: async () => [scenario === "testnet" ? previewHex.testnetAddress : previewHex.address],
    getUnusedAddresses: async () => [],
    getRewardAddresses: async () => (scenario === "testnet" ? [] : [previewHex.rewardAccount]),
    getBalance: async () => "00",
    getUtxos: async () => {
      reads += 1
      if (scenario === "empty") return []
      return [scenario === "funds-move" && reads > 1 ? previewHex.secondOutput : previewHex.firstOutput]
    },
    getCollateral: async () => [],
    signTx: async () => {
      await pause(delay)
      if (scenario === "declines") throw { code: 2, info: "user declined" }
      return previewHex.witnesses
    },
    signData: async () => {
      throw { code: -1, info: "not offered by the preview wallet" }
    },
    submitTx: async (transaction) => {
      await pause(delay)
      submits += 1
      if (scenario === "funds-move" && submits === 1) throw { code: 2, info: "ValueNotConservedUTxO BadInputsUTxO" }
      if (scenario === "refuses") throw { code: 2, info: "FeeTooSmallUTxO (Coin 170000) (Coin 168141)" }
      return Effect.runSync(transactionIdOf(transaction))
    }
  }
}

/** Enough "icon" to show where a wallet's own image goes. */
const icon =
  "data:image/svg+xml;base64," +
  "PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAzMiAzMic+PHJlY3Qgd2lkdGg9JzMyJyBoZWlnaHQ9JzMyJyByeD0nOCcgZmlsbD0nY3VycmVudENvbG9yJy8+PC9zdmc+"

export const previewHost = (
  scenario: Scenario,
  delay = walletDelay
): { readonly cardano: Record<string, Cip30Provider> } => {
  const api = previewApi(scenario, delay)
  return {
    cardano: {
      preview: {
        name: "Preview wallet",
        icon,
        apiVersion: "0.1.0",
        supportedExtensions: [],
        isEnabled: async () => true,
        enable: async () => api
      }
    }
  }
}
