import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { metadata } from "../src/app/layout.js"
import Page from "../src/app/page.js"

describe("the slip page", () => {
  it("renders the Slip card from flow, inside the element its tokens are scoped to", () => {
    render(<Page />)
    const card = screen.getByRole("status")
    expect(card).toHaveProperty("textContent", "Loading this Slip")
    // `tokens.css` sets nothing on `:root`, so a card outside `slip-root` renders unstyled.
    expect(card.closest(".slip-root")).not.toBeNull()
  })

  it("names itself in the browser tab", () => {
    expect(metadata.title).toBe("Cardano Slips")
  })
})
