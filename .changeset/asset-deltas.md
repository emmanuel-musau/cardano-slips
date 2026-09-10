---
"@cardano-slips/verifier": minor
---

Derive native-asset deltas per policy and asset name. `deriveAssets` takes the same four arguments as `deriveLovelace` and returns the net for each asset across the user's addresses — positive is the asset leaving, negative is it arriving — with assets that come in and go straight back out left off, and `unaccounted` for anything the reading cannot place. Quantities are raw on-chain counts; decimals are a display concern.
