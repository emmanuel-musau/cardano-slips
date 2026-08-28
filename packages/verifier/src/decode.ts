/**
 * CBOR in, a Conway transaction out, plus the byte range the commit is taken
 * over.
 *
 * Nothing here is skipped. Every body key, certificate type and output shape is
 * either modelled below or refused by name — ADR-0010's fail-closed rule, and
 * the reason an era that adds a field arrives as a refusal rather than as a
 * quietly missing effect.
 *
 * The reader raises internally and the boundary turns that back into an
 * `Either`: a recursive descent parser that threads a result type through every
 * step reads far worse than one that stops where the trouble is.
 */
import { Either } from "effect"

import type { CborEntry, CborValue, ReadOptions } from "./cbor.js"
import { isRefusal, permissive, readOne } from "./cbor.js"
import type { TransactionDecodeError } from "./decode-error.js"
import { refuse } from "./decode-error.js"

// ---------------------------------------------------------------------------
// What a transaction reads as
// ---------------------------------------------------------------------------

export type TransactionInput = { readonly transactionId: Uint8Array; readonly index: bigint }

export type Asset = { readonly name: Uint8Array; readonly quantity: bigint }
export type PolicyAssets = { readonly policyId: Uint8Array; readonly assets: ReadonlyArray<Asset> }
export type MultiAsset = ReadonlyArray<PolicyAssets>

export type Value = { readonly coin: bigint; readonly assets: MultiAsset }

export type DatumOption =
  | { readonly _tag: "DatumHash"; readonly hash: Uint8Array }
  | { readonly _tag: "InlineDatum"; readonly bytes: Uint8Array }

/**
 * `form` is the CBOR major type this output arrived as, kept because that is
 * all that separates the two shapes and reading one as the other produces a
 * plausible-looking wrong answer rather than an error.
 */
export type TransactionOutput = {
  readonly form: "legacy" | "post-alonzo"
  readonly address: Uint8Array
  readonly value: Value
  readonly datum: DatumOption | null
  readonly scriptRef: Uint8Array | null
}

export type Credential =
  { readonly _tag: "KeyHash"; readonly hash: Uint8Array } | { readonly _tag: "ScriptHash"; readonly hash: Uint8Array }

export type DRep =
  | { readonly _tag: "KeyHash"; readonly hash: Uint8Array }
  | { readonly _tag: "ScriptHash"; readonly hash: Uint8Array }
  | { readonly _tag: "Abstain" }
  | { readonly _tag: "NoConfidence" }

export type Anchor = { readonly url: string; readonly dataHash: Uint8Array }

export type UnitInterval = { readonly numerator: bigint; readonly denominator: bigint }

export type Relay =
  | {
      readonly _tag: "SingleHostAddress"
      readonly port: bigint | null
      readonly ipv4: Uint8Array | null
      readonly ipv6: Uint8Array | null
    }
  | { readonly _tag: "SingleHostName"; readonly port: bigint | null; readonly dnsName: string }
  | { readonly _tag: "MultiHostName"; readonly dnsName: string }

export type PoolMetadata = { readonly url: string; readonly hash: Uint8Array }

export type PoolParams = {
  readonly operator: Uint8Array
  readonly vrfKeyHash: Uint8Array
  readonly pledge: bigint
  readonly cost: bigint
  readonly margin: UnitInterval
  readonly rewardAccount: Uint8Array
  readonly owners: ReadonlyArray<Uint8Array>
  readonly relays: ReadonlyArray<Relay>
  readonly metadata: PoolMetadata | null
}

