/**
 * The bridge from Node's `IncomingMessage`/`ServerResponse` to the Web handlers
 * `defineSlip` returns, for NestJS and Express. A runtime built on
 * `Request`/`Response` needs nothing from this file.
 */
import type { IncomingMessage, ServerResponse } from "node:http"

import { endpointErrorStatus, PROTOCOL_VERSION } from "@cardano-slips/core"

import type { RouteParams, SlipEndpoint } from "../define-slip.js"
import { contained, internalErrorPayload, reportToConsole, type ErrorReporter } from "../reporting.js"

export type NodeRequest = IncomingMessage & {
  /** A body parser leaves the parsed value here, having already drained the stream. */
  readonly body?: unknown
  /** Express and Nest both put what the route matched here. */
  readonly params?: Record<string, string>
  /** Express rewrites `url` for a mounted handler and keeps the whole path here. */
  readonly originalUrl?: string
}

export type NodeHandlerOptions = {
  /**
   * The origin this endpoint is reached at, e.g. `https://linktap.example`.
   * Required unless `originFromHeaders` is set.
   */
  readonly origin?: string
  /**
   * Derive the origin from `X-Forwarded-Proto`/`X-Forwarded-Host`, else `Host`.
   * Opt-in because those headers are the client's: the origin reaches the
   * publisher's own handlers as `context.url` and fixes what `checkTemplates`
   * counts as same-origin, so a spoofed one moves both.
   */
  readonly originFromHeaders?: boolean
  /** A conforming `POST` body is two short strings; anything past this is not one arriving slowly. */
  readonly maxBytes?: number
  readonly onInternalError?: ErrorReporter
}

export type NodeHandler = (request: NodeRequest, response: ServerResponse) => Promise<void>

const defaultMaxBytes = 64 * 1024

const allowedMethods = "GET, HEAD, POST, OPTIONS"

const internalErrorBody = JSON.stringify(internalErrorPayload)

const tooLargeBody = JSON.stringify({
  type: "error",
  version: PROTOCOL_VERSION,
  code: "INVALID_PARAMETER",
  message: "The request body is larger than this endpoint accepts."
})

/** A comma-separated proxy header names a chain; the first entry is the one nearest the client. */
const firstHeader = (value: string | ReadonlyArray<string> | undefined): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : (value as string | undefined)
  return typeof raw === "string" ? raw.split(",")[0]?.trim() : undefined
}

const isEncrypted = (request: NodeRequest): boolean =>
  (request.socket as { encrypted?: boolean } | undefined)?.encrypted === true

const derivedOrigin = (request: NodeRequest): string | undefined => {
  const host = firstHeader(request.headers["x-forwarded-host"]) ?? firstHeader(request.headers.host)
  if (host === undefined || host === "") return undefined

  // Any other scheme gives a URL with no origin of its own, and `"null"` is a
  // string a caller could otherwise make this build every request against.
  const forwarded = firstHeader(request.headers["x-forwarded-proto"])?.toLowerCase()
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : isEncrypted(request) ? "https" : "http"

  try {
    const origin = new URL(`${proto}://${host}`).origin
    return origin === "null" ? undefined : origin
  } catch {
    return undefined
  }
}

/**
 * Only the path and query come from the request. Resolving its target against
 * the origin instead would let `//evil.example/x` — a protocol-relative
 * reference Node hands over verbatim — replace the authority the publisher
 * declared, and `context.url` is what fixes same-origin for every linked action.
 */
const targetUrl = (request: NodeRequest, origin: string): URL => {
  const raw = request.originalUrl ?? request.url ?? "/"
  const url = new URL(origin)
  const at = raw.indexOf("?")

  url.pathname = at === -1 ? raw : raw.slice(0, at)
  url.search = at === -1 ? "" : raw.slice(at)
  return url
}

/** Hop-by-hop headers describe one connection, so they do not belong on the request the handlers see. */
const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
])

const headersOf = (request: NodeRequest): Headers => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || hopByHop.has(name)) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
  }
  return headers
}

type Body = { readonly ok: true; readonly text: string } | { readonly ok: false }

const tooLarge: Body = { ok: false }

