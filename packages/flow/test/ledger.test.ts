import { addressText, type Reason, type ReasonCode, reasonCodes } from "@cardano-slips/verifier"
import { describe, expect, it } from "vitest"

import {
  blockedLine,
  describeCertificate,
  evidenceOf,
  groupsOf,
  headlineOf,
  isCollapsed,
  isGrouped,
  ledgerOf,
  matchLine,
  rawLines,
  type Row
} from "../src/ledger.js"
import {
  badge,
  certificate,
  closing,
  delegation,
  derivedOf,
  longLedger,
  output,
  payment,
  pool,
  shop,
  shopBytes,
  stranger,
  strangerBytes,
  strangerPaid,
  tokenPayment,
  usdm,
  walletBytes
} from "./derived.js"

/**
 * What the panel draws, worked out from the derived effects alone: the rows,
 * the headline, and which rows a mismatch points at. Every case here is a
 * figure a person decides on, so each is checked to the lovelace.
 */

const labels = (rows: ReadonlyArray<Row>): ReadonlyArray<string> => rows.map((row) => row.label)
const amounts = (row: Row | undefined): ReadonlyArray<string> => row?.amounts.map((amount) => amount.text) ?? []
const byLabel = (rows: ReadonlyArray<Row>, label: string): Row | undefined => rows.find((row) => row.label === label)

describe("the rows", () => {
  it("shows what is paid to someone else and the fee, and never the wallet's own change", () => {
    const rows = ledgerOf(payment)

    expect(labels(rows)).toEqual(["You pay", "Network fee"])
    expect(amounts(rows[0])).toEqual(["−12 ADA"])
    expect(amounts(rows[1])).toEqual(["−0.172541 ADA"])
  })

  it("names the recipient by a shortened address, whose full form is in the raw detail", () => {
    const rows = ledgerOf(payment)

    expect(rows[0]?.detail).toMatch(/^addr1[a-z0-9]{3}…[a-z0-9]{4}$/)
    expect(rawLines(payment).join("\n")).toContain(shop)
  })

  it("carries the token and the minimum ADA that travels with it, the token first", () => {
    expect(amounts(ledgerOf(tokenPayment)[0])).toEqual(["−12,000,000 USDM", "−1.17663 ADA"])
  })

  it("orders a delegation the way the sheet does: certificates, the fee, then the deposit", () => {
    expect(labels(ledgerOf(delegation))).toEqual(["Certificate", "Certificate", "Network fee", "Deposit"])
  })

  it("names the pool a certificate delegates to, in place of an amount", () => {
    const delegating = ledgerOf(delegation)[1]

    expect(delegating?.detail).toBe("Delegate your stake to a stake pool")
    expect(delegating?.identifier).toMatch(/^pool1[a-z0-9]{3}…[a-z0-9]{4}$/)
    expect(delegating?.amounts).toEqual([])
  })

  it("marks a deposit the ledger will return as refundable, and says what brings it back", () => {
    const deposit = byLabel(ledgerOf(delegation), "Deposit")

    expect(deposit?.chip).toBe("refundable")
    expect(deposit?.amounts).toEqual([{ text: "−2 ADA", tone: "held" }])
    expect(deposit?.note).toBe("Held by the network while you delegate. You get all 2 ADA back when you stop.")
  })

  it("marks a refund only the transaction claims as stated, and never in the colour of value arriving", () => {
    // Green is reserved for value arriving, and a refund nobody can promise has not arrived.
    const refund = byLabel(ledgerOf(closing), "Refund")

    expect(refund?.chip).toBe("as-stated")
    expect(refund?.amounts).toEqual([{ text: "+2 ADA", tone: "stated" }])
    expect(refund?.note).toContain("today's deposit standing in for it")
  })

  it("marks a pool deposit the body cannot settle as stated rather than promised", () => {
    const derived = derivedOf({
      certificates: [certificate(0, "PoolRegistration", { credential: null, role: null })],
      deposits: [{ kind: "pool", amount: 500_000_000n, basis: "assumed", source: "certificate", index: 0 }]
    })
    const deposit = byLabel(ledgerOf(derived), "Deposit")

    expect(deposit?.chip).toBe("as-stated")
    expect(deposit?.amounts[0]?.tone).toBe("stated")
  })

  it("shows rewards withdrawn and a token received as value arriving", () => {
    const rows = ledgerOf(longLedger)

    expect(byLabel(rows, "Withdrawal")?.amounts).toEqual([{ text: "+4.21 ADA", tone: "gained" }])
    expect(byLabel(rows, "Withdrawal")?.detail).toBe("Staking rewards to date")
    expect(byLabel(rows, "You receive")?.amounts).toEqual([{ text: "+1 PoolBadge", tone: "gained" }])
    expect(byLabel(rows, "You receive")?.detail).toMatch(/^policy a1b2…a1b2$/)
  })

  it("shows created and destroyed tokens once each, not again as a token received", () => {
    const derived = derivedOf({
      outputs: [output(0, walletBytes, 2_000_000n, { mine: true, tokens: [{ ...badge, quantity: 1n }] })],
      mint: [
        { ...badge, quantity: 1n },
        { ...usdm, quantity: -5n }
      ],
      assets: [{ ...badge, spent: 0n, received: 1n, delta: -1n }]
    })
    const rows = ledgerOf(derived)

    expect(labels(rows)).toEqual(["Tokens created", "Tokens destroyed", "Network fee"])
    expect(amounts(rows[1])).toEqual(["−5 USDM"])
  })

  it("names a token whose name is not text by its bytes, and one with no name as unnamed", () => {
    const derived = derivedOf({
      outputs: [
        output(0, shopBytes, 1_500_000n, {
          tokens: [
            { policyId: usdm.policyId, name: Uint8Array.of(0x00, 0xff), quantity: 3n },
            { policyId: badge.policyId, name: new Uint8Array(), quantity: 4n }
          ]
        })
      ]
    })

    expect(amounts(ledgerOf(derived)[0])).toEqual(["−3 of token 00ff", "−4 of an unnamed token", "−1.5 ADA"])
  })

  it("never says a certificate acts on the person's key when the wallet does not hold it", () => {
    const theirs = certificate(0, "StakeDelegation", { ours: false, pool })

    expect(describeCertificate(theirs)).toBe("Delegate another wallet's stake to a stake pool")
    expect(describeCertificate({ ...theirs, ours: true })).toBe("Delegate your stake to a stake pool")
  })

  it("has words for every certificate the decoder reads", () => {
    const kinds: { readonly [kind in ReturnType<typeof certificate>["kind"]]: true } = {
      StakeRegistration: true,
      StakeDeregistration: true,
      StakeDelegation: true,
      PoolRegistration: true,
      PoolRetirement: true,
      Registration: true,
      Deregistration: true,
      VoteDelegation: true,
      StakeVoteDelegation: true,
      StakeRegistrationDelegation: true,
      VoteRegistrationDelegation: true,
      StakeVoteRegistrationDelegation: true,
      AuthorizeCommitteeHot: true,
      ResignCommitteeCold: true,
      RegisterDrep: true,
      UnregisterDrep: true,
      UpdateDrep: true
    }
    const silent = Object.keys(kinds).filter(
      (kind) => describeCertificate(certificate(0, kind as keyof typeof kinds)).trim() === ""
    )

    expect(silent).toEqual([])
  })

  it("names a DRep by its CIP-129 id, and the two fixed votes in words", () => {
    const toKey = certificate(0, "VoteDelegation", { drep: { _tag: "KeyHash", hash: pool } })
    const abstaining = certificate(0, "VoteDelegation", { drep: { _tag: "Abstain" } })

    expect(ledgerOf(derivedOf({ certificates: [toKey] }))[0]?.identifier).toMatch(/^drep1[a-z0-9]{3}…/)
    expect(ledgerOf(derivedOf({ certificates: [abstaining] }))[0]?.identifier).toBe("abstain")
    expect(describeCertificate(abstaining)).toBe("Set your vote to always abstain")
  })
})

