/**
 * What the effects panel draws, worked out without React: the headline figure,
 * one row per effect, which rows a mismatch marks, and the line that states
 * the verdict. Every figure comes from the derived effects, never the claim.
 */
import {
  addressText,
  type CertificateEffect,
  type Deposit,
  type DRep,
  encodeBech32,
  type Reason
} from "@cardano-slips/verifier"

import type { Derived } from "./derived.js"
import { assetLabel, explainReason, formatAda, formatQuantity, shortened } from "./explain.js"

/** How an amount reads: gone for good, arriving, taken by the network, held to be given back, or only claimed. */
export type Tone = "spent" | "gained" | "fee" | "held" | "stated"

export type Amount = { readonly text: string; readonly tone: Tone }

export type Group = "arriving" | "leaving" | "unmoved"

/** A row the link did not describe, or described otherwise. Only these rows take colour. */
export type Mark = "not-in-the-link" | "not-as-the-link-says"

export type Row = {
  readonly key: string
  readonly label: string
  readonly detail?: string
  readonly amounts: ReadonlyArray<Amount>
  /** A pool or DRep, where the row moves no value and the amount column carries a name instead. */
  readonly identifier?: string
  /** `refundable` where the ledger guarantees the figure, `as-stated` where only the transaction claims it. */
  readonly chip?: "refundable" | "as-stated"
  /** The line under a deposit or refund saying what brings it back, or who claims it. */
  readonly note?: string
  readonly group: Group
  readonly mark?: Mark
}

export type Headline = {
  readonly label: string
  readonly amount: string
  readonly tone: "spent" | "gained"
  /** Only beside what leaves for someone else, where the fee is the smaller figure and is said once. */
  readonly fee?: string
  /** What is locked or handed back, beside the headline and never counted in it. */
  readonly held?: { readonly label: string; readonly amount: string; readonly tone: "held" | "stated" }
}

/** What the "The transaction does" box says for one reason. */
export type Evidence = { readonly figure?: string; readonly lines: ReadonlyArray<string> }

/** Rows past this group into what arrives, what leaves and what moves nothing (sheet state h). */
const groupedFrom = 5

/** Rows past this collapse each group to its header and a count. */
const collapsedFrom = 9

const minus = "−"

const hexOf = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

const spent = (text: string): Amount => ({ text: `${minus}${text}`, tone: "spent" })
const gained = (text: string): Amount => ({ text: `+${text}`, tone: "gained" })

/** A token by its name where the name is text, and by its bytes where it is not. The quantity stays in base units. */
const tokenText = (quantity: bigint, name: Uint8Array): string => {
  const label = assetLabel(hexOf(name))
  if (label !== null) return `${formatQuantity(quantity)} ${label}`
  return name.length === 0
    ? `${formatQuantity(quantity)} of an unnamed token`
    : `${formatQuantity(quantity)} of token ${hexOf(name)}`
}

const policyLine = (policyId: Uint8Array): string => `policy ${shortenedHex(hexOf(policyId))}`

const shortenedHex = (hex: string): string => (hex.length <= 12 ? hex : `${hex.slice(0, 4)}…${hex.slice(-4)}`)

/** A DRep id per CIP-129: a header byte naming key or script, then the hash. */
const drepText = (drep: DRep): string => {
  switch (drep._tag) {
    case "Abstain":
      return "abstain"
    case "NoConfidence":
      return "no confidence"
    case "KeyHash":
      return shortened(encodeBech32("drep", Uint8Array.of(0x22, ...drep.hash)))
    case "ScriptHash":
      return shortened(encodeBech32("drep", Uint8Array.of(0x23, ...drep.hash)))
  }
}

const identifierOf = (certificate: CertificateEffect): string | undefined => {
  if (certificate.pool !== null) return shortened(encodeBech32("pool", certificate.pool))
  if (certificate.drep !== null) return drepText(certificate.drep)
  return undefined
}

