import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { examples } from "../src/app/preview/effects/examples.js"
import EffectsPreview from "../src/app/preview/effects/page.js"

const now = BigInt(Date.parse("2026-09-28T12:00:00Z"))

const sectionOf = (container: HTMLElement, id: string): HTMLElement => {
  const section = container.querySelector<HTMLElement>(`section#${id}`)
  if (section === null) throw new Error(`no section for ${id}`)
  return section
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the effects preview", () => {
  it("shows every example, each through the real panel", () => {
    const { container } = render(<EffectsPreview />)
    for (const example of examples(now)) {
      expect(screen.getByRole("heading", { name: example.title })).toBeDefined()
      expect(sectionOf(container, example.id).querySelector(".slip-panel")).not.toBeNull()
    }
  })

  it("blocks every example that carries reasons, marks the row it is about, and offers no signature", () => {
    const { container } = render(<EffectsPreview />)
    for (const { id } of examples(now).filter((example) => example.reasons !== undefined)) {
      const section = sectionOf(container, id)
      expect(within(section).getByText("Signing blocked")).toBeDefined()
      expect(section.querySelectorAll("[data-mark]").length, id).toBe(1)
      expect(within(section).queryByRole("button", { name: "Sign transaction" })).toBeNull()
    }
  })

  it("explains a block in words and never in reason codes", () => {
    const { container } = render(<EffectsPreview />)
    const text = container.textContent ?? ""
    expect(text).toContain("The transaction pays a different amount of ADA from the one the link asks for.")
    expect(text).not.toMatch(/output\.|fee\.excessive/)
  })

  it("draws the expiring and the expired states from the clock alone", () => {
    const { container } = render(<EffectsPreview />)
    expect(within(sectionOf(container, "expiring")).getByRole("timer")).toBeDefined()
    expect(
      within(sectionOf(container, "expired")).getByRole("button", { name: "Build a new transaction" })
    ).toBeDefined()
  })

  it("does not exist in a production build", () => {
    // Example figures on a hosted page would read as a real transaction.
    vi.stubEnv("NODE_ENV", "production")
    expect(() => EffectsPreview()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404")
  })
})

describe("the examples", () => {
  it("add up the way the ledger requires, so the preview shows figures a transaction could have", () => {
    const unbalanced = examples(now)
      .filter(({ derived: { lovelace } }) => {
        const { total } = lovelace
        return total.inputs + total.withdrawn + total.refunded !== total.outputs + lovelace.fee + total.deposited
      })
      .map(({ id }) => id)
    expect(unbalanced).toEqual([])
  })

  it("agree with themselves on the fee and on what the wallet keeps", () => {
    for (const { derived } of examples(now)) {
      expect(derived.lovelace.fee).toBe(derived.effects.fee)
      const change = derived.effects.outputs.filter((output) => output.mine).reduce((sum, o) => sum + o.value.coin, 0n)
      expect(derived.lovelace.user.received).toBe(change)
    }
  })

  it("expire a few minutes after they are drawn, except the two that show time running out", () => {
    const expiries = Object.fromEntries(
      examples(now).map(({ derived, id }) => [id, derived.effects.validity.validUntil?.time])
    )
    expect(expiries["expiring"]).toBe(now + 47_000n)
    expect(expiries["expired"]).toBe(now - 1_000n)
    for (const [id, time] of Object.entries(expiries)) {
      if (id !== "expiring" && id !== "expired") expect(time, id).toBe(now + 300_000n)
    }
  })
})
