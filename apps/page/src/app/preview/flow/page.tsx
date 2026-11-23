import { notFound } from "next/navigation.js"

import { PreviewFlow } from "./preview-flow.js"
import { isPreviewNetwork, isScenario } from "./wallet.js"

// A wallet that signs nothing real and submits nowhere: never on a hosted page.
export const dynamic = "force-dynamic"

export type PreviewFlowProps = {
  readonly searchParams: Promise<Record<string, string | ReadonlyArray<string> | undefined>>
}

/** `?uri=` as on the real page, `?wallet=` for the scenario, and `?network=mainnet` for a wallet off the served examples' network. */
export default async function FlowPreview({ searchParams }: PreviewFlowProps) {
  if (process.env.NODE_ENV === "production") notFound()

  const { network, uri, wallet } = await searchParams
  const scenario = typeof wallet === "string" && isScenario(wallet) ? wallet : "signs"
  return (
    <PreviewFlow
      link={typeof uri === "string" ? uri : undefined}
      scenario={scenario}
      network={typeof network === "string" && isPreviewNetwork(network) ? network : "testnet"}
    />
  )
}