export type Certificate =
  | { readonly _tag: "StakeRegistration"; readonly credential: Credential }
  | { readonly _tag: "StakeDeregistration"; readonly credential: Credential }
  | { readonly _tag: "StakeDelegation"; readonly credential: Credential; readonly poolKeyHash: Uint8Array }
  | { readonly _tag: "PoolRegistration"; readonly params: PoolParams }
  | { readonly _tag: "PoolRetirement"; readonly poolKeyHash: Uint8Array; readonly epoch: bigint }
  | { readonly _tag: "Registration"; readonly credential: Credential; readonly deposit: bigint }
  | { readonly _tag: "Deregistration"; readonly credential: Credential; readonly refund: bigint }
  | { readonly _tag: "VoteDelegation"; readonly credential: Credential; readonly drep: DRep }
  | {
      readonly _tag: "StakeVoteDelegation"
      readonly credential: Credential
      readonly poolKeyHash: Uint8Array
      readonly drep: DRep
    }
  | {
      readonly _tag: "StakeRegistrationDelegation"
      readonly credential: Credential
      readonly poolKeyHash: Uint8Array
      readonly deposit: bigint
    }
  | {
      readonly _tag: "VoteRegistrationDelegation"
      readonly credential: Credential
      readonly drep: DRep
      readonly deposit: bigint
    }
  | {
      readonly _tag: "StakeVoteRegistrationDelegation"
      readonly credential: Credential
      readonly poolKeyHash: Uint8Array
      readonly drep: DRep
      readonly deposit: bigint
    }
  | { readonly _tag: "AuthorizeCommitteeHot"; readonly cold: Credential; readonly hot: Credential }
  | { readonly _tag: "ResignCommitteeCold"; readonly cold: Credential; readonly anchor: Anchor | null }
  | {
      readonly _tag: "RegisterDrep"
      readonly credential: Credential
      readonly deposit: bigint
      readonly anchor: Anchor | null
    }
  | { readonly _tag: "UnregisterDrep"; readonly credential: Credential; readonly refund: bigint }
  | { readonly _tag: "UpdateDrep"; readonly credential: Credential; readonly anchor: Anchor | null }

export type Withdrawal = { readonly rewardAccount: Uint8Array; readonly amount: bigint }

export type Voter = {
  readonly role: "committee-hot" | "drep" | "stake-pool"
  readonly credential: Credential
}

export type GovernanceActionId = { readonly transactionId: Uint8Array; readonly index: bigint }

export type Vote = "no" | "yes" | "abstain"

export type VotingProcedure = {
  readonly action: GovernanceActionId
  readonly vote: Vote
  readonly anchor: Anchor | null
}

export type VoterProcedures = { readonly voter: Voter; readonly votes: ReadonlyArray<VotingProcedure> }

export type GovernanceActionKind =
  | "parameter-change"
  | "hard-fork-initiation"
  | "treasury-withdrawals"
  | "no-confidence"
  | "update-committee"
  | "new-constitution"
  | "info"

/**
 * The action's kind is named; its arguments are kept as read rather than
 * interpreted. Nothing is dropped — a protocol parameter update is thirty-odd
 * fields whose meaning belongs to the ticket that renders them, and an index
 * outside the seven below is still refused.
 */
export type GovernanceAction = {
  readonly kind: GovernanceActionKind
  readonly arguments: ReadonlyArray<CborValue>
}

export type ProposalProcedure = {
  readonly deposit: bigint
  readonly rewardAccount: Uint8Array
  readonly action: GovernanceAction
  readonly anchor: Anchor
}

export type TransactionBody = {
  readonly inputs: ReadonlyArray<TransactionInput>
  readonly outputs: ReadonlyArray<TransactionOutput>
  readonly fee: bigint
  /** `invalid_hereafter`: the transaction is invalid from this slot on. */
  readonly validityIntervalEnd: bigint | null
  readonly certificates: ReadonlyArray<Certificate>
  readonly withdrawals: ReadonlyArray<Withdrawal>
  readonly auxiliaryDataHash: Uint8Array | null
  /** `invalid_before`: the transaction is invalid until this slot. */
  readonly validityIntervalStart: bigint | null
  readonly mint: MultiAsset
  readonly scriptDataHash: Uint8Array | null
  readonly collateralInputs: ReadonlyArray<TransactionInput>
  readonly requiredSigners: ReadonlyArray<Uint8Array>
  readonly networkId: bigint | null
  readonly collateralReturn: TransactionOutput | null
  readonly totalCollateral: bigint | null
  readonly referenceInputs: ReadonlyArray<TransactionInput>
  readonly votingProcedures: ReadonlyArray<VoterProcedures>
  readonly proposalProcedures: ReadonlyArray<ProposalProcedure>
  readonly currentTreasuryValue: bigint | null
  readonly donation: bigint | null
}

