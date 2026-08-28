import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Either, Schema } from "effect"
import { ArrayFormatter, TreeFormatter, type ParseError } from "effect/ParseResult"
import { describe, expect, it } from "vitest"

import { addressIsOnNetwork, BuildRequest, decodeBuildRequest } from "../src/index.js"

/**
 * `decodeBuildRequest` against the examples the CIP publishes. This is the one
 * payload that travels *to* an endpoint, and the closed object is where Mode A's
 * privacy lives: `utxos-in-the-body.json` is the body this protocol exists to
 * make unsendable.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "build-request")

const fixtures = (bucket: string): Array<string> =>
  readdirSync(join(examples, bucket)).filter((file) => file.endsWith(".json"))

const fixture = (bucket: string, file: string): unknown =>
  JSON.parse(readFileSync(join(examples, bucket, file), "utf8"))

const issues = (error: ParseError): Array<{ tag: string; path: string }> =>
  ArrayFormatter.formatErrorSync(error).map((issue) => ({ tag: issue._tag, path: issue.path.join("/") }))

const encode = Schema.encodeEither(BuildRequest)

/** Naming the issue and the path: a payload rejected for the wrong reason would still pass "it failed". */
const rejections: ReadonlyArray<{ file: string; tag: string; path: string }> = [
  { file: "missing-network.json", tag: "Missing", path: "network" },
  { file: "not-an-address.json", tag: "Refinement", path: "changeAddress" },
  { file: "stake-address-as-change.json", tag: "Refinement", path: "changeAddress" },
  { file: "unknown-network.json", tag: "Type", path: "network" },
  { file: "utxos-in-the-body.json", tag: "Unexpected", path: "utxos" }
]

describe("decoding the build request", () => {
  it.each(fixtures("valid"))("accepts %s", (file) => {
    const result = decodeBuildRequest(fixture("valid", file))
    const failure = Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""
    expect(failure, failure).toBe("")
  })

  it.each(fixtures("valid"))("round-trips %s back to the bytes it arrived as", (file) => {
    const payload = fixture("valid", file)
    const decoded = Either.getOrThrow(decodeBuildRequest(payload))
    expect(Either.getOrThrow(encode(decoded))).toEqual(payload)
  })

  it.each(rejections)("rejects $file with $tag at '$path'", ({ file, tag, path }) => {
    const result = decodeBuildRequest(fixture("invalid/schema", file))
    expect(Either.isLeft(result), `${file} was accepted`).toBe(true)
    if (Either.isLeft(result)) {
      expect(issues(result.left)).toContainEqual({ tag, path })
    }
  })

  it("records what every rejection example demonstrates", () => {
    expect([...rejections.map((rejection) => rejection.file)].sort()).toEqual(fixtures("invalid/schema").sort())
  })

  it.each(fixtures("invalid/rule"))("decodes %s, whose rule no schema can see", (file) => {
    const result = decodeBuildRequest(fixture("invalid/rule", file))
    const failure = Either.isLeft(result) ? TreeFormatter.formatErrorSync(result.left) : ""
    expect(failure, failure).toBe("")
  })
})

describe("the network an address encodes", () => {
  it.each(fixtures("valid"))("agrees with the network %s states", (file) => {
    const request = Either.getOrThrow(decodeBuildRequest(fixture("valid", file)))
    expect(addressIsOnNetwork(request.changeAddress, request.network)).toBe(true)
  })

  it.each(fixtures("invalid/rule"))("disagrees with the network %s states", (file) => {
    const request = Either.getOrThrow(decodeBuildRequest(fixture("invalid/rule", file)))
    expect(addressIsOnNetwork(request.changeAddress, request.network)).toBe(false)
  })

  it("cannot separate preprod from preview, which is why network is named and not numeric", () => {
    const test =
      "addr_test1qp77jhff8hemycmj6k4pt8lfkyka8n6gjyvsjpehjvjnyt0zgulmz8fz03m9hn6levxccvnsna3m2n0vlpwgsztpt7hslczztq"
    expect(addressIsOnNetwork(test, "preprod")).toBe(true)
    expect(addressIsOnNetwork(test, "preview")).toBe(true)
  })
})
