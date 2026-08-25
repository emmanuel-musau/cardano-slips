/**
 * The partial intent a Slip endpoint returns from POST — the executable form of
 * `spec/CIP-XXXX/schemas/slip-partial-intent.schema.json`, held to the same
 * examples by `test/partial-intent.test.ts`.
 *
 * Rules needing context a payload does not carry (an address against the Slip's
 * network, `validUntil` against the clock, one asset named twice in an output)
 * are not checked here. See `spec/examples/README.md`.
 */
import { Schema } from "effect"

/**
 * Integer base units, in decimal, as a string. A JSON number cannot carry them:
 * a large asset quantity does not survive a double, and `12.5` counts nothing.
 */
export const Quantity = Schema.String.pipe(Schema.pattern(/^(0|[1-9][0-9]{0,19})$/))

/** A zero of a native asset is the absence of it, so an asset quantity starts at one. */
export const PositiveQuantity = Schema.String.pipe(Schema.pattern(/^[1-9][0-9]{0,19}$/))

/** Bech32 payment address per CIP-19. Which network it encodes is checked against the Slip's. */
export const PaymentAddress = Schema.String.pipe(
  Schema.pattern(/^addr(_test)?1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{45,110}$/)
)

export const PolicyId = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{56}$/))

/** Empty is a policy's unnamed asset. Never a ticker: a ticker displays an on-chain name, it is not the name. */
export const AssetName = Schema.String.pipe(Schema.pattern(/^([0-9a-f]{2}){0,32}$/))

/** The shape passes `2026-02-31T00:00:00Z`, which JavaScript then reads as 3 March. */
const namesARealInstant = (value: string): boolean => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === `${value.slice(0, -1)}.000Z`
}

/** UTC to the second: a deadline is compared, not displayed, and one written two ways is two deadlines. */
export const Instant = Schema.String.pipe(
  Schema.pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/),
  Schema.filter(namesARealInstant)
)

export const Asset = Schema.Struct({
  policyId: PolicyId,
  assetName: AssetName,
  quantity: PositiveQuantity
})
export type Asset = typeof Asset.Type

export const Output = Schema.Struct({
  address: PaymentAddress,
  // A floor. Below the protocol minimum the client raises it and shows the
  // difference as an effect of its own, so `"0"` asks for the minimum and no more.
  lovelace: Quantity,
  assets: Schema.optionalWith(Schema.Array(Asset).pipe(Schema.minItems(1), Schema.maxItems(16)), { exact: true })
})
export type Output = typeof Output.Type

export const PoolId = Schema.String.pipe(Schema.pattern(/^pool1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{45,60}$/))

/** A bech32 DRep id per CIP-129, or one of the two predefined votes. */
export const DRep = Schema.Union(
  Schema.String.pipe(Schema.pattern(/^drep1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{45,90}$/)),
  Schema.Literal("abstain", "noConfidence")
)
export type DRep = typeof DRep.Type

export const StakeRegistration = Schema.Struct({ type: Schema.Literal("stakeRegistration") })
export const StakeDeregistration = Schema.Struct({ type: Schema.Literal("stakeDeregistration") })
export const StakeDelegation = Schema.Struct({ type: Schema.Literal("stakeDelegation"), poolId: PoolId })
export const VoteDelegation = Schema.Struct({ type: Schema.Literal("voteDelegation"), drep: DRep })

/**
 * A union on `type` is what enforces the three rules the JSON Schema spends
 * conditionals on — `poolId` only on `stakeDelegation`, `drep` only on
 * `voteDelegation`, neither on a registration — and it narrows for consumers.
 *
 * No deposit, no stake credential: each is fixed by a protocol parameter or by
 * the wallet, so there is no field here in which an endpoint could state one wrongly.
 */
export const Certificate = Schema.Union(StakeRegistration, StakeDeregistration, StakeDelegation, VoteDelegation)
export type Certificate = typeof Certificate.Type

const doesSomething = (intent: {
  readonly outputs?: unknown
  readonly certificates?: unknown
  readonly withdrawRewards?: unknown
}): boolean => intent.outputs !== undefined || intent.certificates !== undefined || intent.withdrawRewards !== undefined

const nothingToDo =
  "an intent MUST carry at least one of `outputs`, `certificates` or `withdrawRewards`: a transaction that does nothing still costs a fee"

export const Intent = Schema.Struct({
  outputs: Schema.optionalWith(Schema.Array(Output).pipe(Schema.minItems(1), Schema.maxItems(16)), { exact: true }),
  certificates: Schema.optionalWith(Schema.Array(Certificate).pipe(Schema.minItems(1), Schema.maxItems(8)), {
    exact: true
  }),
  // No amount: a withdrawal takes the whole reward balance, and only the client can know it.
  withdrawRewards: Schema.optionalWith(Schema.Boolean, { exact: true }),
  validUntil: Instant
}).pipe(Schema.filter((intent) => (doesSomething(intent) ? undefined : nothingToDo)))
export type Intent = typeof Intent.Type

/**
 * `onExcessProperty: "error"` reaches every nested struct, which is what keeps
 * a declared fee or a declared deposit off the wire rather than ignored.
 */
export const PartialIntent = Schema.Struct({
  type: Schema.Literal("partial"),
  version: Schema.String.pipe(Schema.pattern(/^[1-9][0-9]*$/)),
  intent: Intent,
  // A claim shown alongside the derived effects, never in place of them. That it
  // carries no markup or internal detail is a rule about what a string says.
  message: Schema.optionalWith(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)), { exact: true })
}).annotations({
  identifier: "PartialIntent",
  parseOptions: { onExcessProperty: "error", errors: "all" }
})
export type PartialIntent = typeof PartialIntent.Type

/** `Either`, not a throw: this runs on whatever an endpoint chose to send. */
export const decodePartialIntent = Schema.decodeUnknownEither(PartialIntent)