/** Where the body sits in the bytes the caller handed us, and the is-valid flag beside it. */
export type ExtractedBody = {
  readonly bodyBytes: Uint8Array
  readonly bodyRange: { readonly start: number; readonly end: number }
  /** Whether the transaction's scripts are expected to succeed — item 2 of the envelope. */
  readonly isValid: boolean
}

/**
 * `bodyBytes` is the body exactly as it arrived. The commit is BLAKE2b-256 over
 * those bytes and never over a re-encode, so that a body encoded in a way we
 * would not have chosen still hashes to the transaction id the chain computes.
 */
export type DecodedTransaction = ExtractedBody & { readonly body: TransactionBody }

// ---------------------------------------------------------------------------
// Reading one value at a time
// ---------------------------------------------------------------------------

/**
 * The only tags the Conway CDDL puts inside a transaction body: 258 wrapping a
 * set, 24 wrapping bytes that are themselves CBOR (an inline datum, a reference
 * script), and 30 wrapping a rational (a pool margin, a governance threshold).
 */
const bodyTags: ReadonlySet<bigint> = new Set([24n, 30n, 258n])
const strictBody: ReadOptions = { tags: bodyTags, simpleValues: "modelled" }

const malformed = (value: CborValue, expected: string): TransactionDecodeError =>
  refuse("MalformedField", value.span.start, `expected ${expected}, read a CBOR ${value._tag.toLowerCase()}`)

const asMap = (value: CborValue, expected: string): ReadonlyArray<CborEntry> => {
  if (value._tag !== "Map") throw malformed(value, expected)
  return value.entries
}

const asArray = (value: CborValue, expected: string, length?: number): ReadonlyArray<CborValue> => {
  if (value._tag !== "Array") throw malformed(value, expected)
  if (length !== undefined && value.items.length !== length) {
    throw refuse("MalformedField", value.span.start, `${expected} has ${length} items, read ${value.items.length}`)
  }
  return value.items
}

const asBytes = (value: CborValue, expected: string, length?: number): Uint8Array => {
  if (value._tag !== "Bytes") throw malformed(value, expected)
  if (length !== undefined && value.value.length !== length) {
    throw refuse("MalformedField", value.span.start, `${expected} is ${length} bytes, read ${value.value.length}`)
  }
  return value.value
}

const asText = (value: CborValue, expected: string): string => {
  if (value._tag !== "Text") throw malformed(value, expected)
  return value.value
}

const asInteger = (value: CborValue, expected: string): bigint => {
  if (value._tag !== "Integer") throw malformed(value, expected)
  return value.value
}

const asUnsigned = (value: CborValue, expected: string): bigint => {
  const read = asInteger(value, expected)
  if (read < 0n) throw refuse("MalformedField", value.span.start, `${expected} cannot be negative, read ${read}`)
  return read
}

/** `null` and an absent optional mean the same thing everywhere the CDDL writes `/ null`. */
const orNull = <A>(value: CborValue, read: (value: CborValue) => A): A | null =>
  value._tag === "Null" ? null : read(value)

/**
 * `set<a>` is `#6.258([* a])`. The bare array is the pre-Conway spelling, which
 * the ledger still accepts and which therefore still arrives.
 */
const asSet = (value: CborValue, expected: string): ReadonlyArray<CborValue> => {
  if (value._tag === "Tagged") {
    if (value.tag !== 258n)
      throw refuse("UnexpectedTag", value.span.start, `${expected} is a set, tagged 258, not ${value.tag}`)
    return asArray(value.value, expected)
  }
  return asArray(value, expected)
}

const readInput = (value: CborValue): TransactionInput => {
  const [transactionId, index] = asArray(value, "a transaction input", 2)
  return { transactionId: asBytes(transactionId, "a transaction id", 32), index: asUnsigned(index, "an output index") }
}

const readInputs = (value: CborValue, what: string): ReadonlyArray<TransactionInput> =>
  asSet(value, what).map(readInput)

const readMultiAsset = (value: CborValue, sign: "positive" | "non-zero"): MultiAsset =>
  asMap(value, "a multi-asset map").map(({ key, value: assets }) => ({
    policyId: asBytes(key, "a policy id", 28),
    assets: asMap(assets, "an asset map").map(({ key: name, value: quantity }) => {
      const read = asInteger(quantity, "an asset quantity")
      if (sign === "positive" && read <= 0n) {
        throw refuse("MalformedField", quantity.span.start, `an output holds a positive quantity, read ${read}`)
      }
      if (sign === "non-zero" && read === 0n) {
        throw refuse(
          "MalformedField",
          quantity.span.start,
          "minting zero of an asset has no effect and is not a thing the ledger writes"
        )
      }
      return { name: asBytes(name, "an asset name"), quantity: read }
    })
  }))

