import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SlipCard, SlipCardError, SlipCardSkeleton, type SlipSubmission } from "../src/slip-card.js"
import { discoveryUrl, slipExample } from "./slips.js"

/**
 * The card against the states the design sheet draws and the rules the spec
 * states: what is rendered, what may be pressed, and what reaches the caller
 * when it is. Nothing here claims anything about the transaction — that is the
 * effects panel's job, and it is checked against bytes rather than this card.
 */

const fundUrl = "https://fund.linktap.example/api/slips/fund/community"

const press = (name: string | RegExp): void => {
  fireEvent.click(screen.getByRole("button", { name }))
}

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe("what the card renders", () => {
  it("shows the icon, the title, the description and the host that served the link", () => {
    const { container } = render(<SlipCard slip={slipExample("payment")} discoveryUrl={discoveryUrl} />)

    expect(screen.getByRole("heading", { name: "Pay 12.00 USDM to Corner Store" })).toBeDefined()
    expect(screen.getByText(/One payment to the shop's address/)).toBeDefined()
    expect(screen.getByText("linktap.example")).toBeDefined()
    expect(container.querySelector("img")?.src).toBe("https://linktap.example/i/corner-store.png")
  })

  it("leaves the icon out of the accessible name: the title already says what this is", () => {
    const { container } = render(<SlipCard slip={slipExample("payment")} discoveryUrl={discoveryUrl} />)

    expect(container.querySelector("img")?.alt).toBe("")
  })

  it("renders the description as text, whatever the endpoint put in it", () => {
    const slip = { ...slipExample("payment"), description: "<b>Safe</b> & sound" }
    const { container } = render(<SlipCard slip={slip} discoveryUrl={discoveryUrl} />)

    expect(screen.getByText("<b>Safe</b> & sound")).toBeDefined()
    expect(container.querySelector("b")).toBeNull()
  })

  it("falls back to the publisher's initial when the icon does not load", () => {
    const { container } = render(<SlipCard slip={slipExample("payment")} discoveryUrl={discoveryUrl} />)

    fireEvent.error(container.querySelector("img")!)

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("L")).toBeDefined()
  })

  it("promises the check that is the reason to press the button", () => {
    render(<SlipCard slip={slipExample("payment")} discoveryUrl={discoveryUrl} />)

    expect(screen.getByText(/checked against this card, before you sign/)).toBeDefined()
  })
})

describe("the buttons", () => {
  it("is one, labelled `label` and aimed at the discovery URL, when `links` is absent", () => {
    const onSubmit = vi.fn<(submission: SlipSubmission) => void>()
    render(<SlipCard slip={slipExample("payment")} discoveryUrl={discoveryUrl} onSubmit={onSubmit} />)

    press("Pay 12.00 USDM")

    expect(onSubmit.mock.calls[0]?.[0].href).toBe(discoveryUrl)
  })

  it("is every linked action, in the endpoint's order, with the first one primary", () => {
    const { container } = render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} />)

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Contribute 25 USDM",
      "Contribute 100 USDM",
      "Contribute"
    ])
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1)
  })

  it("sends an action with no parameters the moment it is chosen", () => {
    const onSubmit = vi.fn<(submission: SlipSubmission) => void>()
    render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} onSubmit={onSubmit} />)

    press("Contribute 100 USDM")

    expect(onSubmit.mock.calls[0]?.[0].href).toBe(
      "https://fund.linktap.example/api/slips/fund/community?amount=100&token=usdm"
    )
  })

  it("stops taking presses while a request is in flight", () => {
    const onSubmit = vi.fn()
    render(<SlipCard slip={slipExample("payment")} discoveryUrl={discoveryUrl} onSubmit={onSubmit} busy />)

    press("Pay 12.00 USDM")

    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe("the parameter form", () => {
  it("opens with the one action a Slip declares, because there is nothing to choose first", () => {
    const slip = slipExample("open-contribution")
    const single = { ...slip, links: { actions: [slip.links!.actions[2]] } }
    render(<SlipCard slip={single} discoveryUrl={fundUrl} />)

    expect(screen.getByLabelText("Amount")).toBeDefined()
  })

  it("stays shut until an action with parameters is chosen, where there are several", () => {
    render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} />)

    expect(screen.queryByLabelText("Amount")).toBeNull()

    press("Contribute")

    expect(screen.getByLabelText("Amount")).toBeDefined()
  })

  it("opens the form rather than sending, the first time such an action is pressed", () => {
    const onSubmit = vi.fn()
    render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} onSubmit={onSubmit} />)

    press("Contribute")

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("carries the typed values into the button's label", () => {
    render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} />)
    press("Contribute")

    type("Amount", "20")
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "usdm" } })

    expect(screen.getByRole("button", { name: "Contribute 20 usdm" })).toBeDefined()
  })

  it("percent-encodes every value into the target, so no answer can move the request", () => {
    const onSubmit = vi.fn<(submission: SlipSubmission) => void>()
    const slip = slipExample("open-contribution")
    const single = {
      ...slip,
      links: {
        actions: [
          {
            label: "Send {note}",
            href: "/api/slips/fund/community?note={note}",
            parameters: [{ name: "note", label: "Note", type: "text" as const, required: true }]
          }
        ]
      }
    }
    render(<SlipCard slip={single} discoveryUrl={fundUrl} onSubmit={onSubmit} />)

    type("Note", "evil.example/x?a=1")
    press(/Send/)

    expect(onSubmit.mock.calls[0]?.[0].href).toBe(
      "https://fund.linktap.example/api/slips/fund/community?note=evil.example%2Fx%3Fa%3D1"
    )
  })
})