describe("the headline", () => {
  it("is what leaves for someone else, with the fee said once beside it", () => {
    expect(headlineOf(payment)).toEqual({
      label: "Leaves your wallet",
      amount: "12 ADA",
      tone: "spent",
      fee: "plus 0.172541 ADA in network fees"
    })
  })

  it("names every unit that leaves, the token first", () => {
    expect(headlineOf(tokenPayment).amount).toBe("12,000,000 USDM and 1.17663 ADA")
  })

  it("is the fee where nothing is paid to anyone, and keeps the deposit out of it", () => {
    expect(headlineOf(delegation)).toEqual({
      label: "You spend",
      amount: "0.172541 ADA",
      tone: "spent",
      held: { label: "You lock, refundable", amount: "2 ADA", tone: "held" }
    })
  })

  it("is what the person ends up with where rewards outweigh the fee", () => {
    const { amount, held, label, tone } = headlineOf(longLedger)

    expect([label, amount, tone]).toEqual(["You end up with", "+4.037459 ADA", "gained"])
    expect(held?.label).toBe("Locked, refundable")
  })

  it("counts a claimed refund in neither the spend nor the gain", () => {
    const { amount, held, label } = headlineOf(closing)

    expect([label, amount]).toEqual(["You spend", "0.172541 ADA"])
    expect(held).toEqual({ label: "Returned, as stated", amount: "2 ADA", tone: "stated" })
  })
})

