/**
 * The words the effects panel puts in front of a person: exact figures, and a
 * plain account of each mismatch. Nothing here rounds, and nothing guesses a
 * token's decimals — the CIP requires base units where they are not known.
 */
import type { Reason, UnsupportedMember } from "@cardano-slips/verifier"

const lovelacePerAda = 1_000_000n

const grouped = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const magnitude = (value: bigint): bigint => (value < 0n ? -value : value)

/** Lovelace as ADA, to the lovelace. The sign is dropped: "you pay" and "you receive" carry the direction. */
export const formatAda = (lovelace: bigint): string => {
  const amount = magnitude(lovelace)
  const whole = grouped((amount / lovelacePerAda).toString())
  const fraction = (amount % lovelacePerAda).toString().padStart(6, "0").replace(/0+$/, "")
  return `${fraction === "" ? whole : `${whole}.${fraction}`} ADA`
}

/** A token quantity in base units, unsigned for the same reason as `formatAda`. */
export const formatQuantity = (quantity: bigint): string => grouped(magnitude(quantity).toString())

const bytesOf = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))

/** The asset name as text, or null where it is not text a person could read — which is then no name at all. */
export const assetLabel = (assetName: string): string | null => {
  if (assetName === "") return null
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytesOf(assetName))
    return /\p{C}/u.test(text) ? null : text
  } catch {
    return null
  }
}

const tokenAmount = (quantity: bigint, policyId: string, assetName: string): string => {
  const label = assetLabel(assetName)
  return label === null
    ? `${formatQuantity(quantity)} of token ${assetName || "with no name"} under policy ${policyId}`
    : `${formatQuantity(quantity)} ${label}`
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Unix milliseconds as a UTC instant. UTC so that the publisher and the person read the same moment. */
export const formatInstant = (time: bigint): string => {
  const date = new Date(Number(time))
  const two = (value: number): string => value.toString().padStart(2, "0")
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC`
}

/** Whole seconds until `until`, never below zero. */
export const secondsLeft = (until: bigint, now: bigint): number =>
  until <= now ? 0 : Math.floor(Number(until - now) / 1000)

/** The sheet's clock: `4m 12s`, and hours in front once there are any. */
export const formatCountdown = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = `${(seconds % 60).toString().padStart(2, "0")}s`
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, "0")}m ${rest}` : `${minutes}m ${rest}`
}

/**
 * A bech32 string cut to what a column can hold: the prefix, three characters,
 * and the last four. Only where the full string is a click away.
 */
export const shortened = (text: string): string => {
  const separator = text.lastIndexOf("1")
  if (separator < 1 || text.length - separator <= 12) return text
  return `${text.slice(0, separator + 4)}…${text.slice(-4)}`
}

const unsupportedWords: { readonly [member in UnsupportedMember]: string } = {
  "reference-input": "reads another output without spending it",
  collateral: "puts up collateral",
  "required-signer": "asks for an extra signature",
  vote: "casts a governance vote",
  proposal: "submits a governance proposal",
  donation: "donates to the treasury",
  "treasury-value": "states the treasury's value",
  script: "runs a script",
  datum: "attaches data to an output"
}

const payments = (count: number): string => (count === 1 ? "1 payment" : `${count} payments`)

const certificates = (count: number): string => (count === 1 ? "1 certificate" : `${count} certificates`)

/**
 * What the block shows for one reason, in the sheet's voice: the transaction
 * is held to "the link", and a sentence never carries an address — `where` does,
 * in full, beside it. The CIP asks for the difference, not the rule: `declared`
 * is what the link asked for and `actual` is what the transaction does, where
 * the reason has a figure for each.
 */
export type Explanation = {
  readonly summary: string
  readonly declared?: string
  readonly actual?: string
  /** The address or reward account the reason is about. */
  readonly where?: string
}

export const explainReason = (reason: Reason): Explanation => {
  switch (reason.code) {
    case "output.missing":
      return {
        summary: "The transaction leaves out a payment the link asks for.",
        declared: payments(reason.declared),
        actual: payments(reason.paid),
        where: reason.address
      }
    case "output.undeclared":
      return reason.declared === 0
        ? { summary: "The transaction pays an address the link never mentions.", where: reason.address }
        : {
            summary: "The transaction pays one address more times than the link asks for.",
            declared: payments(reason.declared),
            actual: payments(reason.paid),
            where: reason.address
          }
    case "output.lovelace":
      return {
        summary: "The transaction pays a different amount of ADA from the one the link asks for.",
        declared: formatAda(reason.declared),
        actual: formatAda(reason.paid),
        where: reason.address
      }
    case "output.assets":
      return {
        summary: "The transaction pays a different amount of a token from the one the link asks for.",
        declared: tokenAmount(reason.declared, reason.policyId, reason.assetName),
        actual: tokenAmount(reason.paid, reason.policyId, reason.assetName),
        where: reason.address
      }
    case "certificate.missing":
      return {
        summary: "A certificate the link asks for is missing from the transaction.",
        declared: certificates(reason.declared),
        actual: certificates(reason.carried)
      }
    case "certificate.undeclared":
      return {
        summary: "The transaction carries a certificate the link never mentions.",
        declared: certificates(reason.declared),
        actual: certificates(reason.carried)
      }
    case "certificate.order":
      return { summary: "The transaction's certificates are in a different order from the link's." }
    case "certificate.target":
      return {
        summary: `Certificate ${reason.index + 1} names a different pool or DRep from the one the link asks for.`,
        declared: reason.declared,
        actual: reason.carried
      }
    case "certificate.credential":
      return { summary: `Certificate ${reason.index + 1} acts on a stake key this wallet does not hold.` }
    case "certificate.deposit":
      return {
        summary: `Certificate ${reason.index + 1} takes a deposit other than the one the network sets.`,
        declared: formatAda(reason.parameter),
        actual: formatAda(reason.stated)
      }
    case "withdrawal.missing":
      return { summary: "The link asks to withdraw your rewards, and the transaction does not." }
    case "withdrawal.undeclared":
      return { summary: "The transaction withdraws rewards the link never mentions." }
    case "withdrawal.account":
      return {
        summary: "The transaction withdraws from a reward account that is not this wallet's.",
        where: reason.account
      }
    case "mint.undeclared":
      return {
        summary: "The transaction creates or destroys tokens, which no link can ask for.",
        actual: reason.assets
          .map(
            (asset) =>
              `${asset.quantity < 0n ? "Destroys" : "Creates"} ${tokenAmount(asset.quantity, asset.policyId, asset.assetName)}`
          )
          .join(", ")
      }
    case "body.unsupported":
      return {
        summary: `The transaction does things a link cannot describe: it ${reason.members
          .map((member) => unsupportedWords[member])
          .join(", ")}.`
      }
    case "fee.excessive":
      return {
        summary: "The network fee is higher than this transaction needs.",
        declared: `At most ${formatAda(reason.ceiling)}`,
        actual: formatAda(reason.fee)
      }
    case "interval.beyond-declared":
      return {
        summary: "The transaction stays valid for longer than the link says.",
        declared: `Until ${formatInstant(reason.declared)}`,
        actual: reason.validUntil === null ? "Never expires" : `Until ${formatInstant(reason.validUntil)}`
      }
    case "interval.not-yet-valid":
      return {
        summary: "The transaction cannot be submitted yet.",
        actual: `Valid from ${formatInstant(reason.validFrom)}`
      }
  }
}
