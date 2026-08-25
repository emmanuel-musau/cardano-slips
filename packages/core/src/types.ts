/**
 * The GET discovery response — the executable form of
 * `spec/CIP-XXXX/schemas/slip-get-response.schema.json`, held to the same
 * examples by `test/get-discovery.test.ts`.
 *
 * Rules needing context a payload does not carry (same-origin `href`, `max`
 * against `min`, placeholders against parameters) are not checked here. See
 * `spec/examples/README.md`.
 */
import { Schema } from "effect"

/** One URL speaks one major version, so this is a constant and not a negotiation (ADR-0009). */
export const PROTOCOL_VERSION = "1"

/** Named, not numeric: CIP-30's network id cannot separate preprod from preview. */
export const Network = Schema.Literal("mainnet", "preprod", "preview")
export type Network = typeof Network.Type

/** Absent means `local`. Version 1 implements `local` only and reserves `server`. */
export const BuildMode = Schema.Literal("local", "server")
export type BuildMode = typeof BuildMode.Type

/** No `data:` URIs — a link unfurler has to fetch this too. */
export const IconUrl = Schema.String.pipe(Schema.pattern(/^https:\/\/[^\s]+$/), Schema.maxLength(2048))

/** That it resolves to the endpoint's own origin needs the request URL, so it is checked elsewhere. */
export const Href = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(2048),
  Schema.pattern(/^(\/[^\s]*|https:\/\/[^\s]+)$/)
)

/** Matches the `{placeholder}` it fills. */
export const ParameterName = Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9_]{0,31}$/))

/** `code` is open, unlike a failure code: nothing acts on it. */
export const Reason = Schema.Struct({
  message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  code: Schema.optionalWith(Schema.String.pipe(Schema.pattern(/^[A-Z][A-Z0-9_]{2,47}$/)), { exact: true })
})
export type Reason = typeof Reason.Type

const availabilityIsCoherent = (value: {
  readonly disabled?: boolean | undefined
  readonly reason?: Reason | undefined
}): boolean => (value.disabled === true) === (value.reason !== undefined)

const availabilityMessage =
  "`disabled: true` and `reason` travel together: a closed Slip must say why, and a reason means nothing while something is still open"

const availabilityFields = {
  disabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
  reason: Schema.optionalWith(Reason, { exact: true })
}

const parameterFields = {
  name: ParameterName,
  label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(48)),
  required: Schema.optionalWith(Schema.Boolean, { exact: true })
}

/** Text bounds are character counts; a number parameter's bound the value itself. */
const TextLength = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))

export const TextParameter = Schema.Struct({
  ...parameterFields,
  type: Schema.Literal("text"),
  min: Schema.optionalWith(TextLength, { exact: true }),
  max: Schema.optionalWith(TextLength, { exact: true })
})
export type TextParameter = typeof TextParameter.Type

export const NumberParameter = Schema.Struct({
  ...parameterFields,
  type: Schema.Literal("number"),
  min: Schema.optionalWith(Schema.Number, { exact: true }),
  max: Schema.optionalWith(Schema.Number, { exact: true })
})
export type NumberParameter = typeof NumberParameter.Type

export const ParameterOption = Schema.Struct({
  label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(48)),
  value: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128))
})
export type ParameterOption = typeof ParameterOption.Type

export const SelectParameter = Schema.Struct({
  ...parameterFields,
  type: Schema.Literal("select"),
  options: Schema.Array(ParameterOption).pipe(Schema.minItems(1), Schema.maxItems(20))
})
export type SelectParameter = typeof SelectParameter.Type

/**
 * A union on `type` is what enforces the three rules the JSON Schema spends
 * conditionals on — options required on `select` and undeclared anywhere else,
 * bounds undeclared on `select` — and it narrows for consumers.
 */
export const Parameter = Schema.Union(TextParameter, NumberParameter, SelectParameter)
export type Parameter = typeof Parameter.Type

export const LinkedAction = Schema.Struct({
  label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  href: Href,
  parameters: Schema.optionalWith(Schema.Array(Parameter).pipe(Schema.minItems(1), Schema.maxItems(8)), {
    exact: true
  }),
  ...availabilityFields
}).pipe(Schema.filter((action) => (availabilityIsCoherent(action) ? undefined : availabilityMessage)))
export type LinkedAction = typeof LinkedAction.Type

/**
 * `onExcessProperty: "error"` is annotated rather than left to the caller, and
 * reaches every nested struct. A member silently ignored is a claim about the
 * transaction nothing checked — the rule is also why the protocol has no minors.
 */
export const Slip = Schema.Struct({
  type: Schema.Literal("slip"),
  version: Schema.String.pipe(Schema.pattern(/^[1-9][0-9]*$/)),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
  icon: IconUrl,
  label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(48)),
  network: Network,
  build: Schema.optionalWith(BuildMode, { exact: true }),
  links: Schema.optionalWith(
    Schema.Struct({
      actions: Schema.Array(LinkedAction).pipe(Schema.minItems(1), Schema.maxItems(3))
    }),
    { exact: true }
  ),
  ...availabilityFields
})
  .pipe(Schema.filter((slip) => (availabilityIsCoherent(slip) ? undefined : availabilityMessage)))
  .annotations({
    identifier: "Slip",
    parseOptions: { onExcessProperty: "error", errors: "all" }
  })
export type Slip = typeof Slip.Type

/** `Either`, not a throw: this runs on whatever an endpoint chose to send. */
export const decodeSlip = Schema.decodeUnknownEither(Slip)
