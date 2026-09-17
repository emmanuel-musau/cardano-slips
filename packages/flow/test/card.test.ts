import { describe, expect, it } from "vitest"

import {
  actionLabel,
  actionsOf,
  blockedLabel,
  closureOf,
  monogramOf,
  originOf,
  valueOf,
  valuesFor
} from "../src/card.js"
import { discoveryUrl, slipExample } from "./slips.js"

/**
 * The card's model, away from any rendering. Each rule here is one the spec
 * states in prose — which button a Slip asks for, which level of `disabled`
 * wins — so the assertions are the spec's and not the component's.
 */

describe("the buttons a Slip asks for", () => {
  it("is one button labelled `label`, aimed at the discovery URL, when `links` is absent", () => {
    const slip = slipExample("payment")

    expect(actionsOf(slip, discoveryUrl)).toEqual([{ label: "Pay 12.00 USDM", href: discoveryUrl }])
  })

  it("is the linked actions, in the order the endpoint wrote them, when `links` is present", () => {
    const slip = slipExample("open-contribution")

    expect(actionsOf(slip, discoveryUrl).map((action) => action.label)).toEqual([
      "Contribute 25 USDM",
      "Contribute 100 USDM",
      "Contribute {amount} {token}"
    ])
  })
})

describe("why an action cannot be used", () => {
  it("is nothing while the Slip and the action are both open", () => {
    const slip = slipExample("open-contribution")

    expect(closureOf(slip, actionsOf(slip, discoveryUrl)[0])).toBeUndefined()
  })

  it("is the option's own reason where that option alone is closed", () => {
    const slip = slipExample("option-sold-out")
    const [general, front] = actionsOf(slip, discoveryUrl)

    expect(closureOf(slip, general)).toBeUndefined()
    expect(closureOf(slip, front)?.message).toBe("Front row is sold out. General seats are still available.")
  })

  it("is the Slip's reason where the Slip is closed, however the option is marked", () => {
    // `closed-with-live-link` carries `disabled: false` on its one action. The
    // top level wins: an option is never reopened by its own field.
    const slip = slipExample("closed-with-live-link")
    const [action] = actionsOf(slip, discoveryUrl)

    expect(action.disabled).toBe(false)
    expect(closureOf(slip, action)?.message).toBe("Delegation is paused until the next epoch boundary.")
  })
})

describe("the publisher the card names", () => {
  it.each([
    ["https://linktap.example/api/slips/pay", "linktap.example"],
    ["https://fund.linktap.example/api/slips/fund", "fund.linktap.example"],
    ["https://linktap.example:8443/api", "linktap.example:8443"]
  ])("reads %s as %s", (url, host) => {
    expect(originOf(url)).toBe(host)
  })

  it("is nothing where the URL is not one we can read", () => {
    expect(originOf("not a url")).toBeUndefined()
  })

  it.each([
    ["https://linktap.example/api", "L"],
    ["https://fund.linktap.example/api", "F"],
    ["https://7fund.example/api", "7"]
  ])("falls back to the initial of %s", (url, initial) => {
    expect(monogramOf(url)).toBe(initial)
  })

  it("offers no initial where there is no host to take one from", () => {
    expect(monogramOf("not a url")).toBeUndefined()
  })
})

describe("what the button says", () => {
  const slip = slipExample("open-contribution")
  const actions = actionsOf(slip, discoveryUrl)

  it("is the label as written where it carries no placeholder", () => {
    expect(actionLabel(slip, actions[0], {})).toBe("Contribute 25 USDM")
  })

  it("carries the typed value, unencoded, because a label is read rather than requested", () => {
    expect(actionLabel(slip, actions[2], { amount: "20", token: "USD M" })).toBe("Contribute 20 USD M")
  })

  it("collapses to the words that are left while the fields are empty", () => {
    expect(actionLabel(slip, actions[2], {})).toBe("Contribute")
  })

  it("stands in the Slip's own call to action where the label is nothing but placeholders", () => {
    expect(actionLabel(slip, { label: "{amount}", href: "/x?a={amount}" }, {})).toBe("Contribute")
  })
})

describe("the values handed to a caller", () => {
  const slip = slipExample("open-contribution")
  const actions = actionsOf(slip, discoveryUrl)

  it("are the ones this action declared, and no others", () => {
    expect(valuesFor(actions[2], { amount: "20", token: "usdm", elsewhere: "x" })).toEqual({
      amount: "20",
      token: "usdm"
    })
  })

  it("are empty where the action declared none", () => {
    expect(valuesFor(actions[0], { amount: "20" })).toEqual({})
  })

  it("carry an empty string for a field nobody filled, never an absent key", () => {
    expect(valuesFor(actions[2], {})).toEqual({ amount: "", token: "" })
  })

  it("read nothing off Object.prototype for a parameter named after it", () => {
    // `ParameterName` admits `constructor`, and a plain object answers for it.
    expect(valueOf({}, "constructor")).toBe("")
    expect(valueOf({ constructor: "mine" }, "constructor")).toBe("mine")
  })
})

describe("the label of a button that cannot send", () => {
  const issue = (name: string, message: string) => ({ name, reason: "required" as const, message })

  it("counts one field", () => {
    expect(blockedLabel([issue("amount", "Amount is required")])).toBe("Fix one field to continue")
  })

  it("counts two", () => {
    expect(blockedLabel([issue("amount", "…"), issue("handle", "…")])).toBe("Fix two fields to continue")
  })

  it("counts a field that fails twice once, because it is still one thing to fix", () => {
    expect(blockedLabel([issue("amount", "below"), issue("amount", "not a number")])).toBe("Fix one field to continue")
  })
})
