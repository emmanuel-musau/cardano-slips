import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Either, Schema } from "effect"
import { ArrayFormatter, TreeFormatter, type ParseError } from "effect/ParseResult"
import { describe, expect, it } from "vitest"

import { decodePartialIntent, PartialIntent, PROTOCOL_VERSION } from "../src/index.js"

/**
 * `decodePartialIntent` against the examples the CIP publishes. `valid/` must
 * decode, `invalid/schema/` must be rejected by the right member, and
 * `invalid/rule/` must decode — those break rules needing context no payload carries.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "partial")

const fixtures = (bucket: string): Array<string> =>
  readdirSync(join(examples, bucket)).filter((file) => file.endsWith(".json"))

const fixture = (bucket: string, file: string): unknown =>
  JSON.parse(readFileSync(join(examples, bucket, file), "utf8"))

const issues = (error: ParseError): Array<{ tag: string; path: string }> =>
  ArrayFormatter.formatErrorSync(error).map((issue) => ({ tag: issue._tag, path: issue.path.join("/") }))

const encode = Schema.encodeEither(PartialIntent)

/** Naming the issue and the path: a payload rejected for the wrong reason would still pass "it failed". */
const rejections: ReadonlyArray<{ file: string; tag: string; path: string }> = [
  { file: "wrong-type.json", tag: "Type", path: "type" },
  { file: "missing-intent.json", tag: "Missing", path: "intent" },
  { file: "undeclared-field.json", tag: "Unexpected", path: "fee" },
  { file: "message-too-long.json", tag: "Refinement", path: "message" },
  { file: "nothing-to-do.json", tag: "Refinement", path: "intent" },
  { file: "missing-valid-until.json", tag: "Missing", path: "intent/validUntil" },
  { file: "local-time.json", tag: "Refinement", path: "intent/validUntil" },
  { file: "numeric-quantity.json", tag: "Type", path: "intent/outputs/0/lovelace" },
  { file: "decimal-quantity.json", tag: "Refinement", path: "intent/outputs/0/lovelace" },
  { file: "negative-quantity.json", tag: "Refinement", path: "intent/outputs/0/lovelace" },
  { file: "asset-name-not-hex.json", tag: "Refinement", path: "intent/outputs/0/assets/0/assetName" },
  { file: "zero-asset-quantity.json", tag: "Refinement", path: "intent/outputs/0/assets/0/quantity" },
  { file: "unknown-certificate.json", tag: "Type", path: "intent/certificates/0/type" },
  { file: "delegation-without-pool.json", tag: "Missing", path: "intent/certificates/0/poolId" },
  { file: "pool-on-registration.json", tag: "Unexpected", path: "intent/certificates/0/poolId" },
  { file: "deposit-declared.json", tag: "Unexpected", path: "intent/certificates/0/deposit" }
]

describe("decoding the partial intent", () => {
  it.each(fixtures("valid"))("accepts %s", (file) => {
    const result = decodePartialIntent(fixture("valid", file))
    const failure = Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""
    expect(failure, failure).toBe("")
  })

  it.each(fixtures("valid"))("round-trips %s back to the bytes it arrived as", (file) => {
    const payload = fixture("valid", file)
    const decoded = Either.getOrThrow(decodePartialIntent(payload))
    expect(Either.getOrThrow(encode(decoded))).toEqual(payload)
  })

  it.each(rejections)("rejects $file with $tag at '$path'", ({ file, tag, path }) => {
    const result = decodePartialIntent(fixture("invalid/schema", file))
    expect(Either.isLeft(result), `${file} was accepted`).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag, path })
    }
  })

  it("records what every rejection example demonstrates", () => {
    expect([...rejections.map((rejection) => rejection.file)].sort()).toEqual(fixtures("invalid/schema").sort())
  })

  it.each(fixtures("invalid/rule"))("decodes %s, whose rule no schema can see", (file) => {
    // The checks arrive with the clock, the Slip's network, and the effects comparison.
    const result = decodePartialIntent(fixture("invalid/rule", file))
    const failure = Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""
    expect(failure, failure).toBe("")
  })
})

