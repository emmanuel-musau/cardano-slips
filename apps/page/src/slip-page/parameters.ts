/**
 * The protocol parameters each network was on when this page was built, from
 * Koios `epoch_params` and `genesis`. Shipped rather than fetched, so no third
 * party sits between a person and a signature. A stale figure fails safe: the
 * node refuses a fee or an output that has fallen short, and the verifier
 * blocks a deposit that no longer matches.
 */
import type { Network } from "@cardano-slips/core"
import type { BalancingParameters } from "@cardano-slips/flow"

const shared = {
  stakeDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

export const parametersFor: Readonly<Record<Network, BalancingParameters>> = {
  // Epoch 658. Shelley began at slot 4492800, 2020-07-29T21:44:51Z.
  mainnet: {
    ...shared,
    governanceActionDeposit: 100_000_000_000n,
    slots: { slot: 4_492_800n, time: 1_596_059_091_000n, slotLength: 1_000n }
  },
  // Epoch 316. Four Byron epochs of 20-second slots, so Shelley began at slot 86400, 2022-06-21.
  preprod: {
    ...shared,
    governanceActionDeposit: 1_000_000_000n,
    slots: { slot: 86_400n, time: 1_655_769_600_000n, slotLength: 1_000n }
  },
  // Epoch 1434. No Byron era: slot 0 is the system start, 2022-10-25.
  preview: {
    ...shared,
    governanceActionDeposit: 1_000_000_000n,
    slots: { slot: 0n, time: 1_666_656_000_000n, slotLength: 1_000n }
  }
}
