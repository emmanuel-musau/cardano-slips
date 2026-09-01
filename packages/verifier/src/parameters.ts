/**
 * The protocol parameters the engine is handed rather than fetches. The
 * minimum-fee coefficients and the per-byte cost that fixes an output's minimum
 * ADA arrive with the tickets that need them.
 */

/**
 * Slots to wall-clock time. A chain's slot length changes at a hard fork, so
 * the mapping is anchored at the first slot of the era in force rather than at
 * slot zero: mainnet's Shelley era starts at slot 4492800, and Byron's twenty-
 * second slots before it would put every conversion two hours out.
 */
export type SlotMapping = {
  readonly slot: bigint
  /** Unix milliseconds at that slot. */
  readonly time: bigint
  /** Milliseconds a slot lasts. */
  readonly slotLength: bigint
}

export type ProtocolParameters = {
  /** `keyDeposit`: what registering a stake credential locks up. */
  readonly stakeDeposit: bigint
  /** `poolDeposit`: what registering a stake pool locks up. */
  readonly poolDeposit: bigint
  /** `dRepDeposit`. */
  readonly drepDeposit: bigint
  /** `govActionDeposit`: what submitting a governance proposal locks up. */
  readonly governanceActionDeposit: bigint
  readonly slots: SlotMapping
}

/** Unix milliseconds at a slot. Exact: both terms are integers and no clock is consulted. */
export const timeOfSlot = (slot: bigint, { slotLength, time, slot: zero }: SlotMapping): bigint =>
  time + (slot - zero) * slotLength
