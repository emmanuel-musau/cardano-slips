/**
 * A tip Slip: one output whose amount the person picks. The parameterised
 * linked action is what carries the choice, and the `POST` reads it back off
 * its own URL — the round trip a client has to make work.
 */
import { defineSlip, fail } from "@cardano-slips/server"

import { inMinutes } from "./deadline.js"

export const author =
  "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"

const perAda = 1_000_000
const minAda = 1
const maxAda = 1000

/**
 * The value domain core's own `checkValues` accepts, exponent form included.
 * A narrower one here would reject values a client had already told the person
 * were fine.
 */
const numeric = /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/

type Amount = number | "notANumber" | "tooPrecise"

/** Bounded to `maxAda` below, so the product stays well inside exact integer range. */
const lovelaceOf = (raw: string): Amount => {
  const trimmed = raw.trim()
  if (!numeric.test(trimmed)) return "notANumber"

  const lovelace = Number(trimmed) * perAda
  return Number.isInteger(lovelace) ? lovelace : "tooPrecise"
}

const ada = (lovelace: number): string => {
  const fraction = String(lovelace % perAda)
    .padStart(6, "0")
    .replace(/0+$/, "")
  return fraction === "" ? String(lovelace / perAda) : `${Math.trunc(lovelace / perAda)}.${fraction}`
}

export const tip = defineSlip({
  network: "mainnet",

  // Hrefs come from the URL this was served at, not from a path written here:
  // three suites mount this same fixture, and a hardcoded path would send their
  // buttons to a route that answers nothing.
  get: ({ url }) => ({
    title: "Tip the author",
    description: "Send any amount straight to the author's address. Nothing is stored and no account is created.",
    icon: "https://linktap.example/i/tip.png",
    label: "Tip",
    links: {
      actions: [
        { label: "Tip 5 ADA", href: `${url.pathname}?amount=5` },
        { label: "Tip 25 ADA", href: `${url.pathname}?amount=25` },
        {
          label: "Tip {amount} ADA",
          href: `${url.pathname}?amount={amount}`,
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
    if (lovelace === "notANumber") {
      return fail("INVALID_PARAMETER", "The amount must be a number of ADA.", { field: "amount" })
    }
    if (lovelace === "tooPrecise") {
      return fail("INVALID_PARAMETER", "ADA divides no further than six decimal places.", { field: "amount" })
    }
    if (lovelace < minAda * perAda || lovelace > maxAda * perAda) {
      return fail("INVALID_PARAMETER", `The amount must be between ${minAda} and ${maxAda} ADA.`, { field: "amount" })
    }

    return {
      // Rendered from the parsed value, never echoed back from the query string.
      message: `Tip ${ada(lovelace)} ADA to the author.`,
      intent: {
        outputs: [{ address: author, lovelace: String(lovelace) }],
        validUntil: inMinutes(10)
      }
    }
  }
})
