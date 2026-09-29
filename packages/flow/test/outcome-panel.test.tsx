import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { type Outcome, OutcomePanel, SlipReceipt } from "../src/outcome-panel.js"
import { payment } from "./derived.js"

/**
 * `10 · Signing and outcomes`. The effects stay readable in every state, and no
 * state after the signature is asked for offers a way to sign.
 */

const transactionId = "4a1f".padEnd(60, "0") + "c9b2"

const outcomes: ReadonlyArray<readonly [string, Outcome]> = [
  ["waiting", { _tag: "Waiting", wallet: "Lace" }],
  ["declined", { _tag: "Declined" }],
  ["submitting", { _tag: "Submitting", transactionId }],
  ["rebuilding", { _tag: "Rebuilding", number: 2, of: 3 }],
  ["refused", { _tag: "Refused", reason: "ValueNotConservedUTxO" }]
]

const panel = (outcome: Outcome, handlers: { onClose?: () => void; onAgain?: () => void } = {}) =>
  render(<OutcomePanel claim="Pay 12 ADA to Corner Store" derived={payment} outcome={outcome} {...handlers} />)

describe("the states after sign is pressed", () => {
  it.each(outcomes)("offers no way to sign while %s", (_, outcome) => {
    panel(outcome)
    expect(screen.queryByRole("button", { name: /sign transaction/i })).toBeNull()
  })

  it("keeps the effects on screen while the wallet is open, and says which wallet", () => {
    const onClose = vi.fn()
    panel({ _tag: "Waiting", wallet: "Lace" }, { onClose })

    expect(screen.getByText("Lace is open. Nothing is sent until you do.")).toBeDefined()
    expect(screen.getByText("−12 ADA")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("treats a decline as an answer, in no warning colour, with the offer still standing", () => {
    const onAgain = vi.fn()
    const { container } = panel({ _tag: "Declined" }, { onAgain })

    expect(container.querySelector(".slip-panel__kicker")?.hasAttribute("data-tone")).toBe(false)
    expect(container.querySelector(".slip-panel__stale")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Review and sign again" }))
    expect(onAgain).toHaveBeenCalledOnce()
  })

  it("shows the transaction id in full while submitting, since the page may die before the receipt", () => {
    panel({ _tag: "Submitting", transactionId })
    expect(screen.getByText(transactionId)).toBeDefined()
  })

  it("says which attempt a rebuild is, and that it will be shown before the wallet is asked again", () => {
    panel({ _tag: "Rebuilding", number: 2, of: 3 })
    expect(screen.getByText("Attempt 2 of 3")).toBeDefined()
    expect(screen.getByText(/you'll see its effects checked before your wallet is asked again/)).toBeDefined()
  })

  it("shows the node's reason as it came, and starts again only on request", () => {
    const onAgain = vi.fn()
    panel({ _tag: "Refused", reason: "ValueNotConservedUTxO" }, { onAgain })

    expect(screen.getByText("ValueNotConservedUTxO").tagName).toBe("PRE")
    fireEvent.click(screen.getByRole("button", { name: "Start again" }))
    expect(onAgain).toHaveBeenCalledOnce()
  })
})

describe("the receipt", () => {
  const receipt = () =>
    render(
      <SlipReceipt
        claim="Pay 12 ADA to Corner Store"
        derived={payment}
        transactionId={transactionId}
        network="mainnet"
        explorer={{ name: "cardanoscan", url: `https://cardanoscan.io/transaction/${transactionId}` }}
      />
    )

  it("says sent, not confirmed: nothing here watches the chain", () => {
    receipt()
    expect(screen.getByText("Sent to mainnet")).toBeDefined()
    expect(screen.queryByText(/confirmed/i)).toBeNull()
  })

  it("links out to the explorer, the only copy anyone keeps", () => {
    receipt()
    const link = screen.getByRole("link", { name: "View on cardanoscan" })
    expect(link.getAttribute("href")).toBe(`https://cardanoscan.io/transaction/${transactionId}`)
    expect(screen.getByText("4a1f…c9b2").getAttribute("title")).toBe(transactionId)
  })

  it("keeps the fee in its own colour, as the panel did", () => {
    const { container } = receipt()
    expect(container.querySelector('.slip-receipt__amount[data-tone="fee"]')).not.toBeNull()
  })
})
