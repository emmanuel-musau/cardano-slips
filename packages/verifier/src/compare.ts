/**
 * Derived effects against the partial intent the endpoint returned. This is the
 * function that blocks a signature, and the rules it runs are normative — see
 * "The comparison" in the CIP, whose published table of verdicts
 * `test/verdicts.test.ts` runs against this code.
 *
 * The endpoint's words take no part in it. A title, a description and a message
 * are what a publisher chose to say; what a transaction is held to is what the
 * intent declared.
 */
import type { Certificate as DeclaredCertificate, Intent, Output as DeclaredOutput } from "@cardano-slips/core"
import { Either } from "effect"

import { encodeBech32 } from "./bech32.js"
import { toHex } from "./bytes.js"
import type { ComparisonError } from "./compare-error.js"
import { cannotCompare } from "./compare-error.js"
import type { DRep, Value } from "./decode.js"
import { readAddress, readDRep, readInstant, readPool } from "./declared.js"
import type { CertificateEffect, Effects, OutputEffect, UnsupportedMember } from "./derive.js"
import { minimumChangeLovelace, minimumFee, minimumLovelace } from "./minimums.js"
import type { ProtocolParameters } from "./parameters.js"

export type Comparison = {
  readonly effects: Effects
  readonly declared: Intent
  /** The address the client returns change to, as the build request sent it. */
  readonly changeAddress: string
  /**
   * Unix milliseconds. An argument because a gate that reads the clock is a
   * gate whose answer depends on when it was asked.
   */
  readonly now: bigint
  readonly protocolParameters: ProtocolParameters
}

export type Reason =
  | { readonly code: "output.missing"; readonly address: string; readonly declared: number; readonly paid: number }
  | { readonly code: "output.undeclared"; readonly address: string; readonly declared: number; readonly paid: number }
  | { readonly code: "output.lovelace"; readonly address: string; readonly declared: bigint; readonly paid: bigint }
  | {
      readonly code: "output.assets"
      readonly address: string
      readonly policyId: string
      readonly assetName: string
      readonly declared: bigint
      readonly paid: bigint
    }
  | { readonly code: "certificate.missing"; readonly declared: number; readonly carried: number }
  | { readonly code: "certificate.undeclared"; readonly declared: number; readonly carried: number }
  | { readonly code: "certificate.order" }
  | { readonly code: "certificate.target"; readonly index: number; readonly declared: string; readonly carried: string }
  | { readonly code: "certificate.credential"; readonly index: number }
  | { readonly code: "withdrawal.missing" }
  | { readonly code: "withdrawal.undeclared"; readonly carried: number }
  | { readonly code: "withdrawal.account"; readonly account: string }
  | {
      readonly code: "mint.undeclared"
      readonly assets: ReadonlyArray<{
        readonly policyId: string
        readonly assetName: string
        readonly quantity: bigint
      }>
    }
  | { readonly code: "body.unsupported"; readonly members: ReadonlyArray<UnsupportedMember> }
  | { readonly code: "fee.excessive"; readonly fee: bigint; readonly ceiling: bigint }
  | { readonly code: "interval.beyond-declared"; readonly validUntil: bigint | null; readonly declared: bigint }
  | { readonly code: "interval.not-yet-valid"; readonly validFrom: bigint; readonly now: bigint }

/** The vocabulary a client renders a block from. Every one of them is in the CIP's own table. */
export type ReasonCode = Reason["code"]

export type Verdict =
  { readonly _tag: "match" } | { readonly _tag: "mismatch"; readonly reasons: ReadonlyArray<Reason> }

const max = (left: bigint, right: bigint): bigint => (left > right ? left : right)

/**
 * A body address written the way the person would see it. A Byron address is
 * base58 and comes out of here in a form nobody would recognise — the intent
 * cannot declare one, so such an output is blocked either way, but the string
 * in the reason is not its real spelling.
 */
