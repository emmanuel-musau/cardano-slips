/**
 * The attack examples, assembled into the terms the engine takes. Each case is
 * a real transaction: the body is encoded here, decoded by the package's own
 * decoder and derived by its own derivation, so what a case proves is a block
 * on the path a real signature would take.
 */
import { Either } from "effect"

import type { Intent } from "@cardano-slips/core"

import { encodeBech32 } from "../../src/bech32.js"
import type { Comparison, Reason } from "../../src/compare.js"
import { readInstant } from "../../src/declared.js"
import { decodeTransaction } from "../../src/decode.js"
import { deriveEffects } from "../../src/derive.js"
import type { Derivation, ResolvedInput } from "../../src/derive.js"
import { fromHex, toHex } from "./bytes.js"
import * as cbor from "./cbor.js"
import { mainnetParameters } from "./derivation.js"

export type Held = {
  readonly policyId: string
  readonly assetName: string
  readonly quantity: bigint
}

/** One output the body pays. */
export type Payment = {
  readonly address: Uint8Array
  readonly lovelace: bigint
  readonly assets?: ReadonlyArray<Held>
}

/**
 * A certificate the body carries. `credential` defaults to the signer's own
 * stake key; naming another is how a certificate acts on someone else's.
 * `registration` and `deregistration` are the Conway forms, which state the
 * deposit and the refund in the certificate itself.
 */
export type Carried =
  | { readonly type: "stakeRegistration"; readonly credential?: Uint8Array }
  | { readonly type: "stakeDeregistration"; readonly credential?: Uint8Array }
  | { readonly type: "stakeDelegation"; readonly pool: Uint8Array; readonly credential?: Uint8Array }
  | { readonly type: "voteDelegation"; readonly drep: Uint8Array; readonly credential?: Uint8Array }
  | { readonly type: "registration"; readonly deposit: bigint; readonly credential?: Uint8Array }
  | { readonly type: "deregistration"; readonly refund: bigint; readonly credential?: Uint8Array }

export type Withdrawn = {
  readonly rewardAccount: Uint8Array
  readonly amount: bigint
}

/** What the endpoint declared, and what the transaction reaching the wallet does. */
export type Slip = {
  readonly declared: Intent
  /** In body order. The change returning to the signer follows them. */
  readonly paid: ReadonlyArray<Payment>
  readonly carries?: ReadonlyArray<Carried>
  readonly withdraws?: ReadonlyArray<Withdrawn>
  /** What the body creates, or destroys where the quantity is negative. */
  readonly mints?: ReadonlyArray<Held>
  /**
   * The body's own interval, as instants. `validUntil` defaults to the
   * deadline the intent declares, which is what an honest client builds to;
   * `null` leaves the key off entirely.
   */
  readonly validFrom?: string
  readonly validUntil?: string | null
}

export type Attack = Slip & {
  readonly name: string
  /** The lie this transaction tells, in the words the person reading it would use. */
  readonly lie: string
  /** Every reason the comparison must give, in the order it gives them. */
  readonly blocked: ReadonlyArray<Reason>
}

const hashOf = (byte: number): Uint8Array => Uint8Array.from(new Array<number>(28).fill(byte))

/** An enterprise address on mainnet: one header byte, then the payment key hash. */
const addressOf = (byte: number): Uint8Array => Uint8Array.from([0x61, ...hashOf(byte)])

export const bech32 = (address: Uint8Array): string => encodeBech32("addr", address)

/**
 * The signer holds a base address, so the stake credential a certificate acts
 * on and the reward account a withdrawal drains are both its own — which is
 * what tells an honest delegation from one acting on a stranger's.
 */
export const stakeKey = hashOf(0x44)
export const signer = Uint8Array.from([0x01, ...hashOf(0x11), ...stakeKey])
export const rewardAccount = Uint8Array.from([0xe1, ...stakeKey])
export const merchant = addressOf(0x22)
export const attacker = addressOf(0x33)

