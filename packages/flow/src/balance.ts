/**
 * The privacy-preserving heart of Mode A: the endpoint's half-transaction
 * becomes a whole one here, against unspent outputs it never sees (ADR-0002).
 *
 * Every term arrives as an argument — unspent outputs, protocol parameters, the
 * reward balance, the clock — for the same reason the verifier takes its five:
 * a balancer that fetched them could be made slow, made to fail, or made to
 * answer wrongly by whoever answered.
 */
import { addressIsOnNetwork, type Certificate, type Intent, type Network, type Output } from "@cardano-slips/core"
import type { ProtocolParameters } from "@cardano-slips/verifier"
import {
  Address,
  Assets,
  DRep,
  mainnet,
  PoolKeyHash,
  preprod,
  preview,
  Schema,
  type SlotConfig,
  Transaction,
  type UTxO
} from "@evolution-sdk/evolution"
import {
  makeTxBuilder,
  type ProtocolParameters as BuilderParameters,
  type ReadOnlyTransactionBuilder
} from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import { Effect } from "effect"

import { type BalanceError, refuse } from "./balance-error.js"
import type { CborHex } from "./cip30.js"

/**
 * The verifier's parameters plus the one bound the builder needs and the gate
 * does not. One vocabulary across both halves: the figures that balance a
 * transaction are the figures it will be judged against.
 */
export type BalancingParameters = ProtocolParameters & {
  /** `maxTxSize`: the byte ceiling a built transaction must fit under. */
  readonly maxTxSize: number
}

export type BalanceInputs = {
  readonly intent: Intent
  /** The Slip's network. Every address in the intent is held to it. */
  readonly network: Network
  /** Bech32, from the connected wallet. Change returns here. */
  readonly changeAddress: string
  readonly utxos: ReadonlyArray<UTxO.UTxO>
  readonly parameters: BalancingParameters
  /**
   * The whole balance of the wallet's own reward account, required when the
   * intent withdraws rewards. The ledger accepts one figure and only one, and
   * no CIP-30 method answers it.
   */
  readonly rewardBalance?: bigint
  /** Unix milliseconds. Handed in, so an expiry is decided by one clock and not two. */
  readonly now: number
}

export type BalancedTransaction = {
  /** The complete unsigned transaction: what `verifier` decodes and the wallet signs. */
  readonly cbor: CborHex
  readonly fee: bigint
  /** The slot the body expires at, for the rebuild path to watch. */
  readonly ttl: bigint
}

const chains = { mainnet, preprod, preview }

/**
 * The slot mapping comes from the parameters rather than from the chain preset:
 * the client converts `validUntil` to a slot and the gate converts that slot
 * back to a time, and two mappings would put an honest transaction outside its
 * own declared window.
 */
const slotConfigOf = ({ slots }: BalancingParameters): SlotConfig.SlotConfig => ({
  zeroTime: slots.time,
  zeroSlot: slots.slot,
  slotLength: Number(slots.slotLength)
})

const builderParameters = (parameters: BalancingParameters): BuilderParameters => ({
  minFeeCoefficient: parameters.minFeeCoefficient,
  minFeeConstant: parameters.minFeeConstant,
  coinsPerUtxoByte: parameters.coinsPerUtxoByte,
  maxTxSize: parameters.maxTxSize
})

/**
 * What the builder reads for a certificate's deposit. The script fields are
 * zeroed rather than guessed: version 1 builds no transaction that spends from
 * a script, so a cost model here would be a figure nothing computes from.
 */
const depositParameters = (parameters: BalancingParameters) => ({
  minFeeA: Number(parameters.minFeeCoefficient),
  minFeeB: Number(parameters.minFeeConstant),
  maxTxSize: parameters.maxTxSize,
  maxValSize: 0,
  keyDeposit: parameters.stakeDeposit,
  poolDeposit: parameters.poolDeposit,
  drepDeposit: parameters.drepDeposit,
  govActionDeposit: parameters.governanceActionDeposit,
  priceMem: 0,
  priceStep: 0,
  maxTxExMem: 0n,
  maxTxExSteps: 0n,
  coinsPerUtxoByte: parameters.coinsPerUtxoByte,
  collateralPercentage: 0,
  maxCollateralInputs: 0,
  minFeeRefScriptCostPerByte: 0,
  costModels: { PlutusV1: {}, PlutusV2: {}, PlutusV3: {} }
})

const assetsOf = (output: Output): Assets.Assets =>
  (output.assets ?? []).reduce(
    (assets, asset) => Assets.addByHex(assets, asset.policyId, asset.assetName, BigInt(asset.quantity)),
    Assets.fromLovelace(BigInt(output.lovelace))
  )

/**
 * `Schema.decodeSync(FromBech32)` and not `DRep.fromBech32`: the SDK's
 * declarations carry that function and the shipped module does not export it,
 * so calling it compiles and throws. The seventh gap of ADR-0004.
 */
const drepFromBech32 = Schema.decodeSync(DRep.FromBech32)

const drepOf = (declared: Certificate & { readonly type: "voteDelegation" }): DRep.DRep => {
  if (declared.drep === "abstain") return DRep.alwaysAbstain()
  if (declared.drep === "noConfidence") return DRep.alwaysNoConfidence()
  return drepFromBech32(declared.drep)
}

/**
 * The Conway forms throughout. The legacy pair encodes no deposit and no
 * refund, and evolution-sdk's builder therefore leaves both out of the balance —
 * a transaction the ledger rejects, because consumed and produced no longer
 * agree. The stated deposit is the protocol parameter exactly, which is what
 * the ledger charges and what the gate holds it to (ADR-0013).
 */
