import { Either } from "effect"

import type { Comparison, Verdict } from "../../src/compare.js"
import { compare } from "../../src/compare.js"

/** What `compare` decides, thrown as an error when it refuses to compare at all. */
export const verdictOf = (comparison: Comparison, name = "it"): Verdict => {
  const result = compare(comparison)
  if (Either.isLeft(result)) throw new Error(`${name} could not be compared: ${result.left.message}`)
  return result.right
}