const readOutputValue = (value: CborValue): Value => {
  if (value._tag === "Integer") return { coin: asUnsigned(value, "a lovelace amount"), assets: [] }
  const [coin, assets] = asArray(value, "a value", 2)
  return { coin: asUnsigned(coin, "a lovelace amount"), assets: readMultiAsset(assets, "positive") }
}

const readDatumOption = (value: CborValue): DatumOption => {
  const items = asArray(value, "a datum option", 2)
  const kind = asUnsigned(items[0], "a datum option kind")
  if (kind === 0n) return { _tag: "DatumHash", hash: asBytes(items[1], "a datum hash", 32) }
  if (kind === 1n) {
    const wrapper = items[1]
    if (wrapper._tag !== "Tagged" || wrapper.tag !== 24n) {
      throw refuse("MalformedField", wrapper.span.start, "an inline datum is CBOR wrapped in tag 24")
    }
    return { _tag: "InlineDatum", bytes: asBytes(wrapper.value, "an inline datum") }
  }
  throw refuse("MalformedField", items[0].span.start, `a datum option is 0 or 1, read ${kind}`)
}

const readScriptRef = (value: CborValue): Uint8Array => {
  if (value._tag !== "Tagged" || value.tag !== 24n) {
    throw refuse("MalformedField", value.span.start, "a reference script is CBOR wrapped in tag 24")
  }
  return asBytes(value.value, "a reference script")
}

const readOutput = (value: CborValue): TransactionOutput => {
  if (value._tag === "Array") {
    const items = value.items
    if (items.length !== 2 && items.length !== 3) {
      throw refuse(
        "UnknownOutputForm",
        value.span.start,
        `a legacy output is [address, value, ? datum hash], read ${items.length} items`
      )
    }
    return {
      form: "legacy",
      address: asBytes(items[0], "an address"),
      value: readOutputValue(items[1]),
      datum: items.length === 3 ? { _tag: "DatumHash", hash: asBytes(items[2], "a datum hash", 32) } : null,
      scriptRef: null
    }
  }
  if (value._tag !== "Map") {
    throw refuse("UnknownOutputForm", value.span.start, "an output is either a legacy array or a post-alonzo map")
  }

  let address: Uint8Array | undefined
  let amount: Value | undefined
  let datum: DatumOption | null = null
  let scriptRef: Uint8Array | null = null
  const seen = new Set<bigint>()

  for (const { key, value: field } of value.entries) {
    const index = asUnsigned(key, "a post-alonzo output key")
    if (seen.has(index)) {
      throw refuse("MalformedField", key.span.start, `output key ${index} appears twice`)
    }
    seen.add(index)
    switch (index) {
      case 0n:
        address = asBytes(field, "an address")
        break
      case 1n:
        amount = readOutputValue(field)
        break
      case 2n:
        datum = readDatumOption(field)
        break
      case 3n:
        scriptRef = readScriptRef(field)
        break
      default:
        throw refuse("UnknownOutputKey", key.span.start, `post-alonzo output key ${index} is not modelled`)
    }
  }

  if (address === undefined) throw refuse("MalformedField", value.span.start, "a post-alonzo output has no address")
  if (amount === undefined) throw refuse("MalformedField", value.span.start, "a post-alonzo output has no value")
  return { form: "post-alonzo", address, value: amount, datum, scriptRef }
}

const readCredential = (value: CborValue): Credential => {
  const [kind, hash] = asArray(value, "a credential", 2)
  const index = asUnsigned(kind, "a credential kind")
  if (index === 0n) return { _tag: "KeyHash", hash: asBytes(hash, "a key hash", 28) }
  if (index === 1n) return { _tag: "ScriptHash", hash: asBytes(hash, "a script hash", 28) }
  throw refuse("MalformedField", kind.span.start, `a credential is 0 or 1, read ${index}`)
}

