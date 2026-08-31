/**
 * The `slips.json` domain mapping: the schema, the two rules JSON Schema cannot
 * express, the fetch, and the resolution from a shared human URL to the
 * endpoint behind it. Held to `spec/examples/slips-json/resolution.json`.
 */
import { Data, Effect, Either, Schema } from "effect"

import type { ClientErrorCode } from "./errors.js"

/**
 * Path-absolute: there is nowhere to write a scheme or an authority, so a rule
 * that sent a person to another host is unexpressible rather than forbidden. A
 * rule that must be checked is one an implementation can forget.
 */
export const PathTemplate = Schema.String.pipe(
  Schema.minLength(2),
  Schema.maxLength(512),
  Schema.pattern(/^(\/(\*\*$|\*|(?!\.{1,2}(?:\/|$))[^/*?#\s]+))+$/)
)

const wildcardsOf = (template: string): Array<string> =>
  template.split("/").filter((segment) => segment === "*" || segment === "**")

const wildcardsAgree = (rule: { readonly pathPattern: string; readonly apiPath: string }): boolean => {
  const pattern = wildcardsOf(rule.pathPattern)
  const api = wildcardsOf(rule.apiPath)
  return pattern.length === api.length && pattern.every((kind, index) => kind === api[index])
}

const wildcardsDisagree =
  "`apiPath` MUST carry the same wildcards, of the same kinds, in the same order, as its `pathPattern`: substitution is positional, so a rule whose two sides disagree has no defined result"

export const MappingRule = Schema.Struct({
  pathPattern: PathTemplate,
  apiPath: PathTemplate
}).pipe(Schema.filter((rule) => (wildcardsAgree(rule) ? undefined : wildcardsDisagree)))
export type MappingRule = typeof MappingRule.Type

const patternsAreDistinct = (file: { readonly rules: ReadonlyArray<MappingRule> }): boolean =>
  new Set(file.rules.map((rule) => rule.pathPattern)).size === file.rules.length

const duplicatePattern =
  "the same `pathPattern` twice: the second rule can never be reached, which makes it a mistake about the file rather than a choice within it"

/**
 * No `version` and no `type`: one origin may map a version 1 endpoint at one
 * path and a version 2 at another, and a fixed filename leaves nothing this
 * could be confused with.
 */
export const SlipsJson = Schema.Struct({
  rules: Schema.Array(MappingRule).pipe(Schema.minItems(1), Schema.maxItems(100))
})
  .pipe(Schema.filter((file) => (patternsAreDistinct(file) ? undefined : duplicatePattern)))
  .annotations({
    identifier: "SlipsJson",
    parseOptions: { onExcessProperty: "error", errors: "all" }
  })
export type SlipsJson = typeof SlipsJson.Type

export const decodeSlipsJson = Schema.decodeUnknownEither(SlipsJson)

/** An origin that serves no mapping is not the same as one whose mapping could not be read. */
export type DomainMapping =
  { readonly _tag: "Mapping"; readonly rules: ReadonlyArray<MappingRule> } | { readonly _tag: "Absent" }

export const absentMapping: DomainMapping = { _tag: "Absent" }

/** The scheme rule has no failure code in version 1: a link this refuses is not a Slip link at all. */
export class InsecureSlipUrl extends Data.TaggedError("InsecureSlipUrl")<{
  readonly url: string
  readonly detail: string
}> {}

export class DomainMappingFailure extends Data.TaggedError("DomainMappingFailure")<{
  readonly code: Extract<ClientErrorCode, "UNREACHABLE" | "MALFORMED_RESPONSE">
  readonly detail: string
}> {}

const unreachable = (detail: string): DomainMappingFailure => new DomainMappingFailure({ code: "UNREACHABLE", detail })

const malformed = (detail: string): DomainMappingFailure =>
  new DomainMappingFailure({ code: "MALFORMED_RESPONSE", detail })

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"

/**
 * `http:` is admitted on a loopback host for development and nowhere else. Every
 * guarantee here rests on knowing which origin answered, and over cleartext
 * there is no answer to that question.
 */
export const parseSlipUrl = (link: string): Either.Either<URL, InsecureSlipUrl> => {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return Either.left(new InsecureSlipUrl({ url: link, detail: "not a URL" }))
  }

  if (url.protocol === "https:") return Either.right(url)
  if (url.protocol === "http:" && isLoopback(url.hostname)) return Either.right(url)
  return Either.left(new InsecureSlipUrl({ url: link, detail: `refused scheme ${url.protocol}` }))
}

/** Served at the root of the origin the human path is on. */
export const mappingUrlFor = (origin: string): string => `${origin}/slips.json`

/**
 * A conforming file has a computable ceiling — 100 rules of two 512-character
 * templates — so anything past this is not a mapping being read slowly.
 */
const defaultMaxBytes = 256 * 1024

const defaultTimeoutMs = 10_000

export type MappingFetchOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

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
      throw new Error(`response exceeded ${maxBytes} bytes`)
    }
    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}

/**
 * `404` and `410` mean the origin has no mapping and the link is its own
 * endpoint. Everything else is `UNREACHABLE`, because guessing sends the person
 * to a human path that was never meant to answer.
 */
export const fetchDomainMapping = (
  link: string,
  options: MappingFetchOptions = {}
): Effect.Effect<DomainMapping, DomainMappingFailure | InsecureSlipUrl> =>
  Effect.gen(function* () {
    const url = yield* parseSlipUrl(link)
    const target = mappingUrlFor(url.origin)
    const call = options.fetch ?? globalThis.fetch
    const maxBytes = options.maxBytes ?? defaultMaxBytes

    const response = yield* Effect.tryPromise({
      try: (signal) => call(target, { signal, redirect: "follow", headers: { accept: "application/json" } }),
      catch: (cause) => unreachable(`could not fetch ${target}: ${String(cause)}`)
    }).pipe(
      Effect.timeout(options.timeoutMs ?? defaultTimeoutMs),
      Effect.catchTag("TimeoutException", () => Effect.fail(unreachable(`timed out fetching ${target}`)))
    )

    // A cross-origin redirect is the indirection a rule cannot express, arriving by a third route.
    const landed = response.url === "" ? target : response.url
    if (new URL(landed).origin !== url.origin) {
      return yield* Effect.fail(malformed(`${target} redirected to another origin: ${landed}`))
    }

    if (response.status === 404 || response.status === 410) return absentMapping

    if (!response.ok) {
      return yield* Effect.fail(unreachable(`${target} answered ${response.status}`))
    }

    const body = yield* Effect.tryPromise({
      try: () => readBounded(response, maxBytes),
      catch: (cause) => unreachable(`could not read ${target}: ${String(cause)}`)
    })

    const parsed = yield* Effect.try({
      try: () => JSON.parse(body) as unknown,
      catch: () => malformed(`${target} is not JSON`)
    })

    const file = yield* decodeSlipsJson(parsed).pipe(
      Either.mapLeft((error) => malformed(`${target} does not conform: ${error.message}`))
    )

    return { _tag: "Mapping", rules: file.rules } as const
  })

/** RFC 3986 §5.2.4, applied before matching so a crafted link cannot reach a rule by another name. */
const removeDotSegments = (path: string): string => {
  const kept: Array<string> = []
  for (const segment of path.split("/").slice(1)) {
    if (segment === ".") continue
    if (segment === "..") {
      kept.pop()
      continue
    }
    kept.push(segment)
  }
  return `/${kept.join("/")}`
}

/**
 * Segments are compared as they arrive — case-sensitively, undecoded, and with a
 * trailing slash meaning what it says. A client that decoded first would let an
 * encoded `/` split a path and reach a rule the publisher wrote for something else.
 */
const capture = (pattern: string, path: string): Array<string> | undefined => {
  const expected = pattern.split("/").slice(1)
  const actual = path.split("/").slice(1)
  const captured: Array<string> = []

  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index]

    if (segment === "**") {
      const rest = actual.slice(index)
      // One or more, and never an empty one.
      if (rest.length === 0 || rest.some((part) => part === "")) return undefined
      captured.push(rest.join("/"))
      return captured
    }

    const part = actual[index]
    if (part === undefined || part === "") return undefined
    if (segment === "*") {
      captured.push(part)
      continue
    }
    if (segment !== part) return undefined
  }

  return actual.length === expected.length ? captured : undefined
}

