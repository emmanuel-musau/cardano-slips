import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePartialIntent } from "@cardano-slips/core"
import { decodeBech32, type Verdict } from "@cardano-slips/verifier"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Either } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { type Attempt, completeIntent } from "../src/complete.js"
import type { CompletionError } from "../src/complete-error.js"
import { EffectsPanel, type EffectsPanelProps } from "../src/effects-panel.js"
import { formatAda } from "../src/explain.js"
import { transactionIdOf } from "../src/witness.js"
import {
  closing,
  delegation,
  derivedOf,
  expiry,
  longLedger,
  output,
  payment,
  shop,
  shopBytes,
  stranger,
  strangerPaid
} from "./derived.js"
import { mainnetAddress, stubApi } from "./stub-wallet.js"
import { asCip30Hex, mainnetParameters, rewardAccountOf, walletUtxo } from "./wallet-utxos.js"
import { witnessSet } from "./witnesses.js"

/**
 * The panel against the states `6 · Preview states` draws. What matters most
 * is what cannot be pressed: a mismatch has no sign button at all, and no
 * combination of props brings one back.
 */

const match: Verdict = { _tag: "match" }
const strangerReason: Verdict = {
  _tag: "mismatch",
  reasons: [{ code: "output.undeclared", address: stranger, declared: 0, paid: 1 }]
}

/** 4m 12s before the fixtures expire, the sheet's own clock. */
const running = (): number => Number(expiry) - 252_000

const panel = (props: Partial<EffectsPanelProps> = {}) =>
  render(
    <EffectsPanel
      claim="Pay 12 ADA to Corner Store"
      description="One payment to the shop's address."
      derived={payment}
      verdict={match}
      clock={running}
      {...props}
    />
  )

const signButton = () => screen.queryByRole("button", { name: "Sign transaction" })

afterEach(() => {
  vi.useRealTimers()
})

