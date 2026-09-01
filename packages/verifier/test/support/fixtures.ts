/** The mainnet fixtures, loaded off disk so the tests never touch the network. */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..", "fixtures")

/**
 * What the chain says this transaction does, recorded from Koios. A different
 * implementation reading the same bytes is the only reason agreeing means
 * anything.
 */
export type ChainReading = {
  readonly source: string
  readonly blockHeight: number
  readonly fee: string
  readonly totalOutput: string
  readonly outputs: number
  readonly inputs: number
  readonly collateralInputs: number
  readonly referenceInputs: number
  readonly certificates: ReadonlyArray<string>
  readonly withdrawals: ReadonlyArray<string>
  readonly mint: ReadonlyArray<{ readonly policyId: string; readonly name: string; readonly quantity: string }>
  readonly invalidBefore: string | null
  readonly invalidAfter: string | null
  readonly votingProcedures: number
  readonly proposalProcedures: number
  /** Deposits less refunds, as the chain accounts for them. Negative where a refund is the larger side. */
  readonly deposit: string
  readonly treasuryDonation: string
}

/** The output each input points at, which the body itself only references. */
export type ResolvedFixtureInput = {
  readonly transactionId: string
  readonly index: number
  readonly address: string
  readonly coin: string
  readonly assets: ReadonlyArray<{ readonly policyId: string; readonly name: string; readonly quantity: string }>
}

/**
 * Whoever holds the inputs is the user here, which is who signs in Mode A —
 * so in every fixture the user owns every input, and `spent` restates
 * `resolved` rather than checking it. `received` is the figure that carries
 * weight: eight of these transactions pay someone else, and the derivation has
 * to tell those outputs from change by matching bytes. An input the signer does
 * not own is covered by the generated transactions, not by a fixture.
 */
export type FixtureUser = {
  readonly addresses: ReadonlyArray<string>
  readonly spent: string
  readonly received: string
  /** `spent - received`: positive is lovelace leaving, the direction the spec states. */
  readonly ada: string
}

export type Fixture = {
  readonly name: string
  readonly transactionId: string
  /** What this transaction is here for. Every claim is asserted, so a fixture cannot quietly stop covering it. */
  readonly exercises: ReadonlyArray<string>
  readonly chain: ChainReading
  readonly user: FixtureUser
  readonly resolved: ReadonlyArray<ResolvedFixtureInput>
  readonly cbor: string
}

export const fixtures: ReadonlyArray<Fixture> = readdirSync(root)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(root, name), "utf8")) as Fixture)

export const fixture = (name: string): Fixture => {
  const found = fixtures.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`no fixture named ${name}`)
  return found
}

export type CborVector = {
  readonly name: string
  readonly input: Record<string, unknown>
  readonly expected: Record<string, unknown>
}

export const cipVectors: ReadonlyArray<CborVector> = readdirSync(join(root, "cip-0186"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(root, "cip-0186", name), "utf8")) as CborVector)