/**
 * The path and query of a link in, the path and query of the endpoint out. Where
 * no rule matches, the path is its own endpoint — that is a publisher whose URLs
 * already are the endpoints, not a failure.
 */
export const resolvePath = (rules: ReadonlyArray<MappingRule>, target: string): string => {
  const at = target.indexOf("?")
  const query = at === -1 ? "" : target.slice(at)
  const path = removeDotSegments(at === -1 ? target : target.slice(0, at))

  for (const rule of rules) {
    const captured = capture(rule.pathPattern, path)
    if (captured === undefined) continue

    let index = 0
    // One hop. Iterating would make a loop expressible in a file no validator could reject.
    return rule.apiPath.replaceAll(/\*\*|\*/g, () => captured[index++] ?? "") + query
  }

  return path + query
}

/**
 * The origin comes from the link and never from the file, which is what makes
 * the same-origin constraint structural rather than a check.
 */
export const resolveSlipUrl = (link: string, mapping: DomainMapping): Either.Either<string, InsecureSlipUrl> =>
  Either.map(parseSlipUrl(link), (url) => {
    // An absent mapping is an empty rule set: the link is already its own endpoint.
    const rules = mapping._tag === "Mapping" ? mapping.rules : []
    return url.origin + resolvePath(rules, url.pathname + url.search)
  })