const addressText = (bytes: Uint8Array): string => {
  const header = bytes[0] ?? 0
  const mainnet = (header & 0x0f) === 1
  const reward = header >>> 4 >= 14
  return encodeBech32(reward ? (mainnet ? "stake" : "stake_test") : mainnet ? "addr" : "addr_test", bytes)
}

const assetKey = (policyId: string, assetName: string): string => `${policyId}.${assetName}`

const totalled = (entries: Iterable<readonly [string, bigint]>): Map<string, bigint> => {
  const totals = new Map<string, bigint>()
  for (const [key, quantity] of entries) totals.set(key, (totals.get(key) ?? 0n) + quantity)
  return totals
}

const bodyAssets = (value: Value): Array<readonly [string, bigint]> =>
  value.assets.flatMap((policy) =>
    policy.assets.map((asset) => [assetKey(toHex(policy.policyId), toHex(asset.name)), asset.quantity] as const)
  )

const declaredAssets = (output: DeclaredOutput): Array<readonly [string, bigint]> =>
  (output.assets ?? []).map((asset) => [assetKey(asset.policyId, asset.assetName), BigInt(asset.quantity)] as const)

/**
 * The outputs. Matched by address, because an address is what a person
 * recognises and what decides who ends up holding the value.
 */
const compareOutputs = (
  declared: ReadonlyArray<DeclaredOutput>,
  paid: ReadonlyArray<OutputEffect>,
  parameters: ProtocolParameters
): Either.Either<ReadonlyArray<Reason>, ComparisonError> => {
  const asked: Array<{ readonly address: string; readonly output: DeclaredOutput }> = []
  for (const output of declared) {
    const address = readAddress(output.address)
    if (Either.isLeft(address)) return Either.left(address.left)
    asked.push({ address: address.right.text, output })
  }

  const byAddress = new Map<string, Array<OutputEffect>>()
  for (const output of paid) {
    const address = addressText(output.address)
    byAddress.set(address, [...(byAddress.get(address) ?? []), output])
  }

  const reasons: Array<Reason> = []
  for (const address of [...new Set(asked.map((one) => one.address))]) {
    const wanted = asked.filter((one) => one.address === address).map((one) => one.output)
    const here = byAddress.get(address) ?? []

    if (here.length !== wanted.length) {
      // Where the counts differ the totals at that address are not compared:
      // one difference explains the other, and two reports of the same fact
      // tell a person less than one.
      reasons.push({
        code: here.length < wanted.length ? "output.missing" : "output.undeclared",
        address,
        declared: wanted.length,
        paid: here.length
      })
      continue
    }

    // Each declared output has exactly one permitted amount: the one declared,
    // or the ledger's minimum for the output as encoded where that is higher.
    // The raise has a computed value, so it never widens what is accepted.
    const permitted = wanted.reduce(
      (sum, output, index) => sum + max(BigInt(output.lovelace), minimumLovelace(here[index].size, parameters)),
      0n
    )
    const total = here.reduce((sum, output) => sum + output.value.coin, 0n)
    if (total !== permitted) reasons.push({ code: "output.lovelace", address, declared: permitted, paid: total })

    const declaredTotals = totalled(wanted.flatMap(declaredAssets))
    const paidTotals = totalled(here.flatMap((output) => bodyAssets(output.value)))
    for (const key of [...new Set([...declaredTotals.keys(), ...paidTotals.keys()])].sort()) {
      const [policyId, assetName] = key.split(".")
      const declaredQuantity = declaredTotals.get(key) ?? 0n
      const paidQuantity = paidTotals.get(key) ?? 0n
      if (declaredQuantity !== paidQuantity) {
        reasons.push({
          code: "output.assets",
          address,
          policyId,
          assetName,
          declared: declaredQuantity,
          paid: paidQuantity
        })
      }
    }
  }

  // Every output paying an address the intent does not declare must pay an
  // address the wallet controls, and is change. This is the rule that closes
  // the whole class: a payment to a stranger that no declaration accounts for
  // cannot be built into a transaction this gate passes.
  for (const [address, here] of byAddress) {
    if (asked.some((one) => one.address === address)) continue
    const strangers = here.filter((output) => !output.mine)
    if (strangers.length > 0) {
      reasons.push({ code: "output.undeclared", address, declared: 0, paid: strangers.length })
    }
  }

  return Either.right(reasons)
}

