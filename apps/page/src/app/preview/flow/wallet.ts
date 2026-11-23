/**
 * A scripted CIP-30 wallet for walking the flow on a development build. It holds
 * example outputs, signs with a witness that proves nothing, and submits
 * nowhere: the "transaction id" it answers with is computed, not broadcast.
 * The hex was produced with `packages/flow/test`'s own codecs.
 */
import type { Cip30Api, Cip30Provider } from "@cardano-slips/flow"
import { transactionIdOf } from "@cardano-slips/flow"
import { Effect } from "effect"

/** The wallet's network: a test network unless asked otherwise, since the served examples are on preview. */
export type PreviewNetwork = "mainnet" | "testnet"

const mainnetAddress =
  "01f52f4b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c491273afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d"

/** 100 ADA at the mainnet address. */
const mainnetFirstOutput =
  "82825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa100a200583901f52f4b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c491273afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d011a05f5e100"

/** 90 ADA at the same address, which arrives once the first has been spent elsewhere. */
const mainnetSecondOutput =
  "82825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa200a200583901f52f4b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c491273afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d011a055d4a80"

const testnetAddress =
  "007de95d293df3b26372d5aa159fe9b12dd3cf4891190907379325322de2473fb11d227c765bcf5fcb0d8c32709f63b54decf85c8809615faf"

/** Both base addresses are 57 bytes, so swapping one for the other keeps the output's CBOR well formed. */
const atTestnetAddress = (output: string): string => output.replace(mainnetAddress, testnetAddress)

type Fixtures = {
  readonly networkId: 0 | 1
  /** A base address, as `getChangeAddress` returns it. */
  readonly address: string
  readonly rewardAccount: string
  readonly firstOutput: string
  readonly secondOutput: string
}

export const previewHex: Readonly<Record<PreviewNetwork, Fixtures>> & { readonly witnesses: string } = {
  mainnet: {
    networkId: 1,
    address: mainnetAddress,
    rewardAccount: "e1" + mainnetAddress.slice(58),
    firstOutput: mainnetFirstOutput,
    secondOutput: mainnetSecondOutput
  },
  testnet: {
    networkId: 0,
    address: testnetAddress,
    rewardAccount: "e0" + testnetAddress.slice(58),
    firstOutput: atTestnetAddress(mainnetFirstOutput),
    secondOutput: atTestnetAddress(mainnetSecondOutput)
  },
  witnesses:
    "a100d90102818258201111111111111111111111111111111111111111111111111111111111111111584011111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
}

export const scenarios = ["signs", "declines", "funds-move", "refuses", "empty"] as const
export type Scenario = (typeof scenarios)[number]

export const isScenario = (value: string | undefined): value is Scenario =>
  value !== undefined && (scenarios as ReadonlyArray<string>).includes(value)

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** A wallet takes a moment to open; without one, the waiting state would flash past unseen. */
const walletDelay = 1_200

export const isPreviewNetwork = (value: string | undefined): value is PreviewNetwork =>
  value === "mainnet" || value === "testnet"

export type PreviewOptions = {
  readonly delay?: number
  readonly network?: PreviewNetwork
}

export const previewApi = (
  scenario: Scenario,
  { delay = walletDelay, network = "testnet" }: PreviewOptions = {}
): Cip30Api => {
  const fixtures = previewHex[network]
  // The first output's reference, as it appears in a body that spends it.
  const firstInput = fixtures.firstOutput.slice(4, 74)
  let reads = 0
  return {
    getNetworkId: async () => fixtures.networkId,
    getChangeAddress: async () => fixtures.address,
    getUsedAddresses: async () => [fixtures.address],
    getUnusedAddresses: async () => [],
    getRewardAddresses: async () => [fixtures.rewardAccount],
    getBalance: async () => "00",
    getUtxos: async () => {
      reads += 1
      if (scenario === "empty") return []
      // Like a wallet behind the chain, it goes on listing the first output after the node has called it spent.
      if (scenario === "funds-move" && reads > 1) return [fixtures.firstOutput, fixtures.secondOutput]
      return [fixtures.firstOutput]
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
      if (scenario === "funds-move" && transaction.includes(firstInput)) {
        throw { code: 2, info: "ValueNotConservedUTxO BadInputsUTxO" }
      }
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
  options: PreviewOptions = {}
): { readonly cardano: Record<string, Cip30Provider> } => {
  const api = previewApi(scenario, options)
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