const bodyOf = async (request: NodeRequest, maxBytes: number): Promise<Body> => {
  const parsed = request.body
  if (parsed !== undefined) {
    const text =
      typeof parsed === "string"
        ? parsed
        : parsed instanceof Uint8Array
          ? new TextDecoder().decode(parsed)
          : JSON.stringify(parsed)

    // The bound holds whoever read the body, so `maxBytes` means the same thing
    // in front of a parser as it does without one.
    return new TextEncoder().encode(text).byteLength > maxBytes ? tooLarge : { ok: true, text }
  }

  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = chunk as Uint8Array
    size += bytes.byteLength
    // Stop reading, but leave the socket alive: destroying it here would take
    // the connection down before the refusal could be written to it.
    if (size > maxBytes) return tooLarge
    chunks.push(bytes)
  }

  const joined = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(joined) }
}

const send = async (result: Response, response: ServerResponse, withBody: boolean): Promise<void> => {
  response.statusCode = result.status
  result.headers.forEach((value, name) => {
    response.setHeader(name, value)
  })

  const bytes = new Uint8Array(await result.arrayBuffer())
  // A HEAD carries the headers of the GET and none of its body.
  if (!withBody || bytes.byteLength === 0) response.end()
  else response.end(bytes)
}

const sendJson = (response: ServerResponse, status: number, body: string): void => {
  response.statusCode = status
  response.setHeader("Content-Type", "application/json")
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader("Cache-Control", "no-store")
  response.end(body)
}

export const toNodeHandler = (endpoint: SlipEndpoint, options: NodeHandlerOptions = {}): NodeHandler => {
  if (options.origin === undefined && options.originFromHeaders !== true) {
    throw new Error(
      "[cardano-slips] toNodeHandler needs the origin this endpoint is reached at, or originFromHeaders to derive it from the request"
    )
  }

  const fixedOrigin = options.origin
  if (fixedOrigin !== undefined) {
    try {
      new URL(fixedOrigin)
    } catch {
      throw new Error(`[cardano-slips] toNodeHandler was given an origin that is not a URL: ${fixedOrigin}`)
    }
  }

  const maxBytes = options.maxBytes ?? defaultMaxBytes
  const report = contained(options.onInternalError ?? reportToConsole)

  return async (request: NodeRequest, response: ServerResponse): Promise<void> => {
    try {
      const method = request.method ?? "GET"

      if (method === "OPTIONS") {
        await send(endpoint.OPTIONS(), response, true)
        return
      }

      if (method !== "GET" && method !== "HEAD" && method !== "POST") {
        response.statusCode = 405
        response.setHeader("Allow", allowedMethods)
        response.setHeader("Access-Control-Allow-Origin", "*")
        response.end()
        return
      }

      const origin = fixedOrigin ?? derivedOrigin(request)
      if (origin === undefined) {
        report("the request carried no host to build an origin from")
        sendJson(response, endpointErrorStatus.INTERNAL_ERROR, internalErrorBody)
        return
      }

      const url = targetUrl(request, origin)
      const params: RouteParams | undefined = request.params
      const context = params === undefined ? undefined : { params }
      const headers = headersOf(request)

      if (method === "GET" || method === "HEAD") {
        const built = new Request(url, { method: "GET", headers })
        await send(await endpoint.GET(built, context), response, method === "GET")
        return
      }

      const body = await bodyOf(request, maxBytes)
      if (!body.ok) {
        response.statusCode = endpointErrorStatus.INVALID_PARAMETER
        response.setHeader("Content-Type", "application/json")
        response.setHeader("Access-Control-Allow-Origin", "*")
        response.setHeader("Cache-Control", "no-store")
        // The rest of the body is never read, so this connection cannot be reused.
        response.setHeader("Connection", "close")
        response.end(tooLargeBody, () => {
          request.destroy()
        })
        return
      }

      // Whatever the framework said it was, the handlers decode it as JSON.
      headers.set("Content-Type", "application/json")
      const built = new Request(url, { method: "POST", headers, body: body.text })
      await send(await endpoint.POST(built, context), response, true)
    } catch (cause) {
      report("the node bridge could not answer this request", cause)
      if (!response.headersSent) sendJson(response, endpointErrorStatus.INTERNAL_ERROR, internalErrorBody)
      else response.end()
    }
  }
}