const voteWords = (drep: DRep | null, whose: string): string => {
  if (drep?._tag === "Abstain") return `set ${whose} vote to always abstain`
  if (drep?._tag === "NoConfidence") return `set ${whose} vote to always no confidence`
  return `delegate ${whose} vote to a DRep`
}

/** What a certificate does, in words. "Your" only where the wallet holds the key it acts on. */
export const describeCertificate = (certificate: CertificateEffect): string => {
  const whose = certificate.ours || certificate.credential === null ? "your" : "another wallet's"
  const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`
  switch (certificate.kind) {
    case "StakeRegistration":
    case "Registration":
      return capital(`register ${whose} stake key`)
    case "StakeDeregistration":
    case "Deregistration":
      return capital(`close ${whose} stake key and stop delegating`)
    case "StakeDelegation":
      return capital(`delegate ${whose} stake to a stake pool`)
    case "VoteDelegation":
      return capital(voteWords(certificate.drep, whose))
    case "StakeVoteDelegation":
      return capital(`delegate ${whose} stake to a stake pool and ${voteWords(certificate.drep, whose)}`)
    case "StakeRegistrationDelegation":
      return capital(`register ${whose} stake key and delegate it to a stake pool`)
    case "VoteRegistrationDelegation":
      return capital(`register ${whose} stake key and ${voteWords(certificate.drep, whose)}`)
    case "StakeVoteRegistrationDelegation":
      return capital(
        `register ${whose} stake key, delegate it to a stake pool and ${voteWords(certificate.drep, whose)}`
      )
    case "PoolRegistration":
      return "Register a stake pool"
    case "PoolRetirement":
      return "Retire a stake pool"
    case "AuthorizeCommitteeHot":
      return "Authorise a hot key for the constitutional committee"
    case "ResignCommitteeCold":
      return "Resign from the constitutional committee"
    case "RegisterDrep":
      return `Register ${whose === "your" ? "yourself" : "another wallet"} as a DRep`
    case "UnregisterDrep":
      return `Retire ${whose === "your" ? "yourself" : "another wallet"} as a DRep`
    case "UpdateDrep":
      return capital(`update ${whose} DRep details`)
  }
}

/** The parameter and a stated deposit are both what the ledger takes and gives back. Only an assumed one is a claim. */
const depositChip = (deposit: Deposit): "refundable" | "as-stated" =>
  deposit.basis === "assumed" ? "as-stated" : "refundable"

const depositNote = (deposit: Deposit): string => {
  const all = formatAda(deposit.amount)
  if (depositChip(deposit) === "as-stated") {
    return deposit.kind === "pool"
      ? "Today's pool deposit. A pool that is already registered pays nothing to register again."
      : "Today's deposit, standing in for a figure the transaction does not settle."
  }
  switch (deposit.kind) {
    case "stake":
      return `Held by the network while you delegate. You get all ${all} back when you stop.`
    case "drep":
      return `Held by the network while you are a DRep. You get all ${all} back when you retire.`
    case "pool":
      return `Held by the network while the pool is registered. It comes back when the pool retires.`
    case "governance-action":
      return "Held with the proposal. It comes back once the proposal is decided."
  }
}

const refundNote = (refund: Deposit): string => {
  const what = refund.kind === "drep" ? "the DRep" : "this key"
  return refund.basis === "assumed"
    ? `The network returns what ${what} was registered under. The transaction doesn't say what that was, so this is today's deposit standing in for it.`
    : `The transaction states this figure. The network returns what ${what} was registered under, so this is the transaction's claim.`
}

const depositKey = (side: "deposit" | "refund", deposit: Deposit): string =>
  `${side}-${deposit.source}-${deposit.index}`