const readDRep = (value: CborValue): DRep => {
  const items = asArray(value, "a DRep")
  const kind = asUnsigned(items[0], "a DRep kind")
  if (kind === 0n) return { _tag: "KeyHash", hash: asBytes(items[1], "a DRep key hash", 28) }
  if (kind === 1n) return { _tag: "ScriptHash", hash: asBytes(items[1], "a DRep script hash", 28) }
  if (kind === 2n) return { _tag: "Abstain" }
  if (kind === 3n) return { _tag: "NoConfidence" }
  throw refuse("MalformedField", items[0].span.start, `a DRep is 0 through 3, read ${kind}`)
}

const readAnchor = (value: CborValue): Anchor => {
  const [url, hash] = asArray(value, "an anchor", 2)
  return { url: asText(url, "an anchor url"), dataHash: asBytes(hash, "an anchor data hash", 32) }
}

const readUnitInterval = (value: CborValue): UnitInterval => {
  if (value._tag !== "Tagged" || value.tag !== 30n) {
    throw refuse("MalformedField", value.span.start, "a unit interval is a rational tagged 30")
  }
  const [numerator, denominator] = asArray(value.value, "a unit interval", 2)
  return {
    numerator: asUnsigned(numerator, "a numerator"),
    denominator: asUnsigned(denominator, "a denominator")
  }
}

const readRelay = (value: CborValue): Relay => {
  const items = asArray(value, "a relay")
  const kind = asUnsigned(items[0], "a relay kind")
  if (kind === 0n) {
    return {
      _tag: "SingleHostAddress",
      port: orNull(items[1], (port) => asUnsigned(port, "a port")),
      ipv4: orNull(items[2], (address) => asBytes(address, "an IPv4 address", 4)),
      ipv6: orNull(items[3], (address) => asBytes(address, "an IPv6 address", 16))
    }
  }
  if (kind === 1n) {
    return {
      _tag: "SingleHostName",
      port: orNull(items[1], (port) => asUnsigned(port, "a port")),
      dnsName: asText(items[2], "a DNS name")
    }
  }
  if (kind === 2n) return { _tag: "MultiHostName", dnsName: asText(items[1], "a DNS name") }
  throw refuse("MalformedField", items[0].span.start, `a relay is 0, 1 or 2, read ${kind}`)
}

/** Pool parameters are spliced into the certificate array rather than nested, so this reads from an offset. */
const readPoolParams = (items: ReadonlyArray<CborValue>, from: number): PoolParams => ({
  operator: asBytes(items[from], "a pool key hash", 28),
  vrfKeyHash: asBytes(items[from + 1], "a VRF key hash", 32),
  pledge: asUnsigned(items[from + 2], "a pledge"),
  cost: asUnsigned(items[from + 3], "a pool cost"),
  margin: readUnitInterval(items[from + 4]),
  rewardAccount: asBytes(items[from + 5], "a reward account"),
  owners: asSet(items[from + 6], "the pool owners").map((owner) => asBytes(owner, "an owner key hash", 28)),
  relays: asArray(items[from + 7], "the pool relays").map(readRelay),
  metadata: orNull(items[from + 8], (metadata) => {
    const [url, hash] = asArray(metadata, "pool metadata", 2)
    return { url: asText(url, "a pool metadata url"), hash: asBytes(hash, "a pool metadata hash", 32) }
  })
})

