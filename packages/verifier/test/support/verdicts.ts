/**
 * The CIP's published table of verdicts, dressed as the arguments `compare`
 * takes. The table writes the derived side the way a person reads it —
 * addresses in bech32, ownership already decided — so this turns each case
 * into the real types without deciding anything the comparison is meant to
 * decide.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Either } from "effect"

import type { Intent } from "@cardano-slips/core"

import { decodeBech32 } from "../../src/bech32.js"
import type { Comparison } from "../../src/compare.js"
import type { DRep, MultiAsset } from "../../src/decode.js"
import { readInstant } from "../../src/declared.js"
import type { CertificateEffect, Effects, SlotTime, UnsupportedMember } from "../../src/derive.js"
import type { ProtocolParameters } from "../../src/parameters.js"
import { fromHex } from "./bytes.js"
import { mainnetParameters } from "./derivation.js"

type Asset = { readonly policyId: string; readonly assetName: string; readonly quantity: string }
type Output = { readonly address: string; readonly lovelace: string; readonly assets?: Array<Asset> }

export type Case = {
  readonly name: string
  readonly now: string
  readonly changeAddress: string
  readonly declared: Intent
  readonly parameters: {
    readonly minFee: string
    readonly minChangeLovelace: string
    readonly minLovelace: Array<string>
  }
  readonly derived: {
    readonly outputs: Array<Output & { readonly mine: boolean }>
    readonly fee: string
    readonly certificates: Array<{
      readonly type: string
      readonly poolId?: string
      readonly drep?: string
      readonly mine: boolean
    }>
    readonly withdrawals: Array<{ readonly mine: boolean; readonly lovelace: string }>
    readonly mint: Array<Asset>
    readonly unsupported: Array<string>
    readonly validFrom: string | null
    readonly validUntil: string | null
  }
  readonly verdict: "sign" | "block"
  readonly reasons: Array<string>
}

const tablePath = join(import.meta.dirname, "..", "..", "..", "..", "spec", "examples", "effects", "verdicts.json")

export const cases: ReadonlyArray<Case> = (JSON.parse(readFileSync(tablePath, "utf8")) as { cases: Array<Case> }).cases

const bytesOf = (text: string): Uint8Array => {
  const decoded = decodeBech32(text)
  if (Either.isLeft(decoded)) throw new Error(`${text} is not bech32: ${decoded.left.detail}`)
  return decoded.right.bytes
}

const instant = (text: string): bigint => {
  const read = readInstant(text)
  if (Either.isLeft(read)) throw new Error(`${text} is not an instant: ${read.left.detail}`)
  return read.right
}

/**
 * The table states a minimum where the engine computes one from an output's
 * encoded size, so the case's figure is turned back into the size that
 * produces it. A figure the parameters cannot produce would be a case testing
 * arithmetic nothing runs, so it throws rather than rounding.
 */
const sizeForMinimum = (minimum: bigint, { coinsPerUtxoByte }: ProtocolParameters): number => {
  if (minimum % coinsPerUtxoByte !== 0n) throw new Error(`${minimum} is not a multiple of ${coinsPerUtxoByte}`)
  return Number(minimum / coinsPerUtxoByte - 160n)
}

const sizeForFee = (fee: bigint, { minFeeCoefficient, minFeeConstant }: ProtocolParameters): number => {
  if ((fee - minFeeConstant) % minFeeCoefficient !== 0n) throw new Error(`${fee} is not a fee any size produces`)
  return Number((fee - minFeeConstant) / minFeeCoefficient)
}

const assets = (of: ReadonlyArray<Asset>): MultiAsset => {
  const byPolicy = new Map<string, Array<{ name: Uint8Array; quantity: bigint }>>()
  for (const asset of of) {
    byPolicy.set(asset.policyId, [
      ...(byPolicy.get(asset.policyId) ?? []),
      { name: fromHex(asset.assetName), quantity: BigInt(asset.quantity) }
    ])
  }
  return [...byPolicy].map(([policyId, held]) => ({ policyId: fromHex(policyId), assets: held }))
}

const certificateKinds: Readonly<Record<string, CertificateEffect["kind"]>> = {
  stakeRegistration: "StakeRegistration",
  stakeDeregistration: "StakeDeregistration",
  stakeDelegation: "StakeDelegation",
  voteDelegation: "VoteDelegation"
}