/** Every effect as a row, in the sheet's order: what is paid, what arrives, what moves nothing, what the network takes. */
const rowsOf = (derived: Derived): Array<Row> => {
  const { assets, effects, lovelace } = derived
  const minted = new Set(effects.mint.map((asset) => `${hexOf(asset.policyId)}.${hexOf(asset.name)}`))

  const payments = effects.outputs
    .filter((output) => !output.mine)
    .map((output): Row => ({
      key: `output-${output.index}`,
      label: "You pay",
      detail: shortened(addressText(output.address)),
      amounts: [
        ...output.value.assets.flatMap((policy) =>
          policy.assets.map((asset) => spent(tokenText(asset.quantity, asset.name)))
        ),
        ...(output.value.coin > 0n ? [spent(formatAda(output.value.coin))] : [])
      ],
      group: "leaving"
    }))

  const arrivals = assets.user
    .filter((asset) => asset.delta < 0n && !minted.has(`${hexOf(asset.policyId)}.${hexOf(asset.name)}`))
    .map((asset): Row => ({
      key: `receive-${hexOf(asset.policyId)}.${hexOf(asset.name)}`,
      label: "You receive",
      detail: policyLine(asset.policyId),
      amounts: [gained(tokenText(asset.delta, asset.name))],
      group: "arriving"
    }))

  const mint = effects.mint.map((asset, index): Row =>
    asset.quantity > 0n
      ? {
          key: `mint-${index}`,
          label: "Tokens created",
          detail: policyLine(asset.policyId),
          amounts: [gained(tokenText(asset.quantity, asset.name))],
          group: "arriving"
        }
      : {
          key: `mint-${index}`,
          label: "Tokens destroyed",
          detail: policyLine(asset.policyId),
          amounts: [spent(tokenText(asset.quantity, asset.name))],
          group: "leaving"
        }
  )

  const withdrawals = effects.withdrawals.map((withdrawal, index): Row => ({
    key: `withdrawal-${index}`,
    label: "Withdrawal",
    detail: withdrawal.ours ? "Staking rewards to date" : shortened(addressText(withdrawal.rewardAccount)),
    amounts: [gained(formatAda(withdrawal.amount))],
    group: "arriving"
  }))

  const certificates = effects.certificates.map((certificate): Row => {
    const identifier = identifierOf(certificate)
    return {
      key: `certificate-${certificate.index}`,
      label: "Certificate",
      detail: describeCertificate(certificate),
      amounts: [],
      ...(identifier === undefined ? {} : { identifier }),
      group: "unmoved"
    }
  })

  const fee: Row = {
    key: "fee",
    label: "Network fee",
    amounts: [{ text: `${minus}${formatAda(lovelace.fee)}`, tone: "fee" }],
    group: "leaving"
  }

  const deposits = lovelace.deposits.map((deposit): Row => ({
    key: depositKey("deposit", deposit),
    label: "Deposit",
    amounts: [
      { text: `${minus}${formatAda(deposit.amount)}`, tone: depositChip(deposit) === "refundable" ? "held" : "stated" }
    ],
    chip: depositChip(deposit),
    note: depositNote(deposit),
    group: "leaving"
  }))

  const refunds = lovelace.refunds.map((refund): Row => ({
    key: depositKey("refund", refund),
    label: "Refund",
    amounts: [{ text: `+${formatAda(refund.amount)}`, tone: "stated" }],
    chip: "as-stated",
    note: refundNote(refund),
    group: "arriving"
  }))

  return [...payments, ...arrivals, ...mint, ...withdrawals, ...certificates, fee, ...deposits, ...refunds]
}

/**
 * The rows each reason is about. A reason with nothing in the transaction to
 * point at — a payment left out, certificates out of order — marks no row and
 * is carried by the sentence alone.
 */
