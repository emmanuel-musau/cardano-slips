/**
 * The protocol parameters the engine is handed rather than fetches. Every
 * bound the comparison enforces is computed from these, so a caller cannot
 * reach the gate with a bound it worked out generously.
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
  /** `minFeeA`: lovelace per byte of the transaction. */
  readonly minFeeCoefficient: bigint
  /** `minFeeB`: lovelace every transaction pays whatever its size. */
  readonly minFeeConstant: bigint
  /** `coinsPerUTxOByte`: what an output's own bytes cost it in locked ADA. */
  readonly coinsPerUtxoByte: bigint
  readonly slots: SlotMapping
}

/** Unix milliseconds at a slot. Exact: both terms are integers and no clock is consulted. */
export const timeOfSlot = (slot: bigint, { slotLength, time, slot: zero }: SlotMapping): bigint =>
  time + (slot - zero) * slotLength