const readCertificate = (value: CborValue): Certificate => {
  const items = asArray(value, "a certificate")
  if (items.length === 0) throw refuse("UnknownCertificateType", value.span.start, "a certificate is never empty")
  const kind = asUnsigned(items[0], "a certificate type")

  const arity = (expected: number): void => {
    if (items.length !== expected) {
      throw refuse(
        "MalformedField",
        value.span.start,
        `certificate type ${kind} has ${expected} items, read ${items.length}`
      )
    }
  }

  switch (kind) {
    case 0n:
      arity(2)
      return { _tag: "StakeRegistration", credential: readCredential(items[1]) }
    case 1n:
      arity(2)
      return { _tag: "StakeDeregistration", credential: readCredential(items[1]) }
    case 2n:
      arity(3)
      return {
        _tag: "StakeDelegation",
        credential: readCredential(items[1]),
        poolKeyHash: asBytes(items[2], "a pool key hash", 28)
      }
    case 3n:
      arity(10)
      return { _tag: "PoolRegistration", params: readPoolParams(items, 1) }
    case 4n:
      arity(3)
      return {
        _tag: "PoolRetirement",
        poolKeyHash: asBytes(items[1], "a pool key hash", 28),
        epoch: asUnsigned(items[2], "an epoch")
      }
    case 7n:
      arity(3)
      return { _tag: "Registration", credential: readCredential(items[1]), deposit: asUnsigned(items[2], "a deposit") }
    case 8n:
      arity(3)
      return { _tag: "Deregistration", credential: readCredential(items[1]), refund: asUnsigned(items[2], "a refund") }
    case 9n:
      arity(3)
      return { _tag: "VoteDelegation", credential: readCredential(items[1]), drep: readDRep(items[2]) }
    case 10n:
      arity(4)
      return {
        _tag: "StakeVoteDelegation",
        credential: readCredential(items[1]),
        poolKeyHash: asBytes(items[2], "a pool key hash", 28),
        drep: readDRep(items[3])
      }
    case 11n:
      arity(4)
      return {
        _tag: "StakeRegistrationDelegation",
        credential: readCredential(items[1]),
        poolKeyHash: asBytes(items[2], "a pool key hash", 28),
        deposit: asUnsigned(items[3], "a deposit")
      }
    case 12n:
      arity(4)
      return {
        _tag: "VoteRegistrationDelegation",
        credential: readCredential(items[1]),
        drep: readDRep(items[2]),
        deposit: asUnsigned(items[3], "a deposit")
      }
    case 13n:
      arity(5)
      return {
        _tag: "StakeVoteRegistrationDelegation",
        credential: readCredential(items[1]),
        poolKeyHash: asBytes(items[2], "a pool key hash", 28),
        drep: readDRep(items[3]),
        deposit: asUnsigned(items[4], "a deposit")
      }
    case 14n:
      arity(3)
      return { _tag: "AuthorizeCommitteeHot", cold: readCredential(items[1]), hot: readCredential(items[2]) }
    case 15n:
      arity(3)
      return { _tag: "ResignCommitteeCold", cold: readCredential(items[1]), anchor: orNull(items[2], readAnchor) }
    case 16n:
      arity(4)
      return {
        _tag: "RegisterDrep",
        credential: readCredential(items[1]),
        deposit: asUnsigned(items[2], "a deposit"),
        anchor: orNull(items[3], readAnchor)
      }
    case 17n:
      arity(3)
      return { _tag: "UnregisterDrep", credential: readCredential(items[1]), refund: asUnsigned(items[2], "a refund") }
    case 18n:
      arity(3)
      return { _tag: "UpdateDrep", credential: readCredential(items[1]), anchor: orNull(items[2], readAnchor) }
    default:
      throw refuse(
        "UnknownCertificateType",
        items[0].span.start,
        `certificate type ${kind} is not modelled; an era that adds one lands here`
      )
  }
}

const readVoter = (value: CborValue): Voter => {
  const [kind, hash] = asArray(value, "a voter", 2)
  const index = asUnsigned(kind, "a voter kind")
  switch (index) {
    case 0n:
      return { role: "committee-hot", credential: { _tag: "KeyHash", hash: asBytes(hash, "a key hash", 28) } }
    case 1n:
      return { role: "committee-hot", credential: { _tag: "ScriptHash", hash: asBytes(hash, "a script hash", 28) } }
    case 2n:
      return { role: "drep", credential: { _tag: "KeyHash", hash: asBytes(hash, "a key hash", 28) } }
    case 3n:
      return { role: "drep", credential: { _tag: "ScriptHash", hash: asBytes(hash, "a script hash", 28) } }
    case 4n:
      return { role: "stake-pool", credential: { _tag: "KeyHash", hash: asBytes(hash, "a key hash", 28) } }
    default:
      throw refuse("MalformedField", kind.span.start, `a voter is 0 through 4, read ${index}`)
  }
}

const readGovernanceActionId = (value: CborValue): GovernanceActionId => {
  const [transactionId, index] = asArray(value, "a governance action id", 2)
  return {
    transactionId: asBytes(transactionId, "a transaction id", 32),
    index: asUnsigned(index, "a governance action index")
  }
}