/** A pool, a DRep and a reward account nobody in these cases controls. */
export const pool = hashOf(0x55)
export const otherPool = hashOf(0x66)
export const drep = hashOf(0x77)
export const otherDrep = hashOf(0x88)
export const strangerStakeKey = hashOf(0x99)
export const strangerRewardAccount = Uint8Array.from([0xe1, ...strangerStakeKey])

/** Lovelace the transaction returns to the signer, so an attack never changes what change looks like. */
const CHANGE = 4_800_000n
const FEE = 200_000n

export const DEADLINE = "2026-01-01T00:00:00Z"
export const NOW = "2025-12-01T00:00:00Z"

const instant = (text: string): bigint => {
  const read = readInstant(text)
  if (Either.isLeft(read)) throw new Error(`${text} is not an instant: ${read.left.detail}`)
  return read.right
}

const slotOf = (time: bigint): bigint => {
  const { slot, slotLength, time: anchor } = mainnetParameters.slots
  return slot + (time - anchor) / slotLength
}

/** `signed` writes a burn as the negative integer the mint field carries; an output's value cannot hold one. */
const multiAsset = (held: ReadonlyArray<Held>, signed = false): string => {
  const byPolicy = new Map<string, Array<Held>>()
  for (const asset of held) byPolicy.set(asset.policyId, [...(byPolicy.get(asset.policyId) ?? []), asset])
  return cbor.map(
    ...[...byPolicy].map(
      ([policyId, assets]) =>
        [
          cbor.bytes(policyId),
          cbor.map(
            ...assets.map(
              (asset) =>
                [cbor.bytes(asset.assetName), signed ? cbor.int(asset.quantity) : cbor.uint(asset.quantity)] as const
            )
          )
        ] as const
    )
  )
}

const output = ({ address, assets, lovelace }: Payment): string =>
  cbor.array(
    cbor.bytes(toHex(address)),
    assets === undefined || assets.length === 0
      ? cbor.uint(lovelace)
      : cbor.array(cbor.uint(lovelace), multiAsset(assets))
  )

const credentialOf = (hash: Uint8Array = stakeKey): string => cbor.array(cbor.uint(0), cbor.bytes(toHex(hash)))

const certificate = (carried: Carried): string => {
  const acts = credentialOf(carried.credential)
  if (carried.type === "stakeRegistration") return cbor.array(cbor.uint(0), acts)
  if (carried.type === "stakeDeregistration") return cbor.array(cbor.uint(1), acts)
  if (carried.type === "stakeDelegation") return cbor.array(cbor.uint(2), acts, cbor.bytes(toHex(carried.pool)))
  if (carried.type === "registration") return cbor.array(cbor.uint(7), acts, cbor.uint(carried.deposit))
  if (carried.type === "deregistration") return cbor.array(cbor.uint(8), acts, cbor.uint(carried.refund))
  return cbor.array(cbor.uint(9), acts, cbor.array(cbor.uint(0), cbor.bytes(toHex(carried.drep))))
}

/**
 * What the ledger locks up and hands back for these certificates. The Conway
 * forms state their own figure and the ledger charges what they state, which is
 * what makes a misstated one a transaction that still balances.
 */
const locked = (carries: ReadonlyArray<Carried>): bigint =>
  carries.reduce((sum, carried) => {
    if (carried.type === "stakeRegistration") return sum + mainnetParameters.stakeDeposit
    if (carried.type === "stakeDeregistration") return sum - mainnetParameters.stakeDeposit
    if (carried.type === "registration") return sum + carried.deposit
    if (carried.type === "deregistration") return sum - carried.refund
    return sum
  }, 0n)

/**
 * The single UTxO the transaction spends, worth exactly what the body pays out
 * plus the fee, plus what its certificates lock up, less what they and any
 * withdrawal hand back. A case that did not balance would not be a transaction
 * anyone could submit, and an example nobody can submit proves nothing.
 */
