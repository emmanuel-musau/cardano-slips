import { readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { decodePartialIntent, decodeSlip } from "@cardano-slips/core"
import { Either } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { previewDelegate, previewPool, previewRecipient, previewTip } from "../src/index.js"
import { createExampleServer } from "../src/server.js"

const teamWallets = JSON.parse(
  readFileSync(new URL("../../../docs/team-wallets.json", import.meta.url), "utf8")
) as Record<string, ReadonlyArray<{ readonly addresses: ReadonlyArray<string> }>>

const build = (url: string, network = "preview"): Request =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changeAddress: previewRecipient, network })
  })

const body = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

let origin = ""
const server = createExampleServer("http://localhost")

beforeAll(async () => {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((closed) => server.close(closed))
})

describe("the preview examples", () => {
  it.each(["tip", "delegate"])("are what the example server answers on /%s", async (name) => {
    const decoded = decodeSlip(await (await fetch(`${origin}/${name}`)).json())
    if (Either.isLeft(decoded)) throw new Error(`/${name} did not decode`)

    expect(decoded.right.network).toBe("preview")
  })

  it("tip a recorded team wallet, so a test payment never counts as usage", async () => {
    const payload = await body(await previewTip.POST(build("http://localhost/tip?amount=5")))

    expect(Either.isRight(decodePartialIntent(payload))).toBe(true)
    expect(payload.intent).toMatchObject({ outputs: [{ address: previewRecipient, lovelace: "5000000" }] })
    expect(teamWallets.preview?.some((wallet) => wallet.addresses.includes(previewRecipient))).toBe(true)
  })

  it("delegate to the preview pool", async () => {
    const payload = await body(await previewDelegate.POST(build("http://localhost/delegate")))

    expect(payload.intent).toMatchObject({ certificates: [{ type: "stakeDelegation", poolId: previewPool }] })
  })

  it("refuse a wallet on preprod, the testnet a wallet cannot tell apart from preview", async () => {
    const response = await previewTip.POST(build("http://localhost/tip?amount=5", "preprod"))

    expect(response.status).toBe(400)
    expect((await body(response)).code).toBe("WRONG_NETWORK")
  })
})
