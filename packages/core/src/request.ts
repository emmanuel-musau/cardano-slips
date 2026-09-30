/**
 * One request a client makes of an origin — `slips.json`, discovery, or `POST` —
 * bounded in time and size, and never followed anywhere else.
 */
import { Data, Effect } from "effect"

import type { ClientErrorCode } from "./errors.js"

export class RequestFailure extends Data.TaggedError("RequestFailure")<{
  readonly code: Extract<ClientErrorCode, "UNREACHABLE" | "MALFORMED_RESPONSE">
  readonly detail: string
}> {}

export type BoundedRequestOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

export type BoundedAnswer = { readonly response: Response; readonly text: string }

const defaultTimeoutMs = 10_000

/** Far past any conforming `slips.json`, Slip or partial intent; anything bigger is not one being read slowly. */
const defaultMaxBytes = 256 * 1024

const redirectStatuses = new Set([301, 302, 303, 307, 308])

class Unreachable extends Error {}

/** Exceeding either bound is `UNREACHABLE`: nothing usable arrived, and the same request may succeed later. */
const readBounded = async (response: Response, maxBytes: number): Promise<string> => {
  const body = response.body
  if (body === null) return ""

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ""

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Unreachable(`response exceeded ${maxBytes} bytes`)
    }
    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}

/**
 * The spec forbids following a redirect to another origin, and a browser told
 * not to follow one will not say where it pointed. So none is followed, on the
 * same origin or not: the spec's "MAY follow" is declined rather than guessed at.
 */
export const boundedRequest = (
  url: string,
  init: RequestInit,
  options: BoundedRequestOptions = {}
): Effect.Effect<BoundedAnswer, RequestFailure> => {
  const call = options.fetch ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? defaultMaxBytes
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await call(url, { ...init, signal, credentials: "omit", redirect: "manual" })
      if (response.type === "opaqueredirect" || redirectStatuses.has(response.status)) {
        return { response, text: "", redirected: true }
      }
      return { response, text: await readBounded(response, maxBytes), redirected: false }
    },
    catch: (cause) => new RequestFailure({ code: "UNREACHABLE", detail: `could not reach ${url}: ${String(cause)}` })
  }).pipe(
    Effect.timeout(options.timeoutMs ?? defaultTimeoutMs),
    Effect.catchTag("TimeoutException", () =>
      Effect.fail(new RequestFailure({ code: "UNREACHABLE", detail: `timed out on ${url}` }))
    ),
    Effect.flatMap(({ redirected, response, text }) => {
      if (redirected) {
        return Effect.fail(
          new RequestFailure({ code: "MALFORMED_RESPONSE", detail: `${url} answered with a redirect` })
        )
      }
      // No redirect was followed, so this holds already; it is checked because a fetch passed in may not have obeyed.
      if (response.url !== "" && new URL(response.url).origin !== new URL(url).origin) {
        return Effect.fail(
          new RequestFailure({ code: "MALFORMED_RESPONSE", detail: `${url} was answered from ${response.url}` })
        )
      }
      return Effect.succeed({ response, text })
    })
  )
}
