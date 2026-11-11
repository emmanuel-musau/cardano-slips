/**
 * Where a run gets its protocol parameters (ADR-0015): the figures a caller
 * passes in, or else the page's own `/parameters/<network>`, read once before
 * the flow starts.
 */
import type { Network } from "@cardano-slips/core"
import type { BalancingParameters } from "@cardano-slips/flow"
import { Data, Effect, Schema } from "effect"

/** The slot-to-time mapping is set at genesis and moves only at a hard fork, so it ships. */
export const slotsFor: Readonly<Record<Network, BalancingParameters["slots"]>> = {
  // Shelley began at slot 4492800, 2020-07-29T21:44:51Z.
  mainnet: { slot: 4_492_800n, time: 1_596_059_091_000n, slotLength: 1_000n },
  // Four Byron epochs of 20-second slots, so Shelley began at slot 86400, 2022-06-21.
  preprod: { slot: 86_400n, time: 1_655_769_600_000n, slotLength: 1_000n },
  // No Byron era: slot 0 is the system start, 2022-10-25.
  preview: { slot: 0n, time: 1_666_656_000_000n, slotLength: 1_000n }
}

const Lovelace = Schema.compose(Schema.NonEmptyTrimmedString, Schema.BigInt).pipe(Schema.filter((value) => value >= 0n))

/** What `/parameters/<network>` answers. Lovelace travels as decimal strings, since JSON has no bigint. */
export const ParametersBody = Schema.Struct({
  stakeDeposit: Lovelace,
  poolDeposit: Lovelace,
  drepDeposit: Lovelace,
  governanceActionDeposit: Lovelace,
  minFeeCoefficient: Lovelace,
  minFeeConstant: Lovelace,
  coinsPerUtxoByte: Lovelace,
  maxTxSize: Schema.Int.pipe(Schema.positive())
})

export type ParametersBody = typeof ParametersBody.Encoded

export class ParametersError extends Data.TaggedError("ParametersError")<{
  readonly network: Network
  readonly detail: string
}> {}

const decodeBody = Schema.decodeUnknown(ParametersBody)

export const fetchParameters = (network: Network): Effect.Effect<BalancingParameters, ParametersError> =>
  Effect.gen(function* () {
    const refuse = (detail: string) => new ParametersError({ network, detail })
    const response = yield* Effect.tryPromise({
      try: () => fetch(`/parameters/${network}`, { headers: { accept: "application/json" } }),
      catch: (cause) => refuse(`unreachable: ${String(cause)}`)
    })
    if (!response.ok) return yield* refuse(`answered ${response.status}`)
    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => refuse("not JSON")
    })
    const figures = yield* decodeBody(body).pipe(Effect.mapError((error) => refuse(error.message)))
    return { ...figures, slots: slotsFor[network] }
  })

/** Figures handed in win, as `fullProtocolParameters` does over the provider in evolution-sdk. */
export const resolveParameters = (
  network: Network,
  given?: BalancingParameters
): Effect.Effect<BalancingParameters, ParametersError> =>
  given === undefined ? fetchParameters(network) : Effect.succeed(given)