const marksOf = (derived: Derived, reasons: ReadonlyArray<Reason>): Map<string, Mark> => {
  const marks = new Map<string, Mark>()
  const mark = (key: string, how: Mark): void => {
    if (!marks.has(key)) marks.set(key, how)
  }
  const { effects } = derived
  const paidTo = (address: string) =>
    effects.outputs.filter((output) => !output.mine && addressText(output.address) === address)

  for (const reason of reasons) {
    switch (reason.code) {
      case "output.undeclared":
        // Those past the count the link asked for are the extra ones.
        for (const output of paidTo(reason.address).slice(reason.declared))
          mark(`output-${output.index}`, "not-in-the-link")
        break
      case "output.lovelace":
      case "output.assets":
        for (const output of paidTo(reason.address)) mark(`output-${output.index}`, "not-as-the-link-says")
        break
      case "certificate.undeclared":
        for (const certificate of effects.certificates.slice(reason.declared)) {
          mark(`certificate-${certificate.index}`, "not-in-the-link")
        }
        break
      case "certificate.target":
      case "certificate.credential":
        mark(`certificate-${reason.index}`, "not-as-the-link-says")
        break
      case "certificate.deposit":
        mark(`certificate-${reason.index}`, "not-as-the-link-says")
        mark(`deposit-certificate-${reason.index}`, "not-as-the-link-says")
        break
      case "withdrawal.undeclared":
        effects.withdrawals.forEach((_, index) => mark(`withdrawal-${index}`, "not-in-the-link"))
        break
      case "withdrawal.account":
        effects.withdrawals.forEach((withdrawal, index) => {
          if (addressText(withdrawal.rewardAccount) === reason.account) mark(`withdrawal-${index}`, "not-in-the-link")
        })
        break
      case "mint.undeclared":
        effects.mint.forEach((_, index) => mark(`mint-${index}`, "not-in-the-link"))
        break
      case "fee.excessive":
        mark("fee", "not-as-the-link-says")
        break
      case "output.missing":
      case "certificate.missing":
      case "certificate.order":
      case "withdrawal.missing":
      case "body.unsupported":
      case "interval.beyond-declared":
      case "interval.not-yet-valid":
        break
    }
  }
  return marks
}

/** The rows, with each mismatch marked on the row it is about. */
export const ledgerOf = (derived: Derived, reasons: ReadonlyArray<Reason> = []): ReadonlyArray<Row> => {
  const marks = marksOf(derived, reasons)
  return rowsOf(derived).map((row) => {
    const mark = marks.get(row.key)
    return mark === undefined ? row : { ...row, mark }
  })
}

export const isGrouped = (rows: ReadonlyArray<Row>): boolean => rows.length >= groupedFrom

export const isCollapsed = (rows: ReadonlyArray<Row>): boolean => rows.length >= collapsedFrom

/** The sheet's grouped order: what arrives, what leaves, what moves nothing. Empty groups are left out. */
export const groupsOf = (
  rows: ReadonlyArray<Row>
): ReadonlyArray<{ readonly group: Group; readonly rows: ReadonlyArray<Row> }> =>
  (["arriving", "leaving", "unmoved"] as const)
    .map((group) => ({ group, rows: rows.filter((row) => row.group === group) }))
    .filter(({ rows: inGroup }) => inGroup.length > 0)

const sum = (values: ReadonlyArray<bigint>): bigint => values.reduce((total, value) => total + value, 0n)

/**
 * The one large figure. What goes to someone else, where anything does;
 * otherwise what the person ends up with or spends. A deposit and a refund are
 * never counted in it — one comes back and the other is only claimed.
 */
export const headlineOf = (derived: Derived): Headline => {
  const { effects, lovelace } = derived
  const paid = effects.outputs.filter((output) => !output.mine)

  const tokens = new Map<string, { readonly name: Uint8Array; quantity: bigint }>()
  for (const output of paid) {
    for (const policy of output.value.assets) {
      for (const asset of policy.assets) {
        const key = `${hexOf(policy.policyId)}.${hexOf(asset.name)}`
        const held = tokens.get(key)
        if (held === undefined) tokens.set(key, { name: asset.name, quantity: asset.quantity })
        else held.quantity += asset.quantity
      }
    }
  }
  const coin = sum(paid.map((output) => output.value.coin))

  const deposited = sum(lovelace.deposits.map((deposit) => deposit.amount))
  const refunded = sum(lovelace.refunds.map((refund) => refund.amount))
  const withdrawn = sum(effects.withdrawals.filter((withdrawal) => withdrawal.ours).map((w) => w.amount))
  const gain = withdrawn - lovelace.fee

  const base =
    tokens.size > 0 || coin > 0n
      ? {
          label: "Leaves your wallet",
          amount: [
            ...[...tokens.values()].map((token) => tokenText(token.quantity, token.name)),
            ...(coin > 0n ? [formatAda(coin)] : [])
          ].join(" and "),
          tone: "spent" as const,
          fee: `plus ${formatAda(lovelace.fee)} in network fees`
        }
      : gain > 0n
        ? { label: "You end up with", amount: `+${formatAda(gain)}`, tone: "gained" as const }
        : { label: "You spend", amount: formatAda(-gain), tone: "spent" as const }

  if (deposited > 0n) {
    const promised = lovelace.deposits.every((deposit) => depositChip(deposit) === "refundable")
    const verb = base.tone === "gained" ? "Locked" : "You lock"
    return {
      ...base,
      held: {
        label: promised ? `${verb}, refundable` : `${verb}, as stated`,
        amount: formatAda(deposited),
        tone: promised ? "held" : "stated"
      }
    }
  }
  if (refunded > 0n) {
    return { ...base, held: { label: "Returned, as stated", amount: formatAda(refunded), tone: "stated" } }
  }
  return base
}

