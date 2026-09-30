/**
 * The server half of ADR-0015: ask a chain provider for a network's protocol
 * parameters and hand the browser the figures a run needs, as JSON.
 */
import { Network } from "@cardano-slips/core"
import type { ProtocolParameters } from "@evolution-sdk/evolution/sdk/provider/Provider"
import { Schema } from "effect"

import type { ParametersBody } from "../../../slip-page/parameters.js"

/** One network's `getProtocolParameters`, as every evolution-sdk provider has it. */
export type ReadParameters = (network: Network) => Promise<ProtocolParameters>

/** Figures change at an epoch boundary at the earliest; this spares the provider a call per visit. */
export const keepFor = 10 * 60 * 1_000

export const bodyOf = (figures: ProtocolParameters): ParametersBody => ({
  stakeDeposit: String(figures.keyDeposit),
  poolDeposit: String(figures.poolDeposit),
  drepDeposit: String(figures.drepDeposit),
  governanceActionDeposit: String(figures.govActionDeposit),
  minFeeCoefficient: String(figures.minFeeA),
  minFeeConstant: String(figures.minFeeB),
  coinsPerUtxoByte: String(figures.coinsPerUtxoByte),
  maxTxSize: figures.maxTxSize
})

const isNetwork = Schema.is(Network)

export const answerFor = (read: ReadParameters, now: () => number = Date.now) => {
  const kept = new Map<Network, { readonly body: ParametersBody; readonly at: number }>()
  // One provider call in flight per network, however many visits arrive while it runs.
  const pending = new Map<Network, Promise<ParametersBody>>()

  const figuresFor = (network: Network): Promise<ParametersBody> => {
    const hit = kept.get(network)
    if (hit !== undefined && now() - hit.at < keepFor) return Promise.resolve(hit.body)
    const running = pending.get(network)
    if (running !== undefined) return running
    const call = read(network)
      .then((figures) => {
        const body = bodyOf(figures)
        kept.set(network, { body, at: now() })
        return body
      })
      .finally(() => pending.delete(network))
    pending.set(network, call)
    return call
  }

  return async (_request: Request, { params }: { readonly params: Promise<{ readonly network: string }> }) => {
    const { network } = await params
    if (!isNetwork(network)) return Response.json({ message: `No such network: ${network}` }, { status: 404 })
    try {
      const body = await figuresFor(network)
      return Response.json(body, { headers: { "cache-control": `public, max-age=${keepFor / 1_000}` } })
    } catch {
      return Response.json({ message: "The chain provider did not answer." }, { status: 502 })
    }
  }
}
