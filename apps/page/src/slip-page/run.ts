/**
 * One press of an action, from the wallet to a receipt: connect on the Slip's
 * network, ask the endpoint for the intent, then build, judge, show, sign and
 * submit through `completeIntent`, which is where no signature skips the check.
 */
import type { Network } from "@cardano-slips/core"
import {
  type Attempt,
  completeIntent,
  connectWallet,
  type Progress,
  type Receipt,
  requestIntent,
  type SlipSubmission
} from "@cardano-slips/flow"
import { Effect } from "effect"

import { parametersFor } from "./parameters.js"
import type { FlowFailure } from "./screens.js"

export type RunRequest = {
  readonly submission: SlipSubmission
  readonly network: Network
  /** The `window.cardano` key of the wallet the person picked. */
  readonly walletKey: string
  /** Where `cardano` lives. The browser's `window`, or a stand-in under test. */
  readonly host?: unknown
}

export type RunHooks = {
  readonly onAttempt: (attempt: Attempt) => void
  readonly confirm: (attempt: Attempt) => Promise<boolean>
  readonly onProgress: (progress: Progress) => void
}

export const runSlip = (
  { host, network, submission, walletKey }: RunRequest,
  hooks: RunHooks
): Effect.Effect<Receipt, FlowFailure> =>
  Effect.gen(function* () {
    const connected = yield* connectWallet(walletKey, { network, ...(host === undefined ? {} : { host }) })
    const partial = yield* requestIntent({ href: submission.href, changeAddress: connected.changeAddress, network })
    return yield* completeIntent({
      api: connected.api,
      intent: partial.intent,
      network,
      changeAddress: connected.changeAddress,
      parameters: parametersFor[network],
      ...hooks
    })
  })

const explorers: Readonly<Record<Network, string>> = {
  mainnet: "https://cardanoscan.io",
  preprod: "https://preprod.cardanoscan.io",
  preview: "https://preview.cardanoscan.io"
}

/** The receipt's link out: the only copy of it anyone keeps, since this page keeps none. */
export const explorerFor = (network: Network, transactionId: string) => ({
  name: "cardanoscan",
  url: `${explorers[network]}/transaction/${transactionId}`
})
