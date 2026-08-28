/**
 * `defineSlip` — two handlers in, a conforming Slip endpoint out.
 *
 * Everything a handler returns is decoded against the `core` schemas before a
 * response is built, so a publisher's mistake fails at their own deploy rather
 * than at a stranger's wallet. The failure path is validated the same way: a
 * body this protocol would reject is replaced, never sent.
 */
import { Either } from "effect"
import { TreeFormatter } from "effect/ParseResult"
import {
  addressIsOnNetwork,
  checkTemplates,
  decodeBuildRequest,
  decodeEndpointError,
  decodePartialIntent,
  decodeSlip,
  endpointErrorStatus,
  PROTOCOL_VERSION,
  type EndpointErrorCode,
  type Network,
  type PartialIntent,
  type Slip
} from "@cardano-slips/core"

/** What `get` returns: the discovery response, less the three values the endpoint states once. */
export type Discovery = Omit<Slip, "type" | "version" | "network">

/** What `post` returns: the publisher's side of a transaction, less the two constants. */
export type Build = Omit<PartialIntent, "type" | "version">

export type DiscoveryContext = {
  readonly request: Request
  /** Parameter values were substituted into the target before the request, so an endpoint reads them from here. */
  readonly url: URL
}

export type BuildContext = DiscoveryContext & {
  readonly changeAddress: string
  readonly network: Network
}

/**
 * A request that could not be answered. Distinct from a Slip that is `disabled`:
 * that one was served, and currently offers nothing to sign.
 */
export type SlipFailure = {
  readonly _tag: "SlipFailure"
  readonly code: EndpointErrorCode
  readonly message: string
  readonly field?: string
  readonly retryAfter?: number
}

/**
 * `message` is read by a person, so it carries no markup, no stack trace and no
 * name of anything inside the publisher's own systems. No schema can hold an
 * endpoint to that; it is a rule about what a string says.
 */
export const fail = (
  code: EndpointErrorCode,
  message: string,
  options?: { readonly field?: string; readonly retryAfter?: number }
): SlipFailure => ({
  _tag: "SlipFailure",
  code,
  message,
  ...(options?.field === undefined ? {} : { field: options.field }),
  ...(options?.retryAfter === undefined ? {} : { retryAfter: options.retryAfter })
})

const isFailure = (value: unknown): value is SlipFailure =>
  typeof value === "object" && value !== null && (value as { _tag?: unknown })._tag === "SlipFailure"

export type SlipDefinition = {
  /** Declared once. One URL serves one network, so a handler cannot state a different one. */
  readonly network: Network
  readonly get: (context: DiscoveryContext) => Discovery | SlipFailure | Promise<Discovery | SlipFailure>
  readonly post: (context: BuildContext) => Build | SlipFailure | Promise<Build | SlipFailure>
  /**
   * Where a defect in this endpoint's own output is reported — the only place
   * it goes, since none of it may reach the person. Defaults to `console.error`.
   */
  readonly onInternalError?: (detail: string, cause?: unknown) => void
}

/** Named for the exports a route file needs, so a publisher can destructure them straight out. */
export type SlipEndpoint = {
  readonly GET: (request: Request) => Promise<Response>
  readonly POST: (request: Request) => Promise<Response>
  readonly OPTIONS: () => Response
}

// The default has to be loud: a defect reported nowhere is one a publisher
// meets in a stranger's wallet instead of in their own deploy log.
/* eslint-disable no-console */
const reportToConsole = (detail: string, cause?: unknown): void => {
  const line = `[cardano-slips] ${detail}`
  if (cause === undefined) console.error(line)
  else console.error(line, cause)
}
/* eslint-enable no-console */

const json = (payload: unknown, status: number, cacheControl: string, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Without this a client on an origin the publisher does not control never
      // sees the body — including the failures a person could have corrected.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheControl,
      ...extra
    }
  })

/** The one body this module can always send: it is a constant, so nothing can make it malformed. */
const internalErrorBody = {
  type: "error",
  version: PROTOCOL_VERSION,
  code: "INTERNAL_ERROR",
  message: "The endpoint could not answer this request."
} as const

const internalError = (): Response => json(internalErrorBody, endpointErrorStatus.INTERNAL_ERROR, "no-store")