/** What a declared certificate asks for: its type, and what it names. */
const declaredCertificate = (
  certificate: DeclaredCertificate
): Either.Either<{ readonly type: string; readonly target: string }, ComparisonError> => {
  if (certificate.type === "stakeDelegation") {
    const pool = readPool(certificate.poolId)
    return Either.isLeft(pool) ? Either.left(pool.left) : Either.right({ type: certificate.type, target: pool.right })
  }
  if (certificate.type === "voteDelegation") {
    const drep = readDRep(certificate.drep)
    return Either.isLeft(drep) ? Either.left(drep.left) : Either.right({ type: certificate.type, target: drep.right })
  }
  return Either.right({ type: certificate.type, target: "" })
}

/**
 * The declared type a body certificate answers to. A stake registration has a
 * legacy and a Conway encoding and both register the same credential, so both
 * answer to `stakeRegistration`; anything else keeps its own name and therefore
 * matches no declaration this version can make.
 */
const carriedType = (kind: CertificateEffect["kind"]): string => {
  if (kind === "StakeRegistration" || kind === "Registration") return "stakeRegistration"
  if (kind === "StakeDeregistration" || kind === "Deregistration") return "stakeDeregistration"
  if (kind === "StakeDelegation") return "stakeDelegation"
  if (kind === "VoteDelegation") return "voteDelegation"
  return kind
}

const drepToken = (drep: DRep): string => {
  if (drep._tag === "Abstain") return "abstain"
  if (drep._tag === "NoConfidence") return "noConfidence"
  return `${drep._tag === "KeyHash" ? "key" : "script"}.${toHex(drep.hash)}`
}

const carriedCertificate = (effect: CertificateEffect): { readonly type: string; readonly target: string } => ({
  type: carriedType(effect.kind),
  target: effect.pool !== null ? encodeBech32("pool", effect.pool) : effect.drep !== null ? drepToken(effect.drep) : ""
})

/**
 * The certificates. Order is part of it because the ledger applies them in
 * order: a registration that follows the delegation depending on it is a
 * different transaction from one that precedes it, and only one of the two
 * does what the person was shown.
 */
const compareCertificates = (
  declared: ReadonlyArray<DeclaredCertificate>,
  carried: ReadonlyArray<CertificateEffect>
): Either.Either<ReadonlyArray<Reason>, ComparisonError> => {
  const asked: Array<{ readonly type: string; readonly target: string }> = []
  for (const certificate of declared) {
    const read = declaredCertificate(certificate)
    if (Either.isLeft(read)) return Either.left(read.left)
    asked.push(read.right)
  }
  const here = carried.map(carriedCertificate)
  const whole = (one: { readonly type: string; readonly target: string }): string => `${one.type}/${one.target}`

  // The first of these that applies, so what a client reports is what happened
  // rather than every rule the difference violated.
  const reasons: Array<Reason> = []
  if (here.length !== asked.length) {
    reasons.push({
      code: here.length < asked.length ? "certificate.missing" : "certificate.undeclared",
      declared: asked.length,
      carried: here.length
    })
  } else if (asked.every((one, index) => one.type === here[index].type)) {
    for (const [index, one] of asked.entries()) {
      if (one.target !== here[index].target) {
        reasons.push({ code: "certificate.target", index, declared: one.target, carried: here[index].target })
      }
    }
  } else if (asked.map(whole).sort().join() === here.map(whole).sort().join()) {
    reasons.push({ code: "certificate.order" })
  } else {
    reasons.push({ code: "certificate.missing", declared: asked.length, carried: here.length })
    reasons.push({ code: "certificate.undeclared", declared: asked.length, carried: here.length })
  }

  // No field in this version names a credential, so a certificate acting on
  // someone else's is not a claim that failed to match — it is an effect
  // nothing could have declared.
  for (const effect of carried) if (!effect.ours) reasons.push({ code: "certificate.credential", index: effect.index })

  return Either.right(reasons)
}