const applyCertificate = (
  builder: ReadOnlyTransactionBuilder,
  declared: Certificate,
  stakeCredential: StakeCredential
): ReadOnlyTransactionBuilder => {
  switch (declared.type) {
    case "stakeRegistration":
      return builder.registerStake({ stakeCredential })
    case "stakeDeregistration":
      return builder.deregisterStake({ stakeCredential })
    case "stakeDelegation":
      return builder.delegateToPool({ stakeCredential, poolKeyHash: PoolKeyHash.fromBech32(declared.poolId) })
    case "voteDelegation":
      return builder.delegateToDRep({ stakeCredential, drep: drepOf(declared) })
  }
}

/** The staking half of a base address — what every certificate and withdrawal here acts on. */
type StakeCredential = NonNullable<Address.Address["stakingCredential"]>

/**
 * What the transaction does to the wallet's own stake credential, gathered
 * once so the credential is proved present before the builder runs rather than
 * asserted inside it.
 */
type StakeActions = {
  readonly credential: StakeCredential
  readonly certificates: ReadonlyArray<Certificate>
  /** The whole reward balance, or `null` where the intent withdraws nothing. */
  readonly withdrawal: bigint | null
}

const actsOnStake = (intent: Intent): boolean =>
  (intent.certificates ?? []).length > 0 || intent.withdrawRewards === true

/** The two sites evolution-sdk reports a shortfall from, neither of which carries a structured cause. */
const isShortfall = (message: string): boolean =>
  message.startsWith("Coin selection failed") || message.includes("Insufficient funds to cover")

const readFailure = (cause: unknown): BalanceError => {
  const message = cause instanceof Error ? cause.message : String(cause)
  return isShortfall(message)
    ? refuse("InsufficientFunds", "This wallet does not hold enough to cover the transaction and its fee.", cause)
    : refuse("CannotBalance", `This intent could not be built into a transaction: ${message}`, cause)
}

/**
 * Builds the transaction, or says why not. Nothing here asks the network
 * anything, and nothing describing what the wallet holds leaves this function.
 */
export const balanceIntent = (inputs: BalanceInputs): Effect.Effect<BalancedTransaction, BalanceError> =>
  Effect.gen(function* () {
    const { changeAddress, intent, network, parameters, utxos } = inputs

    const validUntil = Date.parse(intent.validUntil)
    if (validUntil <= inputs.now) {
      return yield* Effect.fail(refuse("IntentExpired", "This request expired while it was open. Ask for a fresh one."))
    }

    for (const output of intent.outputs ?? []) {
      if (!addressIsOnNetwork(output.address, network)) {
        return yield* Effect.fail(
          refuse("ForeignAddress", `This Slip is on ${network} and it asks to pay an address on another network.`)
        )
      }
    }

    // Inside the error channel, not thrown past it: the signature promises a
    // `BalanceError` and a defect here would reach a person as a stack trace.
    const change = yield* Effect.try({
      try: () => Address.fromBech32(changeAddress),
      catch: (cause) =>
        refuse("UnreadableChangeAddress", "This wallet's change address could not be read as an address.", cause)
    })
    const credential = change.stakingCredential
    if (actsOnStake(intent) && credential === undefined) {
      return yield* Effect.fail(
        refuse("NoStakeCredential", "This action acts on a stake credential and this wallet's address carries none.")
      )
    }

    if (intent.withdrawRewards === true && inputs.rewardBalance === undefined) {
      return yield* Effect.fail(
        refuse("RewardBalanceUnknown", "The reward balance to withdraw is not known, so this cannot be built.")
      )
    }

    const stake: StakeActions | null =
      credential === undefined
        ? null
        : {
            credential,
            certificates: intent.certificates ?? [],
            withdrawal: intent.withdrawRewards === true ? (inputs.rewardBalance ?? 0n) : null
          }

    const built = yield* Effect.tryPromise({
      try: async () => {
        let builder: ReadOnlyTransactionBuilder = makeTxBuilder({ chain: chains[network] })

        for (const output of intent.outputs ?? []) {
          // Declared lovelace is a floor: `autoMinUtxo` raises an output that
          // cannot pay for its own bytes, and the difference is shown to the
          // person as the client's own adjustment rather than folded in.
          builder = builder.payToAddress({ address: Address.fromBech32(output.address), assets: assetsOf(output) })
        }

        if (stake !== null) {
          for (const declared of stake.certificates) builder = applyCertificate(builder, declared, stake.credential)
          if (stake.withdrawal !== null) {
            builder = builder.withdraw({ stakeCredential: stake.credential, amount: stake.withdrawal })
          }
        }

        // Never after `validUntil`, which is the whole of what the spec fixes here.
        builder = builder.setValidity({ to: BigInt(validUntil) })

        return await builder.build({
          changeAddress: change,
          availableUtxos: utxos,
          protocolParameters: builderParameters(parameters),
          fullProtocolParameters: depositParameters(parameters),
          slotConfig: slotConfigOf(parameters),
          autoMinUtxo: true,
          // Leftover too small to become change would otherwise be paid as fee —
          // lovelace leaving the wallet that nothing on screen accounted for.
          onInsufficientChange: "error"
        })
      },
      catch: readFailure
    })

    const transaction = yield* Effect.tryPromise({ try: () => built.toTransaction(), catch: readFailure })

    const ttl = transaction.body.ttl
    if (ttl === undefined) {
      // We asked for an interval; a body without one could be submitted after
      // `validUntil`, which is the one thing the spec forbids outright here.
      return yield* Effect.fail(refuse("CannotBalance", "The built transaction carries no expiry, and it must."))
    }

    return { cbor: Transaction.toCBORHex(transaction), fee: transaction.body.fee, ttl }
  })