const funding = ({ carries = [], mints = [], paid, withdraws = [] }: Slip): ResolvedInput => {
  const held = new Map<string, Held>()
  const running = (asset: Held, by: bigint): void => {
    const key = `${asset.policyId}.${asset.assetName}`
    held.set(key, { ...asset, quantity: (held.get(key)?.quantity ?? 0n) + by })
  }
  for (const payment of paid) for (const asset of payment.assets ?? []) running(asset, asset.quantity)
  // What the body mints was never held, and what it burns had to be.
  for (const asset of mints) running(asset, -asset.quantity)

  const byPolicy = new Map<string, Array<Held>>()
  for (const asset of held.values()) {
    if (asset.quantity === 0n) continue
    byPolicy.set(asset.policyId, [...(byPolicy.get(asset.policyId) ?? []), asset])
  }

  return {
    input: { transactionId: new Uint8Array(32).fill(0xf0), index: 0n },
    address: signer,
    value: {
      coin:
        paid.reduce((sum, payment) => sum + payment.lovelace, CHANGE + FEE) +
        locked(carries) -
        withdraws.reduce((sum, withdrawal) => sum + withdrawal.amount, 0n),
      assets: [...byPolicy].map(([policyId, assets]) => ({
        policyId: fromHex(policyId),
        assets: assets.map((asset) => ({ name: fromHex(asset.assetName), quantity: asset.quantity }))
      }))
    }
  }
}

/** The transaction a slip makes, as the bytes a wallet would be handed. Body keys stay in order. */
export const cborOf = ({
  carries = [],
  mints = [],
  paid,
  validFrom,
  validUntil = DEADLINE,
  withdraws = []
}: Slip): string =>
  cbor.transaction(
    cbor.map(
      [cbor.uint(0), cbor.set(cbor.array(cbor.filler(32, 0xf0), cbor.uint(0)))],
      [cbor.uint(1), cbor.array(...paid.map(output), output({ address: signer, lovelace: CHANGE }))],
      [cbor.uint(2), cbor.uint(FEE)],
      ...(validUntil === null ? [] : [[cbor.uint(3), cbor.uint(slotOf(instant(validUntil)))] as const]),
      ...(carries.length === 0 ? [] : [[cbor.uint(4), cbor.set(...carries.map(certificate))] as const]),
      ...(withdraws.length === 0
        ? []
        : [
            [
              cbor.uint(5),
              cbor.map(
                ...withdraws.map(
                  (withdrawal) => [cbor.bytes(toHex(withdrawal.rewardAccount)), cbor.uint(withdrawal.amount)] as const
                )
              )
            ] as const
          ]),
      ...(validFrom === undefined ? [] : [[cbor.uint(8), cbor.uint(slotOf(instant(validFrom)))] as const]),
      ...(mints.length === 0 ? [] : [[cbor.uint(9), multiAsset(mints, true)] as const])
    )
  )

/** The four terms the derivation takes, read out of the bytes rather than asserted alongside them. */
export const derivationOf = (slip: Slip): Derivation => {
  const decoded = decodeTransaction(fromHex(cborOf(slip)))
  if (Either.isLeft(decoded)) throw new Error(`the transaction was refused: ${decoded.left.message}`)
  return {
    transaction: decoded.right,
    userAddresses: [signer, rewardAccount],
    resolvedInputs: [funding(slip)],
    protocolParameters: mainnetParameters
  }
}

export const comparisonOf = (slip: Slip): Comparison => {
  const effects = deriveEffects(derivationOf(slip))
  if (Either.isLeft(effects)) throw new Error(`the derivation refused: ${effects.left.message}`)

  return {
    effects: effects.right,
    declared: slip.declared,
    changeAddress: bech32(signer),
    now: instant(NOW),
    protocolParameters: mainnetParameters
  }
}
