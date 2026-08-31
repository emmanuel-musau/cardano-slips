/**
 * The bridge from Node's `IncomingMessage`/`ServerResponse` to the Web handlers
 * `defineSlip` returns, for NestJS, Express and Fastify. A runtime built on
 * `Request`/`Response` needs nothing from this file.
 */
import type { IncomingMessage, ServerResponse } from "node:http"

import { PROTOCOL_VERSION } from "@cardano-slips/core"

import type { RouteParams, SlipEndpoint } from "../define-slip.js"

export type NodeRequest = IncomingMessage & {
  /** A body parser leaves the parsed value here, having already drained the stream. */
  readonly body?: unknown
  /** Express and Nest both put what the route matched here. */
  readonly params?: Record<string, string>
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
  readonly onInternalError?: (detail: string, cause?: unknown) => void
}

export type NodeHandler = (request: NodeRequest, response: ServerResponse) => Promise<void>

const defaultMaxBytes = 64 * 1024

const allowedMethods = "GET, POST, OPTIONS"

/** The one body this module can always send: a constant cannot be malformed. */
const internalErrorBody = JSON.stringify({
  type: "error",
  version: PROTOCOL_VERSION,
  code: "INTERNAL_ERROR",
  message: "The endpoint could not answer this request."
})

const tooLargeBody = JSON.stringify({
  type: "error",
  version: PROTOCOL_VERSION,
  code: "INVALID_PARAMETER",
  message: "The request body is larger than this endpoint accepts."
})

/* eslint-disable no-console */
const reportToConsole = (detail: string, cause?: unknown): void => {
  const line = `[cardano-slips] ${detail}`
  if (cause === undefined) console.error(line)
  else console.error(line, cause)
}
/* eslint-enable no-console */

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

  const proto = firstHeader(request.headers["x-forwarded-proto"]) ?? (isEncrypted(request) ? "https" : "http")
  try {
    return new URL(`${proto}://${host}`).origin
  } catch {
    return undefined
  }
}

type Body = string | "tooLarge"

const bodyOf = async (request: NodeRequest, maxBytes: number): Promise<Body> => {
  const parsed = request.body
  if (parsed !== undefined) {
    if (typeof parsed === "string") return parsed
    if (parsed instanceof Uint8Array) return new TextDecoder().decode(parsed)
    return JSON.stringify(parsed)
  }

  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = chunk as Uint8Array
    size += bytes.byteLength
    // Stop reading, but leave the socket alive: destroying it here would take
    // the connection down before the refusal could be written to it.
    if (size > maxBytes) return "tooLarge"
    chunks.push(bytes)
  }

  const joined = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

const send = async (result: Response, response: ServerResponse): Promise<void> => {
  response.statusCode = result.status
  result.headers.forEach((value, name) => {
    response.setHeader(name, value)
  })

  const bytes = new Uint8Array(await result.arrayBuffer())
  if (bytes.byteLength === 0) response.end()
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
  const configured = options.onInternalError ?? reportToConsole

  const report = (detail: string, cause?: unknown): void => {
    try {
      configured(detail, cause)
    } catch (reporterFailure) {
      if (configured !== reportToConsole) reportToConsole(detail, cause)
      reportToConsole("the onInternalError callback threw", reporterFailure)
    }
  }

  return async (request: NodeRequest, response: ServerResponse): Promise<void> => {
    try {
      const method = request.method ?? "GET"

      if (method === "OPTIONS") {
        await send(endpoint.OPTIONS(), response)
        return
      }

      if (method !== "GET" && method !== "POST") {
        response.statusCode = 405
        response.setHeader("Allow", allowedMethods)
        response.setHeader("Access-Control-Allow-Origin", "*")
        response.end()
        return
      }

      const origin = fixedOrigin ?? derivedOrigin(request)
      if (origin === undefined) {
        report("the request carried no host to build an origin from")
        sendJson(response, 500, internalErrorBody)
        return
      }

      const params: RouteParams | undefined = request.params
      const context = params === undefined ? undefined : { params }

      if (method === "GET") {
        await send(await endpoint.GET(new Request(new URL(request.url ?? "/", origin)), context), response)
        return
      }

      const body = await bodyOf(request, maxBytes)
      if (body === "tooLarge") {
        response.statusCode = 400
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

      const built = new Request(new URL(request.url ?? "/", origin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      })
      await send(await endpoint.POST(built, context), response)
    } catch (cause) {
      report("the node bridge could not answer this request", cause)
      if (!response.headersSent) sendJson(response, 500, internalErrorBody)
      else response.end()
    }
  }
}
