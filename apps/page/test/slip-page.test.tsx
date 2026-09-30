import { tip } from "@cardano-slips/example-slips"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { previewHost, type Scenario } from "../src/app/preview/flow/wallet.js"
import { SlipPage } from "../src/slip-page/slip-page.js"

/**
 * The critical path, from a link to a receipt: the page, flow and the verifier
 * run as they do for a person, against the example endpoints' own handlers.
 * Only the network and the wallet are stand-ins.
 */

const link = "https://linktap.example/tip"

type Handler = (request: Request) => Response | Promise<Response>

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

/** Mainnet's figures, as the page's own `/parameters/mainnet` hands them over. */
const parameters = {
  stakeDeposit: "2000000",
  poolDeposit: "500000000",
  drepDeposit: "500000000",
  governanceActionDeposit: "100000000000",
  minFeeCoefficient: "44",
  minFeeConstant: "155381",
  coinsPerUtxoByte: "4310",
  maxTxSize: 16_384
}

/**
 * Routes by path; anything unrouted is an HTML 404, as a real host would send.
 * The page's own parameters route answers unless a test routes it itself.
 */
const network = (
  routes: Record<string, Handler> = { "/tip": (request) => tip[request.method as "GET" | "POST"](request) }
) => {
  routes = { "/parameters/mainnet": () => json(parameters), ...routes }
  const sent: Array<{ readonly method: string; readonly path: string; readonly body: string }> = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    sent.push({ method: request.method, path: url.pathname + url.search, body: await request.clone().text() })
    const handler = routes[url.pathname]
    return handler === undefined ? new Response("<html>Not here</html>", { status: 404 }) : handler(request)
  })
  vi.stubGlobal("fetch", fetch)
  return sent
}

const later = async (answer: () => Response | Promise<Response>): Promise<Response> => {
  await new Promise((settled) => setTimeout(settled, 50))
  return answer()
}

const open = (scenario: Scenario = "signs", host: unknown = previewHost(scenario, 0)) =>
  render(<SlipPage link={link} walletHost={host} />)

const press = async (name: string | RegExp) => fireEvent.click(await screen.findByRole("button", { name }))

