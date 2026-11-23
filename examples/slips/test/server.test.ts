import type { AddressInfo } from "node:net"
import { decodePartialIntent, decodeSlip } from "@cardano-slips/core"
import { Either } from "effect"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { delegateSlip } from "../src/delegate.js"
import { previewPool, previewRecipient, previewTip } from "../src/preview.js"
import { createExampleServer } from "../src/server.js"

let origin = ""
const server = createExampleServer("http://localhost")

beforeAll(async () => {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((closed) => server.close(closed))
})

describe("the example server", () => {
  it.each(["tip", "delegate"])("answers GET /%s with a Slip", async (name) => {
    const response = await fetch(`${origin}/${name}`)

    expect(response.status).toBe(200)
    expect(Either.isRight(decodeSlip(await response.json()))).toBe(true)
  })

  it("builds a partial intent on POST", async () => {
    const response = await fetch(`${origin}/tip?amount=5`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeAddress: previewRecipient, network: "preview" })
    })

    expect(response.status).toBe(200)
    expect(Either.isRight(decodePartialIntent(await response.json()))).toBe(true)
  })

  it("answers a path it does not serve with a 404 a browser is allowed to read", async () => {
    const response = await fetch(`${origin}/slips.json`)

    expect(response.status).toBe(404)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })
})

describe("an example server handed its own Slips", () => {
  it("serves those instead of the preview ones", async () => {
    const isRegistered = vi.fn(async () => false)
    const own = createExampleServer("http://localhost", {
      tip: previewTip,
      delegate: delegateSlip("preview", previewPool, isRegistered)
    })
    await new Promise<void>((listening) => own.listen(0, "127.0.0.1", listening))
    try {
      const at = `http://127.0.0.1:${(own.address() as AddressInfo).port}`
      const response = await fetch(`${at}/delegate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changeAddress: previewRecipient, network: "preview" })
      })

      expect(response.status).toBe(200)
      expect(isRegistered).toHaveBeenCalledWith(previewRecipient)
      expect(await response.json()).toMatchObject({
        intent: { certificates: [{ type: "stakeRegistration" }, { type: "stakeDelegation", poolId: previewPool }] }
      })
    } finally {
      await new Promise((closed) => own.close(closed))
    }
  })
})
