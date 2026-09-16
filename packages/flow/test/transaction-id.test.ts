import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { transactionIdOf } from "../src/witness.js"

/**
 * The id this package binds a signature to, against what the chain calls the
 * same transaction. The fixtures are the verifier's — fifty-three mainnet
 * transactions with their ids recorded from Koios — because an id checked only
 * against our own hashing would agree with itself and with nothing else.
 */

const root = join(import.meta.dirname, "..", "..", "verifier", "test", "fixtures")

type Fixture = { readonly name: string; readonly transactionId: string; readonly cbor: string }

const fixtures: ReadonlyArray<Fixture> = readdirSync(root)
  .filter((entry) => entry.endsWith(".json"))
  .map((entry) => JSON.parse(readFileSync(join(root, entry), "utf8")) as Fixture)

it("has mainnet transactions to read", () => {
  expect(fixtures.length).toBeGreaterThanOrEqual(50)
})

describe.each(fixtures.map((fixture) => [fixture.name, fixture] as const))("%s", (_name, fixture) => {
  it("is the id the chain knows it by", () => {
    expect(Effect.runSync(transactionIdOf(fixture.cbor))).toBe(fixture.transactionId)
  })
})