describe("a value the client rejects", () => {
  const openForm = (): ReturnType<typeof vi.fn> => {
    const onSubmit = vi.fn()
    render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} onSubmit={onSubmit} />)
    press("Contribute")
    return onSubmit
  }

  it("says nothing before anything has been sent: a card does not open red", () => {
    openForm()

    expect(screen.queryByText("Amount is required")).toBeNull()
    expect(screen.getByText("Between 1 and 500")).toBeDefined()
  })

  it("is caught here, and nothing reaches the endpoint", () => {
    const onSubmit = openForm()

    press("Contribute")

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("Amount is required")).toBeDefined()
    expect(screen.getByText("Token is required")).toBeDefined()
  })

  it("counts the fields on the button rather than sending a half-filled request", () => {
    openForm()

    press("Contribute")

    expect(screen.getByRole("button", { name: "Fix two fields to continue" })).toHaveProperty("disabled", true)
  })

  it("uses core's sentence, so the same bad value reads identically in every client", () => {
    openForm()
    type("Amount", "0.5")

    press("Contribute 0.5")

    expect(screen.getByText("Amount must be at least 1")).toBeDefined()
  })

  it("lets the button go again as the fields are put right", () => {
    const onSubmit = openForm()
    press("Contribute")

    type("Amount", "20")
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "usdcx" } })
    press("Contribute 20 usdcx")

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe("a second Slip in the same card", () => {
  const withParameters = () => {
    const slip = slipExample("open-contribution")
    return { ...slip, links: { actions: [slip.links!.actions[2]] } }
  }

  it("opens empty rather than pre-filled with the last one's answers", () => {
    const { rerender } = render(<SlipCard slip={withParameters()} discoveryUrl={fundUrl} />)
    type("Amount", "20")

    rerender(<SlipCard slip={withParameters()} discoveryUrl="https://other.example/api/slips/x" />)

    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "")
  })

  it("takes its shape from the Slip it is now showing, not the one it was", () => {
    const { container, rerender } = render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} />)
    press("Contribute")

    // The third action was open; the next Slip has only a first.
    rerender(<SlipCard slip={withParameters()} discoveryUrl="https://other.example/api/slips/x" />)

    expect(screen.getByLabelText("Amount")).toBeDefined()
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1)
  })

  it("keeps what was typed while the same Slip is re-rendered", () => {
    const { rerender } = render(<SlipCard slip={withParameters()} discoveryUrl={fundUrl} />)
    type("Amount", "20")

    rerender(<SlipCard slip={withParameters()} discoveryUrl={fundUrl} busy />)

    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "20")
  })
})

describe("a parameter named after something on Object.prototype", () => {
  const slip = () => {
    const example = slipExample("open-contribution")
    return {
      ...example,
      links: {
        actions: [
          {
            label: "Send {constructor}",
            href: "/api/slips/fund/community?v={constructor}",
            parameters: [{ name: "constructor", label: "Built", type: "text" as const, required: true }]
          }
        ]
      }
    }
  }

  it("still reaches the field it belongs to when it is rejected", () => {
    // A plain object already answers to `constructor` with something that is
    // not nullish, so an error recorded with `??=` would go nowhere.
    const onSubmit = vi.fn()
    render(<SlipCard slip={slip()} discoveryUrl={fundUrl} onSubmit={onSubmit} />)

    press(/Send/)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("Built is required")).toBeDefined()
  })
})

describe("what reaches the caller", () => {
  it("is only what the chosen action asked for", () => {
    const onSubmit = vi.fn<(submission: SlipSubmission) => void>()
    render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} onSubmit={onSubmit} />)

    // Fill the third action's form, then send the first, which asked for nothing.
    press("Contribute")
    type("Amount", "20")
    press("Contribute 25 USDM")

    expect(onSubmit.mock.calls[0]?.[0].values).toEqual({})
  })

  it("is every value the chosen action did ask for", () => {
    const onSubmit = vi.fn<(submission: SlipSubmission) => void>()
    render(<SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} onSubmit={onSubmit} />)

    press("Contribute")
    type("Amount", "20")
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "usdm" } })
    press("Contribute 20 usdm")

    expect(onSubmit.mock.calls[0]?.[0].values).toEqual({ amount: "20", token: "usdm" })
  })
})

