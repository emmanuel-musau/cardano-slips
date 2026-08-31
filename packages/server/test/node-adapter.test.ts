import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { toNodeHandler, type NodeRequest } from "../src/adapters/node.js"
import { defineSlip, type SlipEndpoint } from "../src/index.js"

/**
 * The bridge runs against a real `node:http` server rather than a stubbed
 * request: what it exists to get right — a drained stream, a written status
 * line, a copied header — is exactly what a stub would fake.
 */

const changeAddress =
  "addr1qxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjynn4lleg4u9dpmgh74jap9ef7587khxr79r430d4gkalfwsl0vysa"

const endpoint = (): SlipEndpoint =>
  defineSlip({
    network: "mainnet",
    get: ({ url, params, request }) => ({
      title: `Pay ${String(params.handle ?? "someone")}`,
      description: `Served from ${url.origin} at ${url.pathname}${url.search}.`,
      icon: "https://linktap.example/i/pay.png",
      label: `Pay ${request.headers.get("accept-language") ?? "none"}`
    }),
    post: ({ url }) => ({
      intent: {
        outputs: [{ address: changeAddress, lovelace: "12000000" }],
        validUntil: "2099-01-01T00:00:00Z"
      },
      message: `Built at ${url.pathname}.`
    }),
    onInternalError: () => {}
  })

type Listener = (request: IncomingMessage, response: ServerResponse) => void

const withServer = async (listener: Listener, run: (base: string) => Promise<void>): Promise<void> => {
  const server = createServer(listener)
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
}

const origin = "https://linktap.example"

const post = { changeAddress, network: "mainnet" }

describe("dispatch", () => {
  it("answers a GET with the discovery response, headers intact", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`)

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("application/json")
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("cache-control")).toBe("public, max-age=60")
      expect(((await response.json()) as { type: string }).type).toBe("slip")
    })
  })

  it("answers the preflight", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, { method: "OPTIONS" })

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS")
      expect(await response.text()).toBe("")
    })
  })

  it("refuses a method a Slip endpoint does not answer, and says which it does", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, { method: "DELETE" })

      expect(response.status).toBe(405)
      expect(response.headers.get("allow")).toBe("GET, HEAD, POST, OPTIONS")
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
    })
  })
})

describe("the request body", () => {
  it("reads a POST straight off the stream where nothing parsed it first", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post)
      })

      expect(response.status).toBe(200)
      expect(((await response.json()) as { type: string }).type).toBe("partial")
    })
  })

  it("takes the parsed body a framework left behind, having drained the stream", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    // What `express.json()` and Nest both do before a route ever runs.
    const bodyParser: Listener = (request, response) => {
      const chunks: Uint8Array[] = []
      request.on("data", (chunk: Uint8Array) => chunks.push(chunk))
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8")
        const parsed = request as NodeRequest & { body?: unknown }
        Object.assign(parsed, { body: text === "" ? {} : (JSON.parse(text) as unknown) })
        void handler(parsed, response)
      })
    }

    await withServer(bodyParser, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post)
      })

      expect(response.status).toBe(200)
      expect(((await response.json()) as { type: string }).type).toBe("partial")
    })
  })

  it("takes a body a framework left as raw bytes", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    const rawParser: Listener = (request, response) => {
      const chunks: Uint8Array[] = []
      request.on("data", (chunk: Uint8Array) => chunks.push(chunk))
      request.on("end", () => {
        Object.assign(request, { body: Buffer.concat(chunks) })
        void handler(request as NodeRequest, response)
      })
    }

    await withServer(rawParser, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post)
      })

      expect(response.status).toBe(200)
    })
  })

  it("refuses a body past the bound rather than buffering whatever arrives", async () => {
    const handler = toNodeHandler(endpoint(), { origin, maxBytes: 64 })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...post, padding: "x".repeat(500) })
      })

      expect(response.status).toBe(400)
      expect(((await response.json()) as { code: string }).code).toBe("INVALID_PARAMETER")
    })
  })
})

describe("the origin", () => {
  it("is the one the publisher declared, whatever a request claims", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, { headers: { Host: "attacker.example" } })
      const slip = (await response.json()) as { description: string }

      expect(slip.description).toContain("Served from https://linktap.example at")
      expect(slip.description).not.toContain("attacker.example")
    })
  })

  it("comes from the request only where the publisher opted in", async () => {
    const handler = toNodeHandler(endpoint(), { originFromHeaders: true })

    await withServer(handler, async (base) => {
      const slip = (await (await fetch(`${base}/api/slips/pay`)).json()) as { description: string }

      expect(slip.description).toContain(base)
    })
  })

  it("follows the proxy headers when it is deriving one", async () => {
    const handler = toNodeHandler(endpoint(), { originFromHeaders: true })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, {
        headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "linktap.example" }
      })
      const slip = (await response.json()) as { description: string }

      expect(slip.description).toContain("https://linktap.example")
    })
  })

  it("refuses to be built without one, rather than guessing at deploy time", () => {
    expect(() => toNodeHandler(endpoint(), {})).toThrow(/origin/)
  })
})

describe("route parameters", () => {
  it("carries what a framework matched into the handlers", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    const router: Listener = (request, response) => {
      Object.assign(request, { params: { handle: "corner-store" } })
      void handler(request as NodeRequest, response)
    }

    await withServer(router, async (base) => {
      const slip = (await (await fetch(`${base}/api/slips/pay/corner-store`)).json()) as { title: string }

      expect(slip.title).toBe("Pay corner-store")
    })
  })
})

describe("a failure inside the bridge", () => {
  it("is reported to the publisher and never to the person", async () => {
    const onInternalError = vi.fn()
    const broken = { ...endpoint(), GET: () => Promise.reject(new Error("boom")) }
    const handler = toNodeHandler(broken, { origin, onInternalError })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`)
      const payload = (await response.json()) as { code: string; message: string }

      expect(response.status).toBe(500)
      expect(payload.code).toBe("INTERNAL_ERROR")
      expect(payload.message).not.toContain("boom")
      expect(onInternalError).toHaveBeenCalled()
    })
  })
})