/** CIP-129 writes a header byte before the credential; 0x23 is a script and anything else a key. */
const drepOf = (text: string): DRep => {
  if (text === "abstain") return { _tag: "Abstain" }
  if (text === "noConfidence") return { _tag: "NoConfidence" }
  const bytes = bytesOf(text)
  const hash = bytes.length === 29 ? bytes.subarray(1) : bytes
  return bytes.length === 29 && bytes[0] === 0x23 ? { _tag: "ScriptHash", hash } : { _tag: "KeyHash", hash }
}

const unsupportedMembers: Readonly<Record<string, UnsupportedMember>> = {
  referenceInputs: "reference-input",
  collateral: "collateral",
  requiredSigners: "required-signer",
  votingProcedures: "vote",
  proposalProcedures: "proposal",
  donation: "donation",
  scripts: "script",
  datums: "datum"
}

/** A reward account nobody else in the case uses, so two withdrawals stay two. */
const rewardAccount = (index: number): Uint8Array =>
  Uint8Array.from([0xe1, ...Array.from({ length: 28 }, (_, byte) => (byte + index * 7 + 1) % 251)])

const slotTime = (text: string | null, parameters: ProtocolParameters): SlotTime | null => {
  if (text === null) return null
  const time = instant(text)
  const { slotLength, slot, time: anchor } = parameters.slots
  return { slot: slot + (time - anchor) / slotLength, time }
}

const effectsOf = (entry: Case, parameters: ProtocolParameters): Effects => {
  const declared = entry.declared.outputs ?? []
  // Which declared output a body output answers to: the k-th output at an
  // address answers to the k-th declared output at that address, which is the
  // pairing the comparison itself makes.
  const seen = new Map<string, number>()

  return {
    size: sizeForFee(BigInt(entry.parameters.minFee), parameters),
    outputs: entry.derived.outputs.map((output, index) => {
      const position = seen.get(output.address) ?? 0
      seen.set(output.address, position + 1)
      const at = declared.map((one, where) => ({ one, where })).filter(({ one }) => one.address === output.address)[
        position
      ]
      const minimum = at === undefined ? undefined : entry.parameters.minLovelace[at.where]
      return {
        index,
        address: bytesOf(output.address),
        value: { coin: BigInt(output.lovelace), assets: assets(output.assets ?? []) },
        mine: output.mine,
        size: minimum === undefined ? 65 : sizeForMinimum(BigInt(minimum), parameters)
      }
    }),
    fee: BigInt(entry.derived.fee),
    certificates: entry.derived.certificates.map((certificate, index) => ({
      kind: certificateKinds[certificate.type] ?? "StakeRegistration",
      credential: { _tag: "KeyHash", hash: rewardAccount(index).subarray(1) },
      role: "stake",
      ours: certificate.mine,
      pool: certificate.poolId === undefined ? null : bytesOf(certificate.poolId),
      drep: certificate.drep === undefined ? null : drepOf(certificate.drep),
      deposit: null,
      refund: null,
      index
    })),
    withdrawals: entry.derived.withdrawals.map((withdrawal, index) => ({
      rewardAccount: rewardAccount(index),
      amount: BigInt(withdrawal.lovelace),
      ours: withdrawal.mine
    })),
    mint: entry.derived.mint.map((asset) => ({
      policyId: fromHex(asset.policyId),
      name: fromHex(asset.assetName),
      quantity: BigInt(asset.quantity)
    })),
    unsupported: entry.derived.unsupported.map((member) => {
      const known = unsupportedMembers[member]
      if (known === undefined)
        throw new Error(`the table names an unsupported member this engine has no tag for: ${member}`)
      return known
    }),
    validity: {
      validFrom: slotTime(entry.derived.validFrom, parameters),
      validUntil: slotTime(entry.derived.validUntil, parameters)
    }
  }
}

export const comparisonOf = (entry: Case, parameters: ProtocolParameters = mainnetParameters): Comparison => ({
  effects: effectsOf(entry, parameters),
  declared: entry.declared,
  changeAddress: entry.changeAddress,
  now: instant(entry.now),
  protocolParameters: parameters
})
