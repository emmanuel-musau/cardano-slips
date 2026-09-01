/**
 * The protocol parameters the engine is handed rather than fetches. Only the
 * deposits are here so far; the minimum-fee coefficients, the per-byte cost and
 * the slot-to-time mapping arrive with the tickets that need them.
 */

export type ProtocolParameters = {
  /** `keyDeposit`: what registering a stake credential locks up. */
  readonly stakeDeposit: bigint
  /** `poolDeposit`: what registering a stake pool locks up. */
  readonly poolDeposit: bigint
  /** `dRepDeposit`. */
  readonly drepDeposit: bigint
  /** `govActionDeposit`: what submitting a governance proposal locks up. */
  readonly governanceActionDeposit: bigint
}
