/**
 * The two HTTP exchanges a client makes: `GET` for the Slip and `POST` for the
 * partial intent. Every way either can fail arrives as one error in the spec's
 * vocabulary, classified by the rules in "Failure responses".
 */
import {
  checkTemplates,
  classifyErrorCode,
  classifyStatus,
  decodePartialIntent,
  decodeSlip,
  decodeSlipError,
  fetchDomainMapping,
  type InsecureSlipUrl,
  type Network,
  type PartialIntent,
  PROTOCOL_VERSION,
  resolveSlipUrl,
  type Slip,
  type SlipErrorClass
} from "@cardano-slips/core"
import { Data, Effect, Either } from "effect"

export type ExchangeOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

const defaultTimeoutMs = 10_000

/**
 * `code` is a spec code, or one an endpoint sent that the spec does not define.
 * It is absent only where the body could not be read, and then `status` is all
 * there is to go on.
 */
export class ExchangeError extends Data.TaggedError("ExchangeError")<{
  readonly code?: string
  readonly errorClass: SlipErrorClass
  /** The endpoint's own words, present only when its failure body was readable. */
  readonly endpointMessage?: string
  readonly field?: string
  readonly status?: number
  /** Seconds, from `Retry-After`. */
  readonly retryAfter?: number
  /** For whoever integrates this; never put in front of a person. */
  readonly detail: string
}> {
  override get message(): string {
    return this.detail
  }
}

const clientFailure = (code: string, detail: string, status?: number): ExchangeError =>
  new ExchangeError({
    code,
    errorClass: classifyErrorCode(code),
    detail,
    ...(status === undefined ? {} : { status })
  })

/** Whole seconds or an HTTP date, per RFC 9110; anything else says nothing. */
const readRetryAfter = (header: string | null, now: number): number | undefined => {
  if (header === null) return undefined
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000))
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** A major version is checked before the shape, so a newer protocol is not reported as a broken one. */
const newerVersion = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null) return undefined
  const version = (body as Record<string, unknown>).version
  return typeof version === "string" && /^[1-9][0-9]*$/.test(version) && version !== PROTOCOL_VERSION
    ? version
    : undefined
}

const failureFrom = (response: Response, text: string): ExchangeError => {
  const status = response.status
  const retryAfter = readRetryAfter(response.headers.get("retry-after"), Date.now())
  const retry = retryAfter === undefined ? {} : { retryAfter }
  const body = parseJson(text)

  const version = newerVersion(body)
  if (version !== undefined) {
    return clientFailure("UNSUPPORTED_VERSION", `the failure body speaks version ${version}`, status)
  }

  const read = decodeSlipError(body)
  // Unreadable, so classified by status and never rendered: it is as likely an
  // intermediary's error page as the publisher's words.
  if (Either.isLeft(read)) {
    return new ExchangeError({
      errorClass: classifyStatus(status),
      status,
      detail: `answered ${status} with a body that is not a failure response`,
      ...retry
    })
  }

  return new ExchangeError({
    code: read.right.code,
    errorClass: classifyErrorCode(read.right.code),
    endpointMessage: read.right.message,
    status,
    detail: `answered ${status} ${read.right.code}`,
    ...(read.right.field === undefined ? {} : { field: read.right.field }),
    ...retry
  })
}

type Answer = { readonly response: Response; readonly text: string }

/**
 * One request, bounded in time as a whole. Anything that stops a usable
 * answer arriving — DNS, TLS, a refused CORS read, the clock — is `UNREACHABLE`.
 */
const exchange = (url: string, init: RequestInit, options: ExchangeOptions): Effect.Effect<Answer, ExchangeError> => {
  const call = options.fetch ?? globalThis.fetch
  const origin = new URL(url).origin
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await call(url, { ...init, signal, credentials: "omit", redirect: "follow" })
      return { response, text: await response.text() }
    },
    catch: (cause) => clientFailure("UNREACHABLE", `could not reach ${url}: ${String(cause)}`)
  }).pipe(
    Effect.timeout(options.timeoutMs ?? defaultTimeoutMs),
    Effect.catchTag("TimeoutException", () => Effect.fail(clientFailure("UNREACHABLE", `timed out on ${url}`))),
    Effect.filterOrFail(
      // A redirect to another origin would have the person dealing with someone the top bar does not name.
      ({ response }) => response.url === "" || new URL(response.url).origin === origin,
      ({ response }) => clientFailure("MALFORMED_RESPONSE", `${url} redirected to ${response.url}`)
    )
  )
}

const successBody = ({ response, text }: Answer): Effect.Effect<unknown, ExchangeError> => {
  if (response.status !== 200) return Effect.fail(failureFrom(response, text))
  const body = parseJson(text)
  if (body === undefined) {
    return Effect.fail(clientFailure("MALFORMED_RESPONSE", `${response.url} answered 200 with something not JSON`))
  }
  const version = newerVersion(body)
  if (version !== undefined) {
    return Effect.fail(clientFailure("UNSUPPORTED_VERSION", `the response speaks version ${version}`))
  }
  return Effect.succeed(body)
}

export type FetchedSlip = {
  readonly slip: Slip
  /** The endpoint the link resolved to. Every `href` resolves against it. */
  readonly discoveryUrl: string
}

/**
 * The link to a Slip a person can be shown, or why not. `slips.json` is read
 * first, because the link a person shares is not always the endpoint. A link
 * that is not `https:` fails as `InsecureSlipUrl`, before anything is fetched.
 */
export const fetchSlip = (
  link: string,
  options: ExchangeOptions = {}
): Effect.Effect<FetchedSlip, ExchangeError | InsecureSlipUrl> =>
  Effect.gen(function* () {
    const mapping = yield* fetchDomainMapping(link, options).pipe(
      Effect.catchTag("DomainMappingFailure", (failure) => Effect.fail(clientFailure(failure.code, failure.detail)))
    )
    const discoveryUrl = yield* resolveSlipUrl(link, mapping)

    const answer = yield* exchange(discoveryUrl, { method: "GET", headers: { accept: "application/json" } }, options)
    const body = yield* successBody(answer)

    const slip = decodeSlip(body)
    if (Either.isLeft(slip)) {
      return yield* Effect.fail(clientFailure("MALFORMED_RESPONSE", `${discoveryUrl} did not answer with a Slip`))
    }

    const defects = checkTemplates(slip.right, discoveryUrl)
    if (defects.length > 0) {
      return yield* Effect.fail(
        clientFailure("MALFORMED_RESPONSE", `${discoveryUrl} answered a Slip with ${defects[0]?._tag ?? "a defect"}`)
      )
    }

    return { slip: slip.right, discoveryUrl }
  })

export type IntentRequest = {
  /** Absolute, as `SlipCard` hands it over. */
  readonly href: string
  readonly changeAddress: string
  readonly network: Network
}

/**
 * The partial intent for one action. The body is the change address and the
 * network and nothing else: Mode A never tells an endpoint what a wallet holds.
 */
export const requestIntent = (
  { changeAddress, href, network }: IntentRequest,
  options: ExchangeOptions = {}
): Effect.Effect<PartialIntent, ExchangeError> =>
  Effect.gen(function* () {
    const answer = yield* exchange(
      href,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ changeAddress, network })
      },
      options
    )
    const body = yield* successBody(answer)

    const intent = decodePartialIntent(body)
    if (Either.isLeft(intent)) {
      return yield* Effect.fail(clientFailure("MALFORMED_RESPONSE", `${href} did not answer with a partial intent`))
    }
    return intent.right
  })