/** Card → wallet picker → the preview wallet, ending on the effects panel. */
const toPreview = async () => {
  await press("Tip 5 ADA")
  await press(/Preview wallet/)
  await screen.findByRole("button", { name: "Sign transaction" }, { timeout: 3000 })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("arriving", () => {
  it("resolves the link and shows the card, with the origin and network in the top bar", async () => {
    network()
    open()

    expect(await screen.findByRole("heading", { name: "Tip the author" })).toBeDefined()
    const bar = screen.getByRole("banner")
    expect(within(bar).getByText("linktap.example")).toBeDefined()
    expect(within(bar).getByText("Mainnet")).toBeDefined()
    expect(screen.getByText("No custody, no relayer. Your keys and your funds never leave your wallet.")).toBeDefined()
  })

  it("puts a bar above a test network's card that cannot be dismissed", async () => {
    network({
      "/tip": async (request) => json({ ...((await (await tip.GET(request)).json()) as object), network: "preprod" })
    })
    open()

    expect(await screen.findByText("Preprod testnet · not real funds")).toBeDefined()
    expect(screen.queryByRole("button", { name: /close|dismiss/i })).toBeNull()
  })

  it("names the host and offers its site when nothing is at the link", async () => {
    network({})
    open()

    expect(await screen.findByRole("heading", { name: "This link doesn't point to anything" })).toBeDefined()
    expect(screen.getByRole("link", { name: "Open linktap.example" }).getAttribute("href")).toBe(
      "https://linktap.example"
    )
  })

  it("renders the endpoint's own words on a failure it can read, and waits as long as it was asked to", async () => {
    network({
      "/tip": () =>
        json({ type: "error", version: "1", code: "RATE_LIMITED", message: "Busy, back soon." }, 429, {
          "retry-after": "30"
        })
    })
    open()

    expect(await screen.findByText("linktap.example says: “Busy, back soon.”")).toBeDefined()
    expect(screen.getByRole("button", { name: "Try again in 30s" }).hasAttribute("disabled")).toBe(true)
  })

  it("refuses a link that is not https without fetching it", async () => {
    const sent = network()
    render(<SlipPage link="http://linktap.example/tip" walletHost={previewHost("signs", 0)} />)

    expect(await screen.findByRole("heading", { name: "This isn't a link this page can open" })).toBeDefined()
    expect(sent).toEqual([])
  })
})

describe("a Slip that completes", () => {
  it("connects only after an action is chosen, shows the checked effects, then signs, submits and gives a receipt", async () => {
    const sent = network()
    open()

    await press("Tip 5 ADA")
    expect(await screen.findByRole("heading", { name: "Connect a wallet to continue" })).toBeDefined()
    expect(screen.getByText(/receives one change address so it can name a recipient/)).toBeDefined()

    await press(/Preview wallet/)
    await screen.findByRole("button", { name: "Sign transaction" }, { timeout: 3000 })
    expect(screen.getByText("−5 ADA")).toBeDefined()

    await press("Sign transaction")
    expect(await screen.findByText("Sent to Mainnet", {}, { timeout: 3000 })).toBeDefined()
    const receipt = screen.getByRole("link", { name: "View on cardanoscan" }).getAttribute("href")
    expect(receipt).toMatch(/^https:\/\/cardanoscan\.io\/transaction\/[0-9a-f]{64}$/)

    // Mode A: the endpoint learned an address and a network, and nothing the wallet holds.
    const post = sent.find((request) => request.method === "POST")
    expect(post?.path).toBe("/tip?amount=5")
    expect(Object.keys(JSON.parse(post?.body ?? "{}") as object).sort()).toEqual(["changeAddress", "network"])
  })

  it("asks the wallet for nothing until the person presses sign", async () => {
    network()
    const host = previewHost("signs", 0)
    const api = await host.cardano.preview!.enable()
    const signTx = vi.spyOn(api, "signTx")
    open("signs", host)

    await toPreview()
    expect(signTx).not.toHaveBeenCalled()

    await press("Cancel")
    expect(await screen.findByRole("heading", { name: "Tip the author" })).toBeDefined()
    expect(signTx).not.toHaveBeenCalled()
  })
})

describe("what can happen after the signature is asked for", () => {
  it("takes a decline as an answer, and lets the person look again", async () => {
    network()
    open("declines")

    await toPreview()
    await press("Sign transaction")
    expect(await screen.findByRole("heading", { name: "You declined in your wallet" })).toBeDefined()

    await press("Review and sign again")
    expect(await screen.findByRole("button", { name: "Sign transaction" }, { timeout: 3000 })).toBeDefined()
  })

  // Each retry doubles the wait, so counting declines as retries would hold a person off a failure they never retried.
  it("counts a notice's retries per failure, not every press since the page opened", async () => {
    network()
    const host = previewHost("declines", 0)
    const api = await host.cardano.preview!.enable()
    open("declines", host)

    await toPreview()
    await press("Sign transaction")
    await press("Review and sign again")
    await press("Sign transaction")
    vi.spyOn(api, "getUtxos").mockResolvedValue([])
    await press("Review and sign again")

    expect(await screen.findByRole("heading", { name: "Not enough in your wallet" })).toBeDefined()
    expect(screen.getByRole("button", { name: /^Check again/ }).textContent).toBe("Check again in 1s")
  })

  it("shows the node's own reason when the network refuses the transaction", async () => {
    network()
    open("refuses")

    await toPreview()
    await press("Sign transaction")
    expect(await screen.findByText("FeeTooSmallUTxO (Coin 170000) (Coin 168141)", {}, { timeout: 3000 })).toBeDefined()
    expect(screen.getByRole("heading", { name: "The network wouldn't accept this transaction" })).toBeDefined()
  })

  it("rebuilds when the funds move, and asks for a second signature only after showing the new transaction", async () => {
    network()
    const host = previewHost("funds-move", 0)
    const api = await host.cardano.preview!.enable()
    const signTx = vi.spyOn(api, "signTx")
    open("funds-move", host)

    await toPreview()
    await press("Sign transaction")
    expect(await screen.findByRole("heading", { name: "Your funds moved while you were signing" })).toBeDefined()
    expect(screen.getByText("Attempt 2 of 3")).toBeDefined()

    await screen.findByRole("button", { name: "Sign transaction" }, { timeout: 4000 })
    expect(signTx).toHaveBeenCalledTimes(1)

    await press("Sign transaction")
    expect(await screen.findByText("Sent to Mainnet", {}, { timeout: 3000 })).toBeDefined()
    expect(signTx).toHaveBeenCalledTimes(2)
  })
})

describe("what stops the flow before a transaction exists", () => {
  it("says no wallet is installed, and where to get one, without blaming the link", async () => {
    network()
    open("signs", { cardano: {} })

    await press("Tip 5 ADA")
    expect(await screen.findByRole("heading", { name: "No Cardano wallet in this browser" })).toBeDefined()
    expect(screen.getByRole("link", { name: "Lace" })).toBeDefined()
  })

  it("stops before the wallet or the endpoint is asked anything when the page cannot read the network's fees", async () => {
    const sent = network({
      "/tip": (request) => tip[request.method as "GET" | "POST"](request),
      "/parameters/mainnet": () => json({ message: "The chain provider did not answer." }, 502)
    })
    open()

    await press("Tip 5 ADA")
    await press(/Preview wallet/)
    expect(
      await screen.findByRole("heading", { name: "This page couldn't read the network's current fees" })
    ).toBeDefined()
    expect(sent.some((request) => request.method === "POST")).toBe(false)
  })

  it("catches a wallet on the wrong network before anything is sent to the endpoint", async () => {
    const sent = network()
    open("testnet")

    await press("Tip 5 ADA")
    await press(/Preview wallet/)
    expect(await screen.findByRole("heading", { name: "Your wallet is on a test network" })).toBeDefined()
    expect(sent.some((request) => request.method === "POST")).toBe(false)
  })

  it("says the wallet is short, as a request the person can try again", async () => {
    network()
    open("empty")

    await press("Tip 5 ADA")
    await press(/Preview wallet/)
    expect(await screen.findByRole("heading", { name: "Not enough in your wallet" })).toBeDefined()
    expect(screen.getByRole("button", { name: /Check again/ })).toBeDefined()
  })

  it("puts an amount the endpoint refused back on the field, with the endpoint's words", async () => {
    network()
    open()

    await press("Tip ADA")
    fireEvent.change(await screen.findByLabelText(/Amount in ADA/), { target: { value: "1.0000001" } })
    await press("Tip 1.0000001 ADA")
    await press(/Preview wallet/)

    expect(await screen.findByText("ADA divides no further than six decimal places.")).toBeDefined()
    expect(screen.getByRole("heading", { name: "Tip the author" })).toBeDefined()
  })

  it("refuses a Slip that asks to be built on a server, without sending anything", async () => {
    const sent = network({
      "/tip": async (request) =>
        request.method === "GET"
          ? json({ ...((await (await tip.GET(request)).json()) as object), build: "server" })
          : tip.POST(request)
    })
    open()

    await press("Tip 5 ADA")
    expect(await screen.findByRole("heading", { name: "This link builds on a server" })).toBeDefined()
    expect(sent.some((request) => request.method === "POST")).toBe(false)
  })

  it("keeps what the person typed when the Slip is read again", async () => {
    let posts = 0
    const sent = network({
      "/tip": async (request) => {
        // A real read takes long enough for the page to draw what it shows in between.
        if (request.method === "GET") return posts === 0 ? tip.GET(request) : later(() => tip.GET(request))
        posts += 1
        return posts === 1
          ? json({ type: "error", version: "1", code: "EXPIRED", message: "Try that again." }, 410)
          : tip.POST(request)
      }
    })
    open()

    await press("Tip ADA")
    fireEvent.change(await screen.findByLabelText(/Amount in ADA/), { target: { value: "7" } })
    await press("Tip 7 ADA")
    await press(/Preview wallet/)
    await waitFor(() =>
      expect(sent.filter((request) => request.method === "GET" && request.path === "/tip")).toHaveLength(2)
    )

    await screen.findByRole("heading", { name: "Tip the author" })

    expect(screen.getByLabelText<HTMLInputElement>(/Amount in ADA/).value).toBe("7")
  })

  it("reads the Slip again when the endpoint says it closed between the card and the build", async () => {
    const sent = network({
      "/tip": (request) =>
        request.method === "GET"
          ? tip.GET(request)
          : json({ type: "error", version: "1", code: "UNAVAILABLE", message: "Closed for now." }, 409)
    })
    open()

    await press("Tip 5 ADA")
    await press(/Preview wallet/)
    await waitFor(() =>
      expect(sent.filter((request) => request.method === "GET" && request.path === "/tip")).toHaveLength(2)
    )
  })
})
