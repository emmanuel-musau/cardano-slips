import type { Parameter } from "@cardano-slips/core"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { boundsOf, ParameterForm } from "../src/parameter-form.js"

/**
 * The generated form: the three types the endpoint can declare, the bounds the
 * spec requires beside the field rather than only on failure, and what a
 * rejected value looks like.
 */

const amount: Parameter = { name: "amount", label: "Amount", type: "number", min: 1, max: 500, required: true }
const message: Parameter = { name: "message", label: "Message to the fund", type: "text", max: 64 }
const token: Parameter = {
  name: "token",
  label: "Token",
  type: "select",
  required: true,
  options: [
    { label: "USDM", value: "usdm" },
    { label: "USDCx", value: "usdcx" }
  ]
}

const form = (parameters: ReadonlyArray<Parameter>, props: Partial<Parameters<typeof ParameterForm>[0]> = {}) =>
  render(<ParameterForm parameters={parameters} values={{}} onChange={vi.fn()} {...props} />)

describe("the bounds line", () => {
  it.each([
    ["both bounds on a number", { ...amount }, "Between 1 and 500"],
    ["a lower bound alone", { name: "a", label: "A", type: "number", min: 2 } as Parameter, "At least 2"],
    ["an upper bound alone", { name: "a", label: "A", type: "number", max: 9 } as Parameter, "At most 9"],
    ["an upper bound on text, which counts characters", { ...message }, "At most 64 characters"],
    [
      "both bounds on text",
      { name: "a", label: "A", type: "text", min: 3, max: 8 } as Parameter,
      "Between 3 and 8 characters"
    ],
    ["the options of a select", { ...token }, "USDM or USDCx"]
  ])("states %s", (_case, parameter, expected) => {
    expect(boundsOf(parameter)).toBe(expected)
  })

  it("is nothing where the endpoint declared no bound", () => {
    expect(boundsOf({ name: "a", label: "A", type: "text" })).toBeUndefined()
  })

  it("counts the options rather than listing them once a select gets long", () => {
    const options = Array.from({ length: 8 }, (_, index) => ({ label: `Tier ${index}`, value: String(index) }))

    expect(boundsOf({ name: "tier", label: "Tier", type: "select", options })).toBe("8 options")
  })
})

describe("the three types", () => {
  it("draws a text parameter as a text box", () => {
    form([message])

    expect(screen.getByLabelText("Message to the fund").tagName).toBe("INPUT")
    expect(screen.getByLabelText("Message to the fund")).toHaveProperty("type", "text")
  })

  it("draws a number parameter as a decimal text box, never type=number", () => {
    // `type="number"` hands back "" for anything the browser dislikes, which
    // hides the value `checkValues` exists to judge.
    form([amount])
    const field = screen.getByLabelText("Amount")

    expect(field).toHaveProperty("type", "text")
    expect(field.getAttribute("inputmode")).toBe("decimal")
  })

  it("draws a select as a control offering the endpoint's options and nothing else", () => {
    form([token])
    const field = screen.getByLabelText("Token")

    expect(field.tagName).toBe("SELECT")
    expect([...(field as HTMLSelectElement).options].map((option) => option.value)).toEqual(["", "usdm", "usdcx"])
  })

  it("keeps a way back to empty on a select the endpoint did not require", () => {
    form([{ ...token, required: false }], { values: { token: "usdm" } })
    const field = screen.getByLabelText("Token") as HTMLSelectElement

    expect([...field.options].map((option) => option.value)).toEqual(["", "usdm", "usdcx"])
  })

  it("drops the empty option from a required select once something is chosen", () => {
    form([token], { values: { token: "usdm" } })
    const field = screen.getByLabelText("Token") as HTMLSelectElement

    expect([...field.options].map((option) => option.value)).toEqual(["usdm", "usdcx"])
  })
})

describe("what the form reports", () => {
  it("names the parameter and the new value on every change", () => {
    const onChange = vi.fn()
    form([amount], { onChange })

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "20" } })

    expect(onChange).toHaveBeenCalledWith("amount", "20")
  })

  it("renders the value it was handed and nothing of its own", () => {
    form([amount, message], { values: { amount: "20", message: "Keep it up" } })

    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "20")
    expect(screen.getByLabelText("Message to the fund")).toHaveProperty("value", "Keep it up")
  })

  it("holds no value for a parameter named after something on Object.prototype", () => {
    // `ParameterName` admits `constructor`, and a plain object answers for it.
    const built: Parameter = { name: "constructor", label: "Built", type: "text" }
    form([built])

    expect(screen.getByLabelText("Built")).toHaveProperty("value", "")
  })
})

describe("a field that was rejected", () => {
  it("shows the sentence in place of the bounds, and keeps what was typed", () => {
    form([amount], { values: { amount: "0.5" }, errors: { amount: { message: "Amount must be at least 1" } } })

    expect(screen.getByText("Amount must be at least 1")).toBeDefined()
    expect(screen.queryByText("Between 1 and 500")).toBeNull()
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "0.5")
  })

  it("says so to a screen reader as well as to a reader", () => {
    form([amount], { errors: { amount: { message: "Amount is required" } } })

    expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBe("true")
  })

  it("puts the endpoint's code beside the sentence, in place of whether the field was required", () => {
    form([amount], {
      errors: { amount: { message: "That handle closed its fund on 12 August", code: "INVALID_PARAMETER" } }
    })

    expect(screen.getByText("INVALID_PARAMETER")).toBeDefined()
    expect(screen.queryByText("Required")).toBeNull()
  })

  it("ignores an error named after something on Object.prototype", () => {
    form([amount], { errors: {} })

    expect(screen.getByText("Between 1 and 500")).toBeDefined()
    expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBeNull()
  })
})

describe("whether a field is required", () => {
  it("is stated on every field, either way", () => {
    form([amount, message])

    expect(screen.getByText("Required")).toBeDefined()
    expect(screen.getByText("Optional")).toBeDefined()
  })
})

describe("two cards on one page", () => {
  it("generate different ids for the same parameter name", () => {
    const first = form([amount], { idPrefix: "one" })
    const second = form([amount], { idPrefix: "two" })

    expect(first.container.querySelector("input")?.id).toBe("one-amount")
    expect(second.container.querySelector("input")?.id).toBe("two-amount")
  })
})
