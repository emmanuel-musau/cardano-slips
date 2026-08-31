/**
 * A tip Slip: one output whose amount the person picks. The parameterised
 * linked action is what carries the choice, and the `POST` reads it back off
 * its own URL — the round trip a client has to make work.
 */
import { defineSlip, fail } from "@cardano-slips/server"

import { inMinutes } from "./deadline.js"

export const author =
  "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"

const perAda = 1_000_000n
const minAda = 1
const maxAda = 1000

/** Decimal string to lovelace without going through a float, which loses the sixth place. */
const lovelaceOf = (raw: string): bigint | undefined => {
  const match = /^([0-9]{1,7})(?:\.([0-9]{1,6}))?$/.exec(raw.trim())
  if (match === null) return undefined
  return BigInt(match[1]) * perAda + BigInt((match[2] ?? "").padEnd(6, "0"))
}

const ada = (lovelace: bigint): string => {
  const fraction = (lovelace % perAda).toString().padStart(6, "0").replace(/0+$/, "")
  return fraction === "" ? `${lovelace / perAda}` : `${lovelace / perAda}.${fraction}`
}

export const tip = defineSlip({
  network: "mainnet",

  get: () => ({
    title: "Tip the author",
    description: "Send any amount straight to the author's address. Nothing is stored and no account is created.",
    icon: "https://linktap.example/i/tip.png",
    label: "Tip",
    links: {
      actions: [
        { label: "Tip 5 ADA", href: "/api/slips/tip?amount=5" },
        { label: "Tip 25 ADA", href: "/api/slips/tip?amount=25" },
        {
          label: "Tip {amount} ADA",
          href: "/api/slips/tip?amount={amount}",
          parameters: [
            { name: "amount", label: "Amount in ADA", type: "number", min: minAda, max: maxAda, required: true }
          ]
        }
      ]
    }
  }),

  post: ({ url }) => {
    const raw = url.searchParams.get("amount")
    if (raw === null) return fail("INVALID_PARAMETER", "Choose an amount to tip.", { field: "amount" })

    const lovelace = lovelaceOf(raw)
    if (lovelace === undefined) {
      return fail("INVALID_PARAMETER", "The amount must be a number of ADA.", { field: "amount" })
    }
    if (lovelace < BigInt(minAda) * perAda || lovelace > BigInt(maxAda) * perAda) {
      return fail("INVALID_PARAMETER", `The amount must be between ${minAda} and ${maxAda} ADA.`, { field: "amount" })
    }

    return {
      // Rendered from the parsed value, never echoed back from the query string.
      message: `Tip ${ada(lovelace)} ADA to the author.`,
      intent: {
        outputs: [{ address: author, lovelace: lovelace.toString() }],
        validUntil: inMinutes(10)
      }
    }
  }
})
