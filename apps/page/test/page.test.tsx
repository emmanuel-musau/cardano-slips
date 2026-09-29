import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { metadata } from "../src/app/layout.js"
import Page from "../src/app/page.js"

const page = async (params: Record<string, string>) => render(await Page({ searchParams: Promise.resolve(params) }))

describe("the slip page", () => {
  it("says what it is for when it is opened without a link", async () => {
    await page({})
    expect(screen.getByRole("heading", { name: "Nothing to open yet" })).toBeDefined()
  })

  it("renders inside the element flow's tokens are scoped to", async () => {
    await page({})
    // `tokens.css` sets nothing on `:root`, so anything outside `slip-root` renders unstyled.
    expect(screen.getByRole("banner").closest(".slip-root")).not.toBeNull()
  })

  it("names itself in the browser tab", () => {
    expect(metadata.title).toBe("Cardano Slips")
  })
})