const failureResponse = (failure: SlipFailure, report: (detail: string, cause?: unknown) => void): Response => {
  const payload = {
    type: "error",
    version: PROTOCOL_VERSION,
    code: failure.code,
    message: failure.message,
    ...(failure.field === undefined ? {} : { field: failure.field })
  }

  // Held to the same bar as a success: a publisher's failure body can be
  // malformed too, and sending it would report their bug as the person's.
  const checked = decodeEndpointError(payload)
  if (Either.isLeft(checked)) {
    report(
      `the failure body this endpoint built is not one the spec allows: ${TreeFormatter.formatErrorSync(checked.left)}`
    )
    return internalError()
  }

  // A header is part of the response, so it is validated like the body. A
  // client waits the interval this names, and `Retry-After: NaN` names none —
  // RFC 9110 has delay-seconds as a non-negative integer. Both codes that reach
  // here are transient, so rejecting one costs the person nothing and shows the
  // publisher a bug that would otherwise leave silently.
  if (failure.retryAfter !== undefined && !Number.isSafeInteger(failure.retryAfter)) {
    report(`Retry-After must be a whole number of seconds, and this endpoint gave ${String(failure.retryAfter)}`)
    return internalError()
  }
  if (failure.retryAfter !== undefined && failure.retryAfter < 0) {
    report(`Retry-After cannot be negative, and this endpoint gave ${String(failure.retryAfter)}`)
    return internalError()
  }

  return json(
    payload,
    endpointErrorStatus[failure.code],
    "no-store",
    failure.retryAfter === undefined ? {} : { "Retry-After": String(failure.retryAfter) }
  )
}

export const defineSlip = (definition: SlipDefinition): SlipEndpoint => {
  const configured = definition.onInternalError ?? reportToConsole

  // A publisher's reporter is their code, and it can throw — a logger built
  // against an environment variable nobody set. Uncontained, the failure this
  // module exists to hide becomes the failure it causes: the exception leaves
  // `GET`, and the framework renders its own error page over it.
  const report = (detail: string, cause?: unknown): void => {
    try {
      configured(detail, cause)
    } catch (reporterFailure) {
      if (configured !== reportToConsole) reportToConsole(detail, cause)
      reportToConsole("the onInternalError callback threw", reporterFailure)
    }
  }

  const GET = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    let result: Discovery | SlipFailure
    try {
      result = await definition.get({ request, url })
    } catch (cause) {
      report("the get handler threw", cause)
      return internalError()
    }

    if (isFailure(result)) return failureResponse(result, report)

    // The constants last, so a handler cannot restate them.
    const payload = { ...result, type: "slip", version: PROTOCOL_VERSION, network: definition.network }

    const slip = decodeSlip(payload)
    if (Either.isLeft(slip)) {
      report(`this endpoint's discovery response is not a Slip: ${TreeFormatter.formatErrorSync(slip.left)}`)
      return internalError()
    }

    // The rules no schema reaches: they need the discovery URL, or a
    // comparison of two siblings.
    const defects = checkTemplates(slip.right, url.href)
    if (defects.length > 0) {
      report(`this endpoint's linked actions break the spec's rules: ${JSON.stringify(defects)}`)
      return internalError()
    }

    // A Slip nobody can use is still a 200 with a complete body. See `disabled`.
    return json(payload, 200, "public, max-age=60")
  }

  const POST = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    let submitted: unknown
    try {
      submitted = JSON.parse(await request.text())
    } catch {
      return failureResponse(fail("INVALID_PARAMETER", "The request body is not valid JSON."), report)
    }

    const built = decodeBuildRequest(submitted)
    if (Either.isLeft(built)) {
      // One message for all five rejections: the paths in a decode failure
      // describe our schema, and nothing internal goes to a person.
      return failureResponse(
        fail("INVALID_PARAMETER", "The request must carry a change address and a network, and nothing else."),
        report
      )
    }

    const { changeAddress, network } = built.right

    // Three statements of network have to agree, and each can be wrong on its
    // own: a stale card, a wallet switched between discovery and submission, an
    // address from another network.
    if (network !== definition.network) {
      return failureResponse(
        fail("WRONG_NETWORK", `This Slip is on ${definition.network}. Your wallet is on ${network}.`),
        report
      )
    }

    if (!addressIsOnNetwork(changeAddress, network)) {
      return failureResponse(fail("WRONG_NETWORK", `That change address is not a ${network} address.`), report)
    }

    let result: Build | SlipFailure
    try {
      result = await definition.post({ request, url, changeAddress, network })
    } catch (cause) {
      report("the post handler threw", cause)
      return internalError()
    }

    if (isFailure(result)) return failureResponse(result, report)

    const payload = { ...result, type: "partial", version: PROTOCOL_VERSION }

    const intent = decodePartialIntent(payload)
    if (Either.isLeft(intent)) {
      report(`this endpoint's partial intent is malformed: ${TreeFormatter.formatErrorSync(intent.left)}`)
      return internalError()
    }

    // Built for one person, against one address, and it expires.
    return json(payload, 200, "no-store")
  }

  /** A JSON body makes the POST non-simple, so without this it never leaves the browser. */
  const OPTIONS = (): Response =>
    new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    })

  return { GET, POST, OPTIONS }
}