const votes: ReadonlyArray<Vote> = ["no", "yes", "abstain"]

const readVoterProcedures = ({ key, value }: CborEntry): VoterProcedures => ({
  voter: readVoter(key),
  votes: asMap(value, "the votes of one voter").map(({ key: action, value: procedure }) => {
    const [vote, anchor] = asArray(procedure, "a voting procedure", 2)
    const index = asUnsigned(vote, "a vote")
    if (index > 2n) throw refuse("MalformedField", vote.span.start, `a vote is 0, 1 or 2, read ${index}`)
    return {
      action: readGovernanceActionId(action),
      vote: votes[Number(index)],
      anchor: orNull(anchor, readAnchor)
    }
  })
})

const governanceActions: ReadonlyArray<GovernanceActionKind> = [
  "parameter-change",
  "hard-fork-initiation",
  "treasury-withdrawals",
  "no-confidence",
  "update-committee",
  "new-constitution",
  "info"
]

const readProposalProcedure = (value: CborValue): ProposalProcedure => {
  const [deposit, rewardAccount, action, anchor] = asArray(value, "a proposal procedure", 4)
  const items = asArray(action, "a governance action")
  const kind = asUnsigned(items[0], "a governance action kind")
  if (kind >= BigInt(governanceActions.length)) {
    throw refuse("UnknownGovernanceAction", items[0].span.start, `governance action ${kind} is not modelled`)
  }
  return {
    deposit: asUnsigned(deposit, "a proposal deposit"),
    rewardAccount: asBytes(rewardAccount, "a reward account"),
    action: { kind: governanceActions[Number(kind)], arguments: items.slice(1) },
    anchor: readAnchor(anchor)
  }
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

/** Every integer key the Conway body defines. A key outside this set is era drift and raises. */
const bodyKeys = new Set([0n, 1n, 2n, 3n, 4n, 5n, 7n, 8n, 9n, 11n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 21n, 22n])

const readBody = (value: CborValue): TransactionBody => {
  const fields = new Map<bigint, CborValue>()
  for (const { key, value: field } of asMap(value, "a transaction body")) {
    if (key._tag !== "Integer") {
      throw refuse(
        "BodyKeyNotAnInteger",
        key.span.start,
        `a body key is an integer, read a CBOR ${key._tag.toLowerCase()}`
      )
    }
    if (!bodyKeys.has(key.value)) {
      throw refuse(
        "UnknownBodyKey",
        key.span.start,
        `body key ${key.value} is not modelled; an era that adds one lands here`
      )
    }
    if (fields.has(key.value)) {
      throw refuse("DuplicateBodyKey", key.span.start, `body key ${key.value} appears twice`)
    }
    fields.set(key.value, field)
  }

  const at = <A>(key: bigint, read: (value: CborValue) => A): A | null => {
    const field = fields.get(key)
    return field === undefined ? null : read(field)
  }
  const listAt = <A>(key: bigint, read: (value: CborValue) => ReadonlyArray<A>): ReadonlyArray<A> => at(key, read) ?? []

  const inputs = fields.get(0n)
  const outputs = fields.get(1n)
  const fee = fields.get(2n)
  if (inputs === undefined) throw refuse("MalformedField", value.span.start, "a transaction body has no inputs")
  if (outputs === undefined) throw refuse("MalformedField", value.span.start, "a transaction body has no outputs")
  if (fee === undefined) throw refuse("MalformedField", value.span.start, "a transaction body has no fee")

  return {
    inputs: readInputs(inputs, "the inputs"),
    outputs: asArray(outputs, "the outputs").map(readOutput),
    fee: asUnsigned(fee, "the fee"),
    validityIntervalEnd: at(3n, (slot) => asUnsigned(slot, "invalid_hereafter")),
    certificates: listAt(4n, (field) => asSet(field, "the certificates").map(readCertificate)),
    withdrawals: listAt(5n, (field) =>
      asMap(field, "the withdrawals").map(({ key, value: amount }) => ({
        rewardAccount: asBytes(key, "a reward account"),
        amount: asUnsigned(amount, "a withdrawal amount")
      }))
    ),
    auxiliaryDataHash: at(7n, (hash) => asBytes(hash, "the auxiliary data hash", 32)),
    validityIntervalStart: at(8n, (slot) => asUnsigned(slot, "invalid_before")),
    mint: listAt(9n, (field) => readMultiAsset(field, "non-zero")),
    scriptDataHash: at(11n, (hash) => asBytes(hash, "the script data hash", 32)),
    collateralInputs: listAt(13n, (field) => readInputs(field, "the collateral inputs")),
    requiredSigners: listAt(14n, (field) =>
      asSet(field, "the required signers").map((signer) => asBytes(signer, "a required signer", 28))
    ),
    networkId: at(15n, (id) => {
      const read = asUnsigned(id, "the network id")
      if (read > 1n) throw refuse("MalformedField", id.span.start, `the network id is 0 or 1, read ${read}`)
      return read
    }),
    collateralReturn: at(16n, readOutput),
    totalCollateral: at(17n, (amount) => asUnsigned(amount, "the total collateral")),
    referenceInputs: listAt(18n, (field) => readInputs(field, "the reference inputs")),
    votingProcedures: listAt(19n, (field) => asMap(field, "the voting procedures").map(readVoterProcedures)),
    proposalProcedures: listAt(20n, (field) => asSet(field, "the proposal procedures").map(readProposalProcedure)),
    currentTreasuryValue: at(21n, (amount) => asUnsigned(amount, "the current treasury value")),
    donation: at(22n, (amount) => {
      const read = asUnsigned(amount, "the treasury donation")
      if (read === 0n)
        throw refuse(
          "MalformedField",
          amount.span.start,
          "a donation of zero has no effect and is not a thing the ledger writes"
        )
      return read
    })
  }
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

const extract = (bytes: Uint8Array): ExtractedBody => {
  // Read the envelope permissively: a tag we do not model inside a witness set
  // is not an effect, and refusing it would reject a valid transaction for
  // nothing. Only the body is read strictly, and that happens below.
  const envelope = readOne(bytes, 0, permissive)
  if (envelope.span.end !== bytes.length) {
    throw refuse(
      "TrailingBytes",
      envelope.span.end,
      `${bytes.length - envelope.span.end} byte(s) follow a complete transaction`
    )
  }
  if (envelope._tag !== "Array" || envelope.items.length !== 4) {
    const read = envelope._tag === "Array" ? `${envelope.items.length} items` : `a CBOR ${envelope._tag.toLowerCase()}`
    throw refuse(
      "NotAFourItemArray",
      0,
      `a Conway transaction is [body, witness set, is-valid, auxiliary data], read ${read}`
    )
  }

  const isValid = envelope.items[2]
  if (isValid._tag !== "Bool") {
    throw refuse("MalformedField", isValid.span.start, "the third item of a transaction is the is-valid flag")
  }

  const range = envelope.items[0].span
  return {
    bodyBytes: bytes.slice(range.start, range.end),
    bodyRange: { start: range.start, end: range.end },
    isValid: isValid.value
  }
}

const readTransaction = (bytes: Uint8Array): DecodedTransaction => {
  const extracted = extract(bytes)
  const parsed = readOne(bytes, extracted.bodyRange.start, strictBody)
  if (parsed._tag !== "Map") {
    throw refuse(
      "BodyNotAMap",
      extracted.bodyRange.start,
      `a transaction body is a map, read a CBOR ${parsed._tag.toLowerCase()}`
    )
  }
  return { ...extracted, body: readBody(parsed) }
}

const boundary = <A>(read: () => A): Either.Either<A, TransactionDecodeError> => {
  try {
    return Either.right(read())
  } catch (error) {
    if (isRefusal(error)) return Either.left(error)
    throw error
  }
}

/**
 * Where the body is, without asking what it says.
 *
 * Separate from `decodeTransaction` because the commit is defined on extraction
 * alone: CIP-0186 pins the rule against a body of `a0`, which is a well-formed
 * map and not a transaction the ledger would accept.
 */
export const extractTransactionBody = (bytes: Uint8Array): Either.Either<ExtractedBody, TransactionDecodeError> =>
  boundary(() => extract(bytes))

/**
 * The one way in. Every refusal is typed and carries the byte it happened at;
 * nothing throws past this boundary.
 */
export const decodeTransaction = (bytes: Uint8Array): Either.Either<DecodedTransaction, TransactionDecodeError> =>
  boundary(() => readTransaction(bytes))