/**
 * The withdrawal. The amount takes no part in it: nothing declares one and the
 * ledger admits only one value, the whole balance of the account.
 */
const compareWithdrawals = (declared: boolean, carried: Effects["withdrawals"]): ReadonlyArray<Reason> => {
  const reasons: Array<Reason> = []
  if (declared) {
    if (carried.length === 0) reasons.push({ code: "withdrawal.missing" })
    if (carried.length > 1) reasons.push({ code: "withdrawal.undeclared", carried: carried.length })
  } else if (carried.length > 0) {
    reasons.push({ code: "withdrawal.undeclared", carried: carried.length })
  }
  for (const withdrawal of carried) {
    if (!withdrawal.ours) reasons.push({ code: "withdrawal.account", account: addressText(withdrawal.rewardAccount) })
  }
  return reasons
}

/**
 * The verdict. A mismatch is this function succeeding, not failing: the left
 * side is for a declaration the comparison cannot read at all, which is an
 * endpoint sending something malformed rather than something untrue.
 */
export const compare = ({
  changeAddress,
  declared,
  effects,
  now,
  protocolParameters
}: Comparison): Either.Either<Verdict, ComparisonError> => {
  const reasons: Array<Reason> = []

  const outputs = compareOutputs(declared.outputs ?? [], effects.outputs, protocolParameters)
  if (Either.isLeft(outputs)) return Either.left(outputs.left)
  reasons.push(...outputs.right)

  const certificates = compareCertificates(declared.certificates ?? [], effects.certificates)
  if (Either.isLeft(certificates)) return Either.left(certificates.left)
  reasons.push(...certificates.right)

  reasons.push(...compareWithdrawals(declared.withdrawRewards === true, effects.withdrawals))

  // Version 1 defines no field for either, so a body carrying one is not a
  // transaction with an undeclared field — it is a transaction doing something
  // this version cannot describe to a person.
  if (effects.mint.length > 0) {
    reasons.push({
      code: "mint.undeclared",
      assets: effects.mint.map((asset) => ({
        policyId: toHex(asset.policyId),
        assetName: toHex(asset.name),
        quantity: asset.quantity
      }))
    })
  }
  if (effects.unsupported.length > 0) reasons.push({ code: "body.unsupported", members: effects.unsupported })

  // Nothing declares the fee, so there is nothing to compare it against — but
  // an unbounded fee is an undeclared payment under another name, and the
  // person pays it either way.
  const change = readAddress(changeAddress)
  if (Either.isLeft(change)) return Either.left(cannotCompare("ChangeAddress", change.left.detail))
  const ceiling =
    minimumFee(effects.size, protocolParameters) + minimumChangeLovelace(change.right.bytes, protocolParameters)
  if (effects.fee > ceiling) reasons.push({ code: "fee.excessive", fee: effects.fee, ceiling })

  // A body with no end at all is the extreme of the same rule, not an exception
  // to it: it never stops being submittable, which is later than any instant the
  // intent could have named.
  const until = readInstant(declared.validUntil)
  if (Either.isLeft(until)) return Either.left(until.left)
  const validUntil = effects.validity.validUntil
  if (validUntil === null || validUntil.time > until.right) {
    reasons.push({ code: "interval.beyond-declared", validUntil: validUntil?.time ?? null, declared: until.right })
  }
  if (effects.validity.validFrom !== null && effects.validity.validFrom.time > now) {
    reasons.push({ code: "interval.not-yet-valid", validFrom: effects.validity.validFrom.time, now })
  }

  return Either.right(reasons.length === 0 ? { _tag: "match" } : { _tag: "mismatch", reasons })
}
