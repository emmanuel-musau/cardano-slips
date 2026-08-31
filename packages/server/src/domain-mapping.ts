/**
 * `slips.json` — the human path a person shares, in front of the API path that
 * answers. Unlike a Slip response, a mapping is fixed at deploy, so a defect in
 * one is caught when this module loads rather than per request.
 */
import { decodeSlipsJson, type SlipsJson } from "@cardano-slips/core"
import { Either } from "effect"
import { TreeFormatter } from "effect/ParseResult"

/** The spec asks only that the file be cacheable; 300 seconds is what its example carries. */
const defaultMaxAge = 300

export type DomainMappingOptions = {
  readonly maxAge?: number
}

/** One method: a `GET` carrying only `Accept` is a simple request, so no preflight is ever sent for it. */
export type DomainMappingEndpoint = {
  readonly GET: () => Response
}

const rejected = (detail: string): Error =>
  new Error(`[cardano-slips] this slips.json is not one the spec allows: ${detail}`)

export const defineDomainMapping = (mapping: SlipsJson, options: DomainMappingOptions = {}): DomainMappingEndpoint => {
  const file = decodeSlipsJson(mapping)
  if (Either.isLeft(file)) throw rejected(TreeFormatter.formatErrorSync(file.left))

  const maxAge = options.maxAge ?? defaultMaxAge
  // A cache interval is read by a machine, and `max-age=1.5` names none.
  if (!Number.isSafeInteger(maxAge)) {
    throw rejected(`maxAge must be a whole number of seconds, and this gave ${String(maxAge)}`)
  }
  if (maxAge < 0) throw rejected(`maxAge cannot be negative, and this gave ${String(maxAge)}`)

  // Serialised from the decoded value rather than the caller's object, and once:
  // nothing about this file varies by requester.
  const body = JSON.stringify(file.right)

  return {
    GET: (): Response =>
      new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // A client runs in a page on an origin the publisher does not
          // control, and a file the browser withholds does not exist.
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": `public, max-age=${maxAge}`
        }
      })
  }
}
