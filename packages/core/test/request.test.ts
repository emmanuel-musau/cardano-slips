import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import { boundedRequest, type RequestFailure } from "../src/index.js"

const target = "https://linktap.example/tip"

const run = (
  fetch: typeof globalThis.fetch,
  options: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<Either.Either<{ readonly response: Response; readonly text: string }, RequestFailure>> =>
  Effect.runPromise(Effect.either(boundedRequest(target, { method: "GET" }, { fetch, ...options })))

const answering = (response: () => Response): typeof globalThis.fetch =>
  (() => Promise.resolve(response())) as unknown as typeof globalThis.fetch

const codeOf = (result: Either.Either<unknown, RequestFailure>): string | undefined =>
  Either.isLeft(result) ? result.left.code : undefined

describe("one bounded request", () => {
  it("reads the answer it was given", async () => {
    const result = await run(answering(() => new Response("hello")))
    expect(Either.isRight(result) && result.right.text).toBe("hello")
  })

  // Following first and checking after is too late: the request, and a POST's body, has already gone.
  it("never lets the fetch follow a redirect, and sends no credentials", async () => {
    let asked: RequestInit | undefined
    await run(((_: string, init: RequestInit) => {
      asked = init
      return Promise.resolve(new Response("{}"))
    }) as unknown as typeof globalThis.fetch)
    expect(asked?.redirect).toBe("manual")
    expect(asked?.credentials).toBe("omit")
  })

  it.each([301, 302, 303, 307, 308])("refuses a %i, even one that stays on the origin", async (status) => {
    const result = await run(
      answering(() => new Response(null, { status, headers: { location: "https://linktap.example/elsewhere" } }))
    )
    expect(codeOf(result)).toBe("MALFORMED_RESPONSE")
  })

  it("refuses the opaque answer a browser gives for a redirect it was told not to follow", async () => {
    const result = await run(
      answering(() => {
        const response = new Response(null, { status: 200 })
        Object.defineProperty(response, "type", { value: "opaqueredirect" })
        return response
      })
    )
    expect(codeOf(result)).toBe("MALFORMED_RESPONSE")
  })

  it("refuses an answer that came from another origin", async () => {
    const result = await run(
      answering(() => {
        const response = new Response("{}")
        Object.defineProperty(response, "url", { value: "https://tracker.example/tip" })
        return response
      })
    )
    expect(codeOf(result)).toBe("MALFORMED_RESPONSE")
  })

  it("reports a refused request as unreachable", async () => {
    const result = await run((() => Promise.reject(new TypeError("Failed to fetch"))) as typeof globalThis.fetch)
    expect(codeOf(result)).toBe("UNREACHABLE")
  })

  it("stops reading a body with no end", async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(4096)))
      }
    })
    const result = await run(
      answering(() => new Response(endless)),
      { maxBytes: 8192 }
    )
    expect(codeOf(result)).toBe("UNREACHABLE")
    expect(Either.isLeft(result) && result.left.detail).toContain("exceeded 8192 bytes")
  })

  it("holds the time bound over the body as well as the headers", async () => {
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) })
    const result = await run(
      answering(() => new Response(stalled)),
      { timeoutMs: 20 }
    )
    expect(codeOf(result)).toBe("UNREACHABLE")
  })
})
