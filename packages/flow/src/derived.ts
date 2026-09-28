/** What a transaction does, read from its own bytes: the part the comparison judges, and the figures a person is shown. */
import type { AssetEffects, Effects, LovelaceEffects } from "@cardano-slips/verifier"

export type Derived = {
  readonly effects: Effects
  readonly lovelace: LovelaceEffects
  readonly assets: AssetEffects
}