describe("grouping a long ledger", () => {
  it("keeps four rows or fewer as one list", () => {
    expect(isGrouped(ledgerOf(delegation))).toBe(false)
  })

  it("groups five or more into what arrives, what leaves and what moves nothing, in that order", () => {
    const rows = ledgerOf(longLedger)

    expect(isGrouped(rows)).toBe(true)
    expect(groupsOf(rows).map(({ group, rows: inGroup }) => [group, labels(inGroup)])).toEqual([
      ["arriving", ["You receive", "Withdrawal"]],
      ["leaving", ["Network fee", "Deposit"]],
      ["unmoved", ["Certificate", "Certificate"]]
    ])
  })

  it("folds each group to a count past eight rows", () => {
    const many = derivedOf({
      outputs: Array.from({ length: 8 }, (_, index) => output(index, shopBytes, 1_000_000n))
    })

    expect(isCollapsed(ledgerOf(many))).toBe(true)
    expect(isCollapsed(ledgerOf(longLedger))).toBe(false)
  })
})

/** One reason of every kind, against the transaction that pays a stranger. Keyed by code, so a new one fails to compile. */
const oneOfEach: { readonly [code in ReasonCode]: Extract<Reason, { code: code }> } = {
  "output.missing": { code: "output.missing", address: shop, declared: 2, paid: 1 },
  "output.undeclared": { code: "output.undeclared", address: stranger, declared: 0, paid: 1 },
  "output.lovelace": { code: "output.lovelace", address: shop, declared: 1_200_000n, paid: 12_000_000n },
  "output.assets": {
    code: "output.assets",
    address: shop,
    policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128",
    assetName: "5553444d",
    declared: 12n,
    paid: 0n
  },
  "certificate.missing": { code: "certificate.missing", declared: 1, carried: 0 },
  "certificate.undeclared": { code: "certificate.undeclared", declared: 0, carried: 1 },
  "certificate.order": { code: "certificate.order" },
  "certificate.target": { code: "certificate.target", index: 0, declared: "pool1declared", carried: "pool1carried" },
  "certificate.credential": { code: "certificate.credential", index: 0 },
  "certificate.deposit": { code: "certificate.deposit", index: 0, stated: 5_000_000n, parameter: 2_000_000n },
  "withdrawal.missing": { code: "withdrawal.missing" },
  "withdrawal.undeclared": { code: "withdrawal.undeclared", carried: 1 },
  "withdrawal.account": { code: "withdrawal.account", account: "stake1stranger" },
  "mint.undeclared": { code: "mint.undeclared", assets: [] },
  "body.unsupported": { code: "body.unsupported", members: ["script"] },
  "fee.excessive": { code: "fee.excessive", fee: 172_541n, ceiling: 100_000n },
  "interval.beyond-declared": { code: "interval.beyond-declared", validUntil: null, declared: 0n },
  "interval.not-yet-valid": { code: "interval.not-yet-valid", validFrom: 0n, now: 0n }
}

const marked = (rows: ReadonlyArray<Row>): ReadonlyArray<[string, string | undefined]> =>
  rows.filter((row) => row.mark !== undefined).map((row) => [row.key, row.mark])

describe("a mismatch on the rows", () => {
  it("marks only the payment the link never mentions", () => {
    // Marking everything would hide the one thing that is wrong.
    expect(marked(ledgerOf(strangerPaid, [oneOfEach["output.undeclared"]]))).toEqual([["output-1", "not-in-the-link"]])
  })

  it("marks a payment of the wrong amount as not what the link says", () => {
    expect(marked(ledgerOf(strangerPaid, [oneOfEach["output.lovelace"]]))).toEqual([
      ["output-0", "not-as-the-link-says"]
    ])
  })

  it("marks the extra payments to an address, not the ones the link asked for", () => {
    const twice = derivedOf({ outputs: [output(0, shopBytes, 12_000_000n), output(1, shopBytes, 12_000_000n)] })
    const reason: Reason = { code: "output.undeclared", address: shop, declared: 1, paid: 2 }

    expect(marked(ledgerOf(twice, [reason]))).toEqual([["output-1", "not-in-the-link"]])
  })

  it("marks the certificates past the ones the link asked for", () => {
    expect(marked(ledgerOf(delegation, [{ code: "certificate.undeclared", declared: 1, carried: 2 }]))).toEqual([
      ["certificate-1", "not-in-the-link"]
    ])
  })

  it("marks a deposit the certificate states wrongly, on the certificate and on the deposit", () => {
    expect(marked(ledgerOf(delegation, [oneOfEach["certificate.deposit"]]))).toEqual([
      ["certificate-0", "not-as-the-link-says"],
      ["deposit-certificate-0", "not-as-the-link-says"]
    ])
  })

  it("marks the fee when it passes the ceiling", () => {
    expect(marked(ledgerOf(payment, [oneOfEach["fee.excessive"]]))).toEqual([["fee", "not-as-the-link-says"]])
  })

  it("marks every created or destroyed token, since no link can ask for one", () => {
    const minting = derivedOf({ mint: [{ ...badge, quantity: 1n }] })

    expect(marked(ledgerOf(minting, [oneOfEach["mint.undeclared"]]))).toEqual([["mint-0", "not-in-the-link"]])
  })

  it("marks a withdrawal from someone else's account", () => {
    const theirs = derivedOf({ withdrawals: [{ rewardAccount: strangerBytes, amount: 1_000_000n, ours: false }] })
    const reason: Reason = { code: "withdrawal.account", account: stranger }

    expect(marked(ledgerOf(theirs, [reason]))).toEqual([["withdrawal-0", "not-in-the-link"]])
  })

  it("marks nothing for a reason with no row to point at, and leaves it to the sentence", () => {
    for (const code of [
      "output.missing",
      "certificate.order",
      "withdrawal.missing",
      "interval.not-yet-valid"
    ] as const) {
      expect(marked(ledgerOf(strangerPaid, [oneOfEach[code]])), code).toEqual([])
    }
  })

  it("takes every reason the verifier can report without failing", () => {
    expect(Object.keys(oneOfEach).sort()).toEqual(Object.keys(reasonCodes).sort())
    for (const reason of Object.values(oneOfEach)) expect(() => ledgerOf(longLedger, [reason])).not.toThrow()
  })
})

