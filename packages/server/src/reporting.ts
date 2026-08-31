/**
 * Where a defect in an endpoint's own workings goes. Shared by `defineSlip` and
 * the Node bridge so a change to what a person is told cannot reach one and
 * miss the other.
 */
import { PROTOCOL_VERSION } from "@cardano-slips/core"

export type ErrorReporter = (detail: string, cause?: unknown) => void

/** The one body these modules can always send: a constant cannot be malformed. */
export const internalErrorPayload = {
  type: "error",
  version: PROTOCOL_VERSION,
  code: "INTERNAL_ERROR",
  message: "The endpoint could not answer this request."
} as const

// The default has to be loud: a defect reported nowhere is one a publisher
// meets in a stranger's wallet instead of in their own deploy log.
/* eslint-disable no-console */
export const reportToConsole: ErrorReporter = (detail, cause) => {
  const line = `[cardano-slips] ${detail}`
  if (cause === undefined) console.error(line)
  else console.error(line, cause)
}
/* eslint-enable no-console */

/**
 * A publisher's reporter is their code and can throw. Uncontained, the failure
 * this exists to hide becomes the failure it causes.
 */
export const contained =
  (configured: ErrorReporter): ErrorReporter =>
  (detail, cause) => {
    try {
      configured(detail, cause)
    } catch (reporterFailure) {
      if (configured !== reportToConsole) reportToConsole(detail, cause)
      reportToConsole("the onInternalError callback threw", reporterFailure)
    }
  }