describe("a value the endpoint rejected", () => {
  it("lands on the field, leaves the card standing, and keeps what was typed", () => {
    const slip = slipExample("open-contribution")
    const single = { ...slip, links: { actions: [slip.links!.actions[2]] } }
    render(
      <SlipCard
        slip={single}
        discoveryUrl={fundUrl}
        rejected={{ amount: { message: "That tier closed on 12 August", code: "INVALID_PARAMETER" } }}
      />
    )
    type("Amount", "20")

    expect(screen.getByText("That tier closed on 12 August")).toBeDefined()
    expect(screen.getByText("INVALID_PARAMETER")).toBeDefined()
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "20")
    expect(screen.getByRole("heading", { name: "Contribute to the Community Fund" })).toBeDefined()
  })
})

describe("a Slip that cannot be used", () => {
  it("stays readable, loses only the action, and says why", () => {
    render(<SlipCard slip={slipExample("campaign-closed")} discoveryUrl={discoveryUrl} />)

    expect(screen.getByRole("heading", { name: "Delegate to Community Stake Pool" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Delegate" })).toHaveProperty("disabled", true)
    expect(screen.getByText(/This campaign closed on 12 August/)).toBeDefined()
  })

  it("drops the promise, because there is nothing left to sign", () => {
    render(<SlipCard slip={slipExample("campaign-closed")} discoveryUrl={discoveryUrl} />)

    expect(screen.queryByText(/before you sign/)).toBeNull()
  })

  it("closes an option that carries `disabled: false` under a closed Slip", () => {
    // The top level wins, and the option is never reopened by its own field.
    render(<SlipCard slip={slipExample("closed-with-live-link")} discoveryUrl={discoveryUrl} />)

    expect(screen.getByRole("button", { name: /Delegate to drep1wqz/ })).toHaveProperty("disabled", true)
    expect(screen.getByText(/Delegation is paused until the next epoch boundary/)).toBeDefined()
  })

  it("states a closed Slip's reason once, however many options it carries", () => {
    const slip = slipExample("option-sold-out")
    const closed = { ...slip, disabled: true, reason: { message: "The workshop is over." } }
    render(<SlipCard slip={closed} discoveryUrl={discoveryUrl} />)

    expect(screen.getAllByText("The workshop is over.")).toHaveLength(1)
  })

  it("renders a closed option rather than hiding it, and says why beside the ones still open", () => {
    // A shared link is seen by many people at once: a client that drops part of
    // it shows different people different actions.
    render(<SlipCard slip={slipExample("option-sold-out")} discoveryUrl={discoveryUrl} />)

    expect(screen.getByRole("button", { name: "General seat — 25 USDM" })).toHaveProperty("disabled", false)
    expect(screen.getByRole("button", { name: "Front row — 75 USDM" })).toHaveProperty("disabled", true)
    expect(screen.getByText(/Front row is sold out/)).toBeDefined()
  })
})

describe("what a consumer can restyle", () => {
  it.each([
    ["the card", <SlipCard slip={slipExample("open-contribution")} discoveryUrl={fundUrl} />],
    ["the skeleton", <SlipCardSkeleton />],
    ["the card that failed", <SlipCardError url="linktap.example" message="No." onRetry={vi.fn()} />]
  ])("names every element of %s with a class of ours, and touches no other", (_case, element) => {
    // The whole of the headless promise: a consumer restyles by these names, so
    // a class that is not ours is one nobody can target and one we do not own.
    const { container } = render(element)
    const classes = [...container.querySelectorAll("[class]")].flatMap((node) => [...node.classList])

    expect(classes.length).toBeGreaterThan(5)
    expect(classes.filter((name) => !name.startsWith("slip-"))).toEqual([])
  })
})

describe("the card before the metadata lands", () => {
  it("says it is busy without drawing a claim it does not have yet", () => {
    render(<SlipCardSkeleton />)

    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true")
    expect(screen.getByText("Loading this Slip")).toBeDefined()
  })
})

describe("the card that never loaded", () => {
  it("names the endpoint, says nothing was sent, and keeps the retry", () => {
    const onRetry = vi.fn()
    render(
      <SlipCardError
        url="linktap.example/api/slips/pay/corner-store"
        message="The site didn't respond. Nothing was sent and nothing was signed."
        onRetry={onRetry}
      />
    )

    expect(screen.getByRole("alert")).toBeDefined()
    expect(screen.getByText("linktap.example/api/slips/pay/corner-store")).toBeDefined()
    press("Try again")

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("offers no retry where the caller has nothing to retry with", () => {
    render(<SlipCardError url="linktap.example/api" message="That is not a Slip." />)

    expect(screen.queryByRole("button")).toBeNull()
  })
})