describe("what the decoder refuses on its own account", () => {
  const payment = fixture("valid", "payment.json") as { intent: Record<string, unknown> }
  const withIntent = (intent: Record<string, unknown>): unknown => ({
    ...payment,
    intent: { ...payment.intent, ...intent }
  })

  it("rejects an undeclared member however deeply it is buried", () => {
    const result = decodePartialIntent(
      withIntent({
        outputs: [
          {
            address:
              "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us",
            lovelace: "12000000",
            assets: [
              {
                policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128",
                assetName: "5553444d",
                quantity: "1200",
                decimals: 6
              }
            ]
          }
        ]
      })
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({
        tag: "Unexpected",
        path: "intent/outputs/0/assets/0/decimals"
      })
    }
  })

  it("refuses every way of writing a quantity that is not a count of base units", () => {
    // Mishandled decimals is the defect this ecosystem has paid for most often.
    for (const lovelace of [12000000, "12.5", "1.2e7", " 12000000", "0x0", "", "-1", "012"]) {
      const result = decodePartialIntent(
        withIntent({
          outputs: [
            {
              address:
                "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us",
              lovelace
            }
          ]
        })
      )
      expect(Either.isLeft(result), `${String(lovelace)} was accepted`).toBe(true)
    }
  })

  it("rejects an instant the calendar has no day for", () => {
    // The published pattern passes it, and JavaScript then reads it as 3 March.
    expect(Either.isLeft(decodePartialIntent(withIntent({ validUntil: "2026-02-31T00:00:00Z" })))).toBe(true)
    expect(Either.isRight(decodePartialIntent(withIntent({ validUntil: "2026-02-28T00:00:00Z" })))).toBe(true)
  })

  it("reports every fault at once rather than one per round trip", () => {
    const result = decodePartialIntent({
      ...payment,
      version: "1.0",
      message: "",
      intent: { ...payment.intent, validUntil: "yesterday" }
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      const paths = new Set(issues(result.left).map((issue) => issue.path))
      expect([...paths].sort()).toEqual(["intent/validUntil", "message", "version"])
    }
  })

  it("reads a version it does not implement rather than calling it malformed", () => {
    // `UNSUPPORTED_VERSION` has to stay distinguishable from `MALFORMED_RESPONSE`.
    const result = decodePartialIntent({ ...payment, version: "2" })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.version).not.toBe(PROTOCOL_VERSION)
    }
  })

  it("declares no field for anything the ledger or the wallet determines", () => {
    for (const intent of [
      { fee: "180000" },
      { certificates: [{ type: "stakeRegistration", deposit: "2000000" }] },
      { certificates: [{ type: "stakeDeregistration", stakeCredential: "e0d3…" }] },
      { withdrawRewards: true, withdrawal: "4200000" }
    ]) {
      expect(Either.isLeft(decodePartialIntent(withIntent(intent))), JSON.stringify(intent)).toBe(true)
    }
  })
})

describe("the types a producer and a consumer share", () => {
  it("narrows a certificate by its type", () => {
    const delegation = Either.getOrThrow(
      decodePartialIntent(fixture("valid", "stake-delegation.json"))
    ) satisfies PartialIntent
    const certificate = delegation.intent.certificates?.[0]
    expect(certificate?.type === "stakeDelegation" ? certificate.poolId : undefined).toBe(
      "pool1ayfz9ymjutjzx0a33q8tq6zrn8lj3ckmzp69c9vxk8kyxylly5y"
    )

    const vote = Either.getOrThrow(decodePartialIntent(fixture("valid", "vote-delegation.json")))
    const voteCertificate = vote.intent.certificates?.[0]
    expect(voteCertificate?.type === "voteDelegation" ? voteCertificate.drep : undefined).toBe(
      "drep1y2wfmxsjt7786qc663mts7qh5m9nzn27qjzrpuglaq6wsgqws500e"
    )
  })

  it("takes the two predefined votes where a DRep id would go", () => {
    for (const drep of ["abstain", "noConfidence"]) {
      const result = decodePartialIntent({
        type: "partial",
        version: "1",
        intent: { certificates: [{ type: "voteDelegation", drep }], validUntil: "2026-08-22T19:40:00Z" }
      })
      expect(Either.isRight(result), drep).toBe(true)
    }
  })
})