describe("the words around a verdict", () => {
  it("says a match once, in the sheet's sentence", () => {
    expect(matchLine(payment, ledgerOf(payment))).toBe(
      "Checked against the link. Every effect above is in the transaction, and the transaction does nothing else."
    )
  })

  it("says a delegation moves no funds, where it pays nobody", () => {
    expect(matchLine(delegation, ledgerOf(delegation))).toBe(
      "Checked against the link. Your ADA stays in your wallet — delegation moves no funds."
    )
  })

  it("counts the effects of a long ledger in words", () => {
    expect(matchLine(longLedger, ledgerOf(longLedger))).toBe(
      "Checked against the link. All six effects are described by it, and the transaction does nothing else."
    )
  })

  it("opens a block with what differs and closes it with the reassurance", () => {
    expect(blockedLine([oneOfEach["output.undeclared"]])).toBe(
      "The transaction pays an address the link never mentions. Nothing has been signed."
    )
  })

  it("still reassures, and still blocks, when there is no reason to give", () => {
    expect(blockedLine([])).toBe("The transaction could not be matched to the link. Nothing has been signed.")
  })

  it("never puts a reason code in front of a person", () => {
    const leaked = Object.values(oneOfEach).filter((reason) => {
      const { figure, lines } = evidenceOf(reason, strangerPaid)
      return [blockedLine([reason]), figure, ...lines].some((text) => text?.includes(reason.code))
    })

    expect(leaked).toEqual([])
  })
})

describe("what the transaction does, beside the claim", () => {
  it("gives an unlisted payment's amount and its full address", () => {
    expect(evidenceOf(oneOfEach["output.undeclared"], strangerPaid)).toEqual({
      figure: "−40 ADA",
      lines: [`to ${stranger}`]
    })
  })

  it("gives a wrong amount beside the one the link asked for", () => {
    // Signed like the row it points at, so the box and the ledger read the same figure the same way.
    expect(evidenceOf(oneOfEach["output.lovelace"], strangerPaid)).toEqual({
      figure: "−12 ADA",
      lines: [`to ${shop}`, "The link asks for 1.2 ADA"]
    })
  })

  it("gives the reason's own figure where the row it marks carries none", () => {
    const target: Reason = { code: "certificate.target", index: 1, declared: "pool1declared", carried: "pool1carried" }

    expect(evidenceOf(target, delegation)).toEqual({
      figure: "pool1carried",
      lines: ["The link asks for pool1declared"]
    })
  })

  it("falls back to the sentence where there is no figure to give", () => {
    expect(evidenceOf(oneOfEach["certificate.order"], strangerPaid)).toEqual({
      lines: ["The transaction's certificates are in a different order from the link's."]
    })
  })
})

describe("the raw detail", () => {
  it("lists every output with its full address, the change marked as change, then the fee and the slot it dies at", () => {
    expect(rawLines(strangerPaid)).toEqual([
      `#0 → ${shop} : 12 ADA`,
      `#1 → ${stranger} : 40 ADA`,
      `#2 → ${addressText(walletBytes)} : 47.827459 ADA (change)`,
      "fee 0.172541 ADA · invalid from slot 141992118"
    ])
  })

  it("names a token's policy beside it, since a name alone can be copied", () => {
    expect(rawLines(tokenPayment)[0]).toContain("12,000,000 USDM (policy 1ec7…0128)")
  })
})
