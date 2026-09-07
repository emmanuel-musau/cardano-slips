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

/** What the endpoint declared, and what the transaction reaching the wallet pays. */
export type Slip = {
  readonly declared: Intent
  /** In body order. The change returning to the signer follows them. */
  readonly paid: ReadonlyArray<Payment>
}

export type Attack = Slip & {
  readonly name: string
  /** The lie this transaction tells, in the words the person reading it would use. */
  readonly lie: string
  /** Every reason the comparison must give, in the order it gives them. */
  readonly blocked: ReadonlyArray<Reason>
}

/** An enterprise address on mainnet: one header byte, then the payment key hash. */
const addressOf = (byte: number): Uint8Array => Uint8Array.from([0x61, ...new Array<number>(28).fill(byte)])

export const bech32 = (address: Uint8Array): string => encodeBech32("addr", address)

export const signer = addressOf(0x11)
export const merchant = addressOf(0x22)
export const attacker = addressOf(0x33)

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

const multiAsset = (held: ReadonlyArray<Held>): string => {
  const byPolicy = new Map<string, Array<Held>>()
  for (const asset of held) byPolicy.set(asset.policyId, [...(byPolicy.get(asset.policyId) ?? []), asset])
  return cbor.map(
    ...[...byPolicy].map(
      ([policyId, assets]) =>
        [
          cbor.bytes(policyId),
          cbor.map(...assets.map((asset) => [cbor.bytes(asset.assetName), cbor.uint(asset.quantity)] as const))
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

/**
 * The single UTxO the transaction spends, worth exactly what the body pays out
 * plus the fee. A case that did not balance would not be a transaction anyone
 * could submit, and an example nobody can submit proves nothing.
 */
const funding = (paid: ReadonlyArray<Payment>): ResolvedInput => {
  const held = new Map<string, Held>()
  for (const payment of paid) {
    for (const asset of payment.assets ?? []) {
      const key = `${asset.policyId}.${asset.assetName}`
      const running = held.get(key)
      held.set(key, { ...asset, quantity: (running?.quantity ?? 0n) + asset.quantity })
    }
  }
  const byPolicy = new Map<string, Array<Held>>()
  for (const asset of held.values()) byPolicy.set(asset.policyId, [...(byPolicy.get(asset.policyId) ?? []), asset])

  return {
    input: { transactionId: new Uint8Array(32).fill(0xf0), index: 0n },
    address: signer,
    value: {
      coin: paid.reduce((sum, payment) => sum + payment.lovelace, CHANGE + FEE),
      assets: [...byPolicy].map(([policyId, assets]) => ({
        policyId: fromHex(policyId),
        assets: assets.map((asset) => ({ name: fromHex(asset.assetName), quantity: asset.quantity }))
      }))
    }
  }
}

/** The transaction a slip's outputs make, as the bytes a wallet would be handed. */
export const cborOf = ({ paid }: Slip): string =>
  cbor.transaction(
    cbor.map(
      [cbor.uint(0), cbor.set(cbor.array(cbor.filler(32, 0xf0), cbor.uint(0)))],
      [cbor.uint(1), cbor.array(...paid.map(output), output({ address: signer, lovelace: CHANGE }))],
      [cbor.uint(2), cbor.uint(FEE)],
      [cbor.uint(3), cbor.uint(slotOf(instant(DEADLINE)))]
    )
  )

/** The four terms the derivation takes, read out of the bytes rather than asserted alongside them. */
export const derivationOf = (slip: Slip): Derivation => {
  const decoded = decodeTransaction(fromHex(cborOf(slip)))
  if (Either.isLeft(decoded)) throw new Error(`the transaction was refused: ${decoded.left.message}`)
  return {
    transaction: decoded.right,
    userAddresses: [signer],
    resolvedInputs: [funding(slip.paid)],
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