describe("a transaction that matches the link", () => {
  it("restates the claim, gives the headline, lists the effects and says it was checked", () => {
    panel()

    expect(screen.getByRole("heading", { name: "Pay 12 ADA to Corner Store" })).toBeDefined()
    expect(screen.getByText("Leaves your wallet")).toBeDefined()
    expect(screen.getByText("12 ADA")).toBeDefined()
    expect(screen.getByText("plus 0.172541 ADA in network fees")).toBeDefined()
    expect(screen.getByText("−12 ADA")).toBeDefined()
    expect(screen.getByText("Network fee")).toBeDefined()
    expect(screen.getByText(/^Checked against the link\. Every effect above/)).toBeDefined()
  })

  it("counts down to the transaction's expiry", () => {
    panel()

    expect(screen.getByText("Expires in")).toBeDefined()
    expect(screen.getByText("4m 12s")).toBeDefined()
  })

  it("asks for the signature, and hands the press to the caller", () => {
    const onSign = vi.fn()
    const onCancel = vi.fn()
    panel({ onSign, onCancel })

    fireEvent.click(signButton()!)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(onSign).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("names the host that served the link and never calls it verified", () => {
    // Verification is the identity chip's to claim. An unverified publisher must never read as verified.
    const { container } = panel({ origin: "linktap.example" })

    expect(screen.getByText("linktap.example")).toBeDefined()
    expect(container.textContent).not.toMatch(/verified/i)
    expect(container.textContent).not.toContain("✓linktap")
  })

  it("keeps a deposit out of the spend and says what brings it back", () => {
    panel({ claim: "Delegate to Community Stake Pool", derived: delegation })

    expect(screen.getByText("You spend")).toBeDefined()
    expect(screen.getByText("You lock, refundable")).toBeDefined()
    expect(screen.getByText("Refundable")).toBeDefined()
    expect(screen.getByText(/You get all 2 ADA back when you stop/)).toBeDefined()
    expect(screen.getByText(/delegation moves no funds/)).toBeDefined()
  })

  it("marks a refund only the transaction claims as stated, and still lets it be signed", () => {
    // Not a mismatch and not a warning: the transaction does match the link.
    panel({ claim: "Stop delegating and close your stake key", derived: closing })

    expect(screen.getByText("Returned, as stated")).toBeDefined()
    expect(screen.getByText("As stated")).toBeDefined()
    expect(signButton()).not.toBeNull()
  })

  it("groups a long ledger under what arrives, what leaves and what moves nothing", () => {
    panel({ claim: "Claim rewards and redelegate", derived: longLedger })

    expect(screen.getByText("Arriving")).toBeDefined()
    expect(screen.getByText("Leaving")).toBeDefined()
    expect(screen.getByText("No value moved")).toBeDefined()
    expect(screen.getByText(/All six effects are described by it/)).toBeDefined()
  })

  it("opens the raw transaction only when asked, with every address in full", () => {
    const { container } = panel({ derived: strangerPaid, verdict: match })
    const toggle = screen.getByRole("button", { name: /Raw transaction/ })

    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(container.textContent).not.toContain(shop)

    fireEvent.click(toggle)

    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(container.textContent).toContain(shop)
    expect(container.textContent).toContain(stranger)
  })
})

describe("more than one panel on a page", () => {
  it("names each panel by its own title, even two in the same state", () => {
    render(
      <>
        <EffectsPanel claim="Pay the shop" derived={payment} verdict={match} clock={running} />
        <EffectsPanel claim="Pay the café" derived={payment} verdict={match} clock={running} />
      </>
    )

    expect(screen.getByRole("region", { name: "Pay the shop" })).toBeDefined()
    expect(screen.getByRole("region", { name: "Pay the café" })).toBeDefined()
  })
})

describe("a transaction that does not match", () => {
  it("has no sign button at all, rather than a disabled one", () => {
    const { container } = panel({ derived: strangerPaid, verdict: strangerReason, onSign: vi.fn() })

    expect(signButton()).toBeNull()
    expect(container.textContent).not.toContain("Sign transaction")
  })

  it("says so first, then what differs, then that nothing has been signed", () => {
    panel({ derived: strangerPaid, verdict: strangerReason })

    expect(screen.getByText("Signing blocked")).toBeDefined()
    expect(screen.getByRole("heading", { name: "This transaction doesn't do what the link says" })).toBeDefined()
    expect(screen.getByRole("alert").textContent).toContain(
      "The transaction pays an address the link never mentions. Nothing has been signed."
    )
  })

  it("sets the claim beside what the transaction does, with the stranger's address in full", () => {
    panel({ derived: strangerPaid, verdict: strangerReason })

    expect(screen.getByText("The link claims")).toBeDefined()
    expect(screen.getByText("Pay 12 ADA to Corner Store")).toBeDefined()
    expect(screen.getByText("One payment to the shop's address.")).toBeDefined()
    expect(screen.getByText("The transaction does")).toBeDefined()
    expect(screen.getByText("−40 ADA", { selector: ".slip-panel__evidence-figure" })).toBeDefined()
    expect(screen.getByText(`to ${stranger}`)).toBeDefined()
  })

  it("marks the one row the link never mentions, and no other", () => {
    const { container } = panel({ derived: strangerPaid, verdict: strangerReason })
    const marked = container.querySelectorAll("[data-mark]")

    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain("Not in the link")
    expect(marked[0]?.textContent).toContain("−40 ADA")
  })

  it("closes without signing, and shows the raw transaction on request", () => {
    const onCancel = vi.fn()
    const { container } = panel({ derived: strangerPaid, verdict: strangerReason, onCancel })

    fireEvent.click(screen.getByRole("button", { name: "Close without signing" }))
    fireEvent.click(screen.getByRole("button", { name: "Show raw transaction" }))

    expect(onCancel).toHaveBeenCalledOnce()
    expect(container.querySelector(".slip-panel__raw-lines")?.textContent).toContain(stranger)
  })

  it("offers a report only where there is somewhere to send it", () => {
    const onReport = vi.fn()
    panel({ derived: strangerPaid, verdict: strangerReason })
    expect(screen.queryByRole("button", { name: "Report this link" })).toBeNull()

    panel({ derived: strangerPaid, verdict: strangerReason, onReport })
    fireEvent.click(screen.getByRole("button", { name: "Report this link" }))
    expect(onReport).toHaveBeenCalledOnce()
  })

  it("still blocks a mismatch that came with no reasons", () => {
    panel({ derived: strangerPaid, verdict: { _tag: "mismatch", reasons: [] } })

    expect(signButton()).toBeNull()
    expect(screen.getByText(/could not be matched to the link\. Nothing has been signed\./)).toBeDefined()
  })

  it("blocks rather than offering a rebuild when the transaction has also expired", () => {
    // A rebuild is a second chance for a transaction that ran out of time, not for one that lied.
    panel({ derived: strangerPaid, verdict: strangerReason, clock: () => Number(expiry) + 1_000 })

    expect(screen.getByText("Signing blocked")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Build a new transaction" })).toBeNull()
  })

  it("never shows a reason code", () => {
    const { container } = panel({ derived: strangerPaid, verdict: strangerReason })

    expect(container.textContent).not.toMatch(/output\.|undeclared/)
  })
})

describe("time running out", () => {
  it("moves the countdown up in place of the headline under a minute", () => {
    panel({ clock: () => Number(expiry) - 47_000 })

    expect(screen.getByRole("timer").textContent).toContain("This transaction expires in")
    expect(screen.getByRole("timer").textContent).toContain("0m 47s")
    expect(screen.queryByText("Leaves your wallet")).toBeNull()
    expect(screen.queryByText("Expires in")).toBeNull()
    expect(signButton()).not.toBeNull()
  })

  it("ticks once a second", () => {
    vi.useFakeTimers()
    let now = running()
    panel({ clock: () => now })

    act(() => {
      now += 1_000
      vi.advanceTimersByTime(1_000)
    })

    expect(screen.getByText("4m 11s")).toBeDefined()
  })

  it("takes the sign button away once the transaction has expired, and offers a new one instead", () => {
    const onRebuild = vi.fn()
    panel({ clock: () => Number(expiry), onRebuild })

    expect(screen.getByRole("heading", { name: "This transaction ran out of time" })).toBeDefined()
    expect(screen.getByText(/Nothing was signed and nothing left your wallet/)).toBeDefined()
    expect(signButton()).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Build a new transaction" }))
    expect(onRebuild).toHaveBeenCalledOnce()
  })

  it("expires while open, without anyone pressing anything", () => {
    vi.useFakeTimers()
    let now = Number(expiry) - 1_000
    panel({ clock: () => now })
    expect(signButton()).not.toBeNull()

    act(() => {
      now += 1_000
      vi.advanceTimersByTime(1_000)
    })

    expect(signButton()).toBeNull()
  })

  it("shows no countdown for a transaction with no expiry", () => {
    panel({ derived: derivedOf({ outputs: [output(0, shopBytes, 12_000_000n)], validUntil: null }) })

    expect(screen.queryByText("Expires in")).toBeNull()
    expect(signButton()).not.toBeNull()
  })
})

describe("a long ledger folded to its groups", () => {
  const many = derivedOf({ outputs: Array.from({ length: 8 }, (_, index) => output(index, shopBytes, 1_000_000n)) })

  it("folds each group to its name and a count", () => {
    const { container } = panel({ derived: many })

    expect(screen.getByText("Leaving · 9")).toBeDefined()
    expect(container.querySelector("details")?.open).toBe(false)
  })

  it("never folds away the row a mismatch points at", () => {
    const { container } = panel({
      derived: many,
      verdict: { _tag: "mismatch", reasons: [{ code: "fee.excessive", fee: 172_541n, ceiling: 100_000n }] }
    })

    expect(container.querySelector("details")?.open).toBe(true)
  })
})

/*
 * The same panel over transactions the real pipeline built and judged: the
 * stub stands in for the wallet only, and derivation and comparison run as
 * they do for a person.
 */
describe("a transaction the pipeline built", () => {
  const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "partial", "valid")
  const decoded = decodePartialIntent(JSON.parse(readFileSync(join(examples, "payment.json"), "utf8")))
  if (Either.isLeft(decoded)) throw new Error("payment.json is not a partial intent")
  const address = decodeBech32(mainnetAddress.bech32)
  if (Either.isLeft(address)) throw new Error("the stub wallet's address is not bech32")

  const api = stubApi({
    getUtxos: async () => [asCip30Hex(walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 100_000_000n, seed: 1 }))],
    signTx: async () => witnessSet("1"),
    submitTx: async (tx) => Effect.runSync(transactionIdOf(tx))
  })
  const request = (userAddresses: ReadonlyArray<Uint8Array>, onAttempt?: (attempt: Attempt) => void) =>
    completeIntent({
      api,
      intent: decoded.right.intent,
      network: "mainnet",
      changeAddress: mainnetAddress.bech32,
      userAddresses,
      parameters: mainnetParameters,
      now: () => Date.parse("2026-08-22T19:39:00Z"),
      ...(onAttempt === undefined ? {} : { onAttempt })
    })

  it("shows the fee the transaction states, to the lovelace", async () => {
    let seen: Attempt | undefined
    await Effect.runPromise(
      request([address.right.bytes, rewardAccountOf(mainnetAddress.bech32)], (attempt) => {
        seen = attempt
      })
    )
    render(
      <EffectsPanel
        claim="Pay the shop"
        derived={seen!}
        verdict={match}
        clock={() => Date.parse("2026-08-22T19:39:00Z")}
      />
    )

    expect(screen.getByText(`−${formatAda(seen!.lovelace.fee)}`)).toBeDefined()
    expect(signButton()).not.toBeNull()
  })

  it("blocks what the verifier blocked, from the failure the pipeline returns", async () => {
    // With no addresses of its own, the wallet's change is a payment the link never mentions.
    const result = await Effect.runPromise(Effect.either(request([])))
    if (Either.isRight(result)) throw new Error("this was expected to be blocked")
    const error = result.left as CompletionError
    expect(error.refusal).toBe("Blocked")

    const { container } = render(
      <EffectsPanel
        claim="Pay the shop"
        derived={error.derived!}
        verdict={{ _tag: "mismatch", reasons: error.reasons ?? [] }}
        clock={() => Date.parse("2026-08-22T19:39:00Z")}
      />
    )

    expect(signButton()).toBeNull()
    expect(container.querySelectorAll("[data-mark]").length).toBeGreaterThan(0)
  })
})