const spelled = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve"
]

const moves = (kind: CertificateEffect["kind"]): boolean => kind.includes("Delegation")

/** The one sentence a match gets, above the buttons. */
export const matchLine = (derived: Derived, rows: ReadonlyArray<Row>): string => {
  const { effects } = derived
  if (isGrouped(rows)) {
    return `Checked against the link. All ${spelled[rows.length] ?? String(rows.length)} effects are described by it, and the transaction does nothing else.`
  }
  const paysNobody = effects.outputs.every((output) => output.mine) && effects.withdrawals.length === 0
  if (paysNobody && effects.certificates.some((certificate) => moves(certificate.kind))) {
    return "Checked against the link. Your ADA stays in your wallet — delegation moves no funds."
  }
  return "Checked against the link. Every effect above is in the transaction, and the transaction does nothing else."
}

/** The opening of the block: what differs, then the reassurance, before any detail. */
export const blockedLine = (reasons: ReadonlyArray<Reason>): string => {
  const said = reasons.map((reason) => explainReason(reason).summary)
  const what = said.length === 0 ? "The transaction could not be matched to the link." : said.join(" ")
  return `${what} Nothing has been signed.`
}

/** For one reason: the figure the transaction carries, and where it goes or what the link asked instead. */
export const evidenceOf = (reason: Reason, derived: Derived): Evidence => {
  const { actual, declared, summary, where } = explainReason(reason)
  const marked = ledgerOf(derived, [reason])
    .filter((row) => row.mark !== undefined)
    .flatMap((row) => row.amounts.map((amount) => amount.text))
  const figure = marked.length > 0 ? marked.join(", ") : actual

  const lines = [
    ...(where === undefined ? [] : [reason.code === "withdrawal.account" ? `from ${where}` : `to ${where}`]),
    ...(declared === undefined ? [] : [`The link asks for ${declared}`])
  ]
  return figure === undefined && lines.length === 0
    ? { lines: [summary] }
    : { ...(figure === undefined ? {} : { figure }), lines }
}

/** The transaction as its outputs, fee and expiry, for the collapsed raw detail. Addresses in full. */
export const rawLines = (derived: Derived): ReadonlyArray<string> => {
  const { effects } = derived
  const valueText = (coin: bigint, assets: Derived["effects"]["outputs"][number]["value"]["assets"]): string =>
    [
      formatAda(coin),
      ...assets.flatMap((policy) =>
        policy.assets.map((asset) => `${tokenText(asset.quantity, asset.name)} (${policyLine(policy.policyId)})`)
      )
    ].join(" + ")

  const until = effects.validity.validUntil
  return [
    ...effects.outputs.map(
      (output) =>
        `#${output.index} → ${addressText(output.address)} : ${valueText(output.value.coin, output.value.assets)}${output.mine ? " (change)" : ""}`
    ),
    `fee ${formatAda(effects.fee)}${until === null ? "" : ` · invalid from slot ${until.slot}`}`
  ]
}
