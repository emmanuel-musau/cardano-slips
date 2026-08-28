/**
 * The failure body and the code vocabulary. Two schemas for one body because
 * the obligation differs by party: an endpoint may send only the eight codes
 * version 1 allows, a client reads any well-shaped one (ADR-0009).
 */
import { Schema } from "effect"

/** What a client does next. Fixed by the spec and never transmitted. */
export type SlipErrorClass = "request" | "terminal" | "transient"

export const EndpointErrorCode = Schema.Literal(
  "INVALID_PARAMETER",
  "WRONG_NETWORK",
  "NOT_FOUND",
  "UNAVAILABLE",
  "EXPIRED",
  "RATE_LIMITED",
  "UPSTREAM_FAILURE",
  "INTERNAL_ERROR"
)
export type EndpointErrorCode = typeof EndpointErrorCode.Type

/** `WRONG_NETWORK` appears here and above: it is the one code both parties raise. */
export const ClientErrorCode = Schema.Literal(
  "WRONG_NETWORK",
  "INSUFFICIENT_FUNDS",
  "MALFORMED_RESPONSE",
  "UNSUPPORTED_VERSION",
  "UNSUPPORTED_BUILD_MODE",
  "CANNOT_BALANCE",
  "EFFECTS_MISMATCH",
  "INTENT_EXPIRED",
  "UNREACHABLE"
)
export type ClientErrorCode = typeof ClientErrorCode.Type

export type SlipErrorCode = EndpointErrorCode | ClientErrorCode

/** Exhaustive by type: adding a code above without classifying it here fails to compile. */
export const errorCodeClass: Readonly<Record<SlipErrorCode, SlipErrorClass>> = {
  INVALID_PARAMETER: "request",
  WRONG_NETWORK: "request",
  INSUFFICIENT_FUNDS: "request",
  NOT_FOUND: "terminal",
  UNAVAILABLE: "terminal",
  EXPIRED: "terminal",
  MALFORMED_RESPONSE: "terminal",
  UNSUPPORTED_VERSION: "terminal",
  UNSUPPORTED_BUILD_MODE: "terminal",
  CANNOT_BALANCE: "terminal",
  EFFECTS_MISMATCH: "terminal",
  RATE_LIMITED: "transient",
  UPSTREAM_FAILURE: "transient",
  INTERNAL_ERROR: "transient",
  INTENT_EXPIRED: "transient",
  UNREACHABLE: "transient"
}

export const endpointErrorStatus: Readonly<Record<EndpointErrorCode, number>> = {
  INVALID_PARAMETER: 400,
  WRONG_NETWORK: 400,
  NOT_FOUND: 404,
  UNAVAILABLE: 409,
  EXPIRED: 410,
  RATE_LIMITED: 429,
  UPSTREAM_FAILURE: 502,
  INTERNAL_ERROR: 500
}

/** `hasOwnProperty`, so a code named after something on Object's prototype is not found. */
export const isSlipErrorCode = (code: string): code is SlipErrorCode =>
  Object.prototype.hasOwnProperty.call(errorCodeClass, code)

/**
 * An undefined code is terminal, and a disagreeing status does not override it:
 * the other two classes authorise the client to act again, which is not safe on
 * a failure whose meaning is unknown.
 */
export const classifyErrorCode = (code: string): SlipErrorClass =>
  isSlipErrorCode(code) ? errorCodeClass[code] : "terminal"

/**
 * For a body that could not be read at all, and so may not be rendered — it is
 * as likely to be an intermediary's error page as the publisher's words.
 */
export const classifyStatus = (status: number): SlipErrorClass =>
  status === 429 || status >= 500 ? "transient" : "terminal"

const ErrorCodeShape = Schema.String.pipe(Schema.pattern(/^[A-Z][A-Z0-9_]{2,47}$/))

/** `field` names a rejected submitted value, so it is meaningless unless one was rejected. */
const fieldNamesTheRejectedParameter = (value: {
  readonly code: string
  readonly field?: string | undefined
}): boolean => value.field === undefined || value.code === "INVALID_PARAMETER"

const fieldMessage = "`field` names the rejected parameter, so it belongs only on `INVALID_PARAMETER`"

const errorResponseFields = {
  type: Schema.Literal("error"),
  version: Schema.String.pipe(Schema.pattern(/^[1-9][0-9]*$/)),
  // That `message` carries no markup, stack trace or internal hostname is a
  // rule about what a string says, so no schema can hold a publisher to it.
  message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  field: Schema.optionalWith(Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9_]{0,31}$/)), { exact: true })
}

const strictly = { onExcessProperty: "error", errors: "all" } as const

/** What a client validates against: `code` constrained to the shape of a code, not to the list. */
export const SlipErrorResponse = Schema.Struct({ ...errorResponseFields, code: ErrorCodeShape })
  .pipe(Schema.filter((body) => (fieldNamesTheRejectedParameter(body) ? undefined : fieldMessage)))
  .annotations({ identifier: "SlipErrorResponse", parseOptions: strictly })
export type SlipErrorResponse = typeof SlipErrorResponse.Type

/** What an endpoint is held to. `server` validates its own output against this. */
export const EndpointErrorResponse = Schema.Struct({ ...errorResponseFields, code: EndpointErrorCode })
  .pipe(Schema.filter((body) => (fieldNamesTheRejectedParameter(body) ? undefined : fieldMessage)))
  .annotations({ identifier: "EndpointErrorResponse", parseOptions: strictly })
export type EndpointErrorResponse = typeof EndpointErrorResponse.Type

export const decodeSlipError = Schema.decodeUnknownEither(SlipErrorResponse)

export const decodeEndpointError = Schema.decodeUnknownEither(EndpointErrorResponse)