describe("the request target", () => {
  it("cannot have its origin replaced by a protocol-relative path", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      // Node hands `//evil.example/pay` over verbatim, and resolving it against
      // the declared origin would swap the authority for the attacker's.
      const response = await fetch(`${base}//evil.example/pay`)
      const slip = (await response.json()) as { description: string }

      expect(slip.description).toContain("Served from https://linktap.example at")
      expect(slip.description).not.toContain("Served from https://evil.example")
    })
  })

  it("keeps the whole path where a framework mounted the handler under a prefix", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    // What `app.use("/api/slips/pay", handler)` does: `url` loses the prefix.
    const mounted: Listener = (request, response) => {
      Object.assign(request, { originalUrl: request.url, url: "/" })
      void handler(request as NodeRequest, response)
    }

    await withServer(mounted, async (base) => {
      const slip = (await (await fetch(`${base}/api/slips/pay?amount=5`)).json()) as { description: string }

      expect(slip.description).toContain("/api/slips/pay")
    })
  })

  it("carries the query string through", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const slip = (await (await fetch(`${base}/api/slips/pay?amount=5`)).json()) as { description: string }

      expect(slip.description).toContain("amount=5")
    })
  })
})

describe("the request headers", () => {
  it("reach the handlers, so an endpoint can still read what it authenticates on", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, { headers: { "Accept-Language": "sw-KE" } })
      const slip = (await response.json()) as { label: string }

      expect(slip.label).toBe("Pay sw-KE")
    })
  })
})

describe("HEAD", () => {
  it("carries the headers of the GET and none of its body", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, { method: "HEAD" })

      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("public, max-age=60")
      expect(await response.text()).toBe("")
    })
  })
})

describe("a body the bound has to judge", () => {
  it("does not mistake a small body for an oversized one because of what it says", async () => {
    const handler = toNodeHandler(endpoint(), { origin })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "tooLarge"
      })
      const payload = (await response.json()) as { message: string }

      expect(payload.message).toBe("The request body is not valid JSON.")
    })
  })

  it("holds the bound over a body a framework parsed, not only over the stream", async () => {
    const handler = toNodeHandler(endpoint(), { origin, maxBytes: 32 })

    const bodyParser: Listener = (request, response) => {
      Object.assign(request, { body: { ...post, padding: "x".repeat(200) } })
      void handler(request as NodeRequest, response)
    }

    await withServer(bodyParser, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, { method: "POST" })

      expect(response.status).toBe(400)
      expect(((await response.json()) as { message: string }).message).toContain("larger than")
    })
  })
})

describe("a proxy header that is not a scheme", () => {
  it("does not become an origin, and does not become a reported defect either", async () => {
    const onInternalError = vi.fn()
    const handler = toNodeHandler(endpoint(), { originFromHeaders: true, onInternalError })

    await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/slips/pay`, { headers: { "X-Forwarded-Proto": "wss" } })

      expect(response.status).toBe(200)
      expect(onInternalError).not.toHaveBeenCalled()
    })
  })
})
