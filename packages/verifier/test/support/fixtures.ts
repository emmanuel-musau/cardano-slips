/** The mainnet fixtures, loaded off disk so the tests never touch the network. */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..", "fixtures")

/**
 * What the chain says this transaction does, recorded from Koios when the
 * fixture was collected. It is the second opinion: an oracle that read the same
 * bytes with a different implementation, which is the only reason agreeing with
 * it means anything.
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
}

export type Fixture = {
  readonly name: string
  readonly transactionId: string
  /** What this transaction is here for. Every claim is asserted, so a fixture cannot quietly stop covering it. */
  readonly exercises: ReadonlyArray<string>
  readonly chain: ChainReading
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
