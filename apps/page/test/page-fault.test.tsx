import { tip } from "@cardano-slips/example-slips"
import { fireEvent, render, screen } from "@testing-library/react"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Flow from "@cardano-slips/flow"

import { previewHost } from "../src/app/preview/flow/wallet.js"
import type * as Run from "../src/slip-page/run.js"
import { SlipPage } from "../src/slip-page/slip-page.js"

// Kept apart from slip-page.test.tsx because these replace the page's own wiring with code that dies.
const faults = vi.hoisted(() => ({ fetch: false, run: false }))

vi.mock("@cardano-slips/flow", async (importOriginal) => {
  const flow = await importOriginal<typeof Flow>()
  return {
    ...flow,
    fetchSlip: (link: string) => (faults.fetch ? Effect.die(new Error("unexpected")) : flow.fetchSlip(link))
  }
})

vi.mock("../src/slip-page/run.js", async (importOriginal) => {
  const run = await importOriginal<typeof Run>()
  return {
    ...run,
    runSlip: (...args: Parameters<typeof run.runSlip>) =>
      faults.run ? Effect.die(new Error("unexpected")) : run.runSlip(...args)
  }
})

const link = "https://linktap.example/tip"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      return new URL(request.url).pathname === "/tip"
        ? tip[request.method as "GET" | "POST"](request)
        : new Response("<html>Not here</html>", { status: 404 })
    })
  )
})

afterEach(() => {
  faults.fetch = false
  faults.run = false
  vi.unstubAllGlobals()
})

const fault = { name: "This page ran into a problem of its own" }

describe("a fault in the page itself", () => {
  it("replaces the loading card with a notice instead of loading forever", async () => {
    faults.fetch = true
    render(<SlipPage link={link} walletHost={previewHost("signs", 0)} />)

    expect(await screen.findByRole("heading", fault)).toBeDefined()
    expect(screen.getByRole("button", { name: /^Try again/ })).toBeDefined()
  })

  it("replaces the busy card with a notice instead of spinning forever", async () => {
    faults.run = true
    render(<SlipPage link={link} walletHost={previewHost("signs", 0)} />)

    fireEvent.click(await screen.findByRole("button", { name: "Tip 5 ADA" }))
    fireEvent.click(await screen.findByRole("button", { name: /Preview wallet/ }))
    expect(await screen.findByRole("heading", fault)).toBeDefined()
  })

  it("takes a request dropped for a newer one as no fault", async () => {
    const { rerender } = render(<SlipPage link={link} walletHost={previewHost("signs", 0)} />)
    rerender(<SlipPage link={`${link}?again`} walletHost={previewHost("signs", 0)} />)

    expect(await screen.findByRole("heading", { name: "Tip the author" })).toBeDefined()
    expect(screen.queryByRole("heading", fault)).toBeNull()
  })
})
