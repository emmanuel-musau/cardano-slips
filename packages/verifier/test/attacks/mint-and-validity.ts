/**
 * Attacks on what a transaction creates and on how long it stays submittable.
 * Both classes are quieter than a redirected payment: a mint the person was
 * never shown puts a token in their wallet under a name they will read as
 * something else, and an interval nobody bounded leaves a signed transaction
 * submittable by whoever holds it, long after the person has forgotten it.
 *
 * Every case here is one edit away from `honest`, which signs.
 */
import type { Intent } from "@cardano-slips/core"

import type { Attack, Held, Slip } from "../support/attacks.js"
import { attacker, bech32, DEADLINE, merchant, signer } from "../support/attacks.js"

/** USDM as it is written on mainnet, and a token wearing its name under another policy. */
const USDM = { policyId: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad", assetName: "0014df105553444d" }
const LOOKALIKE = { policyId: "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", assetName: USDM.assetName }
const REWARD = { policyId: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", assetName: "5245574152445300" }

const tip: Intent = {
  outputs: [{ address: bech32(merchant), lovelace: "5000000" }],
  validUntil: DEADLINE
}

const paying: Intent = {
  outputs: [{ address: bech32(merchant), lovelace: "2000000", assets: [{ ...USDM, quantity: "100000000" }] }],
  validUntil: DEADLINE
}

const minted = (asset: typeof USDM, quantity: bigint): Held => ({ ...asset, quantity })

/** A 5 ADA tip that creates nothing and expires when the intent says it does. */
export const honest: Slip = {
  declared: tip,
  paid: [{ address: merchant, lovelace: 5_000_000n }]
}

export const attacks: ReadonlyArray<Attack> = [
  {
    name: "undeclared-mint",
    lie: "the body pays the declared tip and mints a token into the signer's own wallet on the way, which this version has no field to describe and no way to render",
    declared: tip,
    paid: [
      { address: merchant, lovelace: 5_000_000n },
      { address: signer, lovelace: 2_000_000n, assets: [minted(REWARD, 1_000n)] }
    ],
    mints: [minted(REWARD, 1_000n)],
    blocked: [{ code: "mint.undeclared", assets: [{ ...REWARD, quantity: 1_000n }] }]
  },
  {
    name: "undeclared-burn",
    lie: "the body pays the declared tip and destroys a token the signer already held, which no output records and nothing in the intent asked for",
    declared: tip,
    paid: [{ address: merchant, lovelace: 5_000_000n }],
    mints: [minted(USDM, -50_000_000n)],
    blocked: [{ code: "mint.undeclared", assets: [{ ...USDM, quantity: -50_000_000n }] }]
  },
  {
    name: "mint-and-burn-in-one-body",
    lie: "the body destroys the signer's stablecoin and mints a token of its own in the same breath, so a wallet totalling one line sees a swap that nobody agreed to",
    declared: tip,
    paid: [
      { address: merchant, lovelace: 5_000_000n },
      { address: signer, lovelace: 2_000_000n, assets: [minted(REWARD, 1_000n)] }
    ],
    mints: [minted(USDM, -50_000_000n), minted(REWARD, 1_000n)],
    blocked: [
      {
        code: "mint.undeclared",
        assets: [
          { ...REWARD, quantity: 1_000n },
          { ...USDM, quantity: -50_000_000n }
        ]
      }
    ]
  },
  {
    name: "minted-lookalike-in-place-of-the-stablecoin",
    lie: "the intent declares 100 USDM and the body mints 100 of a token carrying USDM's own asset name under a policy nobody has heard of, then pays that — a wallet showing tickers shows the person exactly what they expected",
    declared: paying,
    paid: [{ address: merchant, lovelace: 2_000_000n, assets: [minted(LOOKALIKE, 100_000_000n)] }],
    mints: [minted(LOOKALIKE, 100_000_000n)],
    blocked: [
      {
        code: "output.assets",
        address: bech32(merchant),
        policyId: USDM.policyId,
        assetName: USDM.assetName,
        declared: 100_000_000n,
        paid: 0n
      },
      {
        code: "output.assets",
        address: bech32(merchant),
        policyId: LOOKALIKE.policyId,
        assetName: LOOKALIKE.assetName,
        declared: 0n,
        paid: 100_000_000n
      },
      { code: "mint.undeclared", assets: [{ ...LOOKALIKE, quantity: 100_000_000n }] }
    ]
  },
  {
    name: "mint-paid-to-a-stranger",
    lie: "the body mints a token and sends it to an address the intent never names, so the signature pays the fee for someone else's issuance",
    declared: tip,
    paid: [
      { address: merchant, lovelace: 5_000_000n },
      { address: attacker, lovelace: 2_000_000n, assets: [minted(REWARD, 1_000n)] }
    ],
    mints: [minted(REWARD, 1_000n)],
    blocked: [
      { code: "output.undeclared", address: bech32(attacker), declared: 0, paid: 1 },
      { code: "mint.undeclared", assets: [{ ...REWARD, quantity: 1_000n }] }
    ]
  },
  {
    name: "no-expiry-at-all",
    lie: "the body carries no validity end, so the signed transaction stays submittable for ever — by whoever obtains it, against a fee market and a UTxO set that have both moved",
    declared: tip,
    paid: [{ address: merchant, lovelace: 5_000_000n }],
    validUntil: null,
    blocked: [{ code: "interval.beyond-declared", validUntil: null, declared: 1_767_225_600_000n }]
  },
  {
    name: "expiry-past-the-declared-deadline",
    lie: "the intent expires on the first of January and the body stays valid until June",
    declared: tip,
    paid: [{ address: merchant, lovelace: 5_000_000n }],
    validUntil: "2026-06-01T00:00:00Z",
    blocked: [{ code: "interval.beyond-declared", validUntil: 1_780_272_000_000n, declared: 1_767_225_600_000n }]
  },
  {
    name: "not-submittable-until-later",
    lie: "the body cannot be submitted until a fortnight from now, so the person signs something they cannot act on and cannot recall",
    declared: tip,
    paid: [{ address: merchant, lovelace: 5_000_000n }],
    validFrom: "2025-12-15T00:00:00Z",
    blocked: [{ code: "interval.not-yet-valid", validFrom: 1_765_756_800_000n, now: 1_764_547_200_000n }]
  },
  {
    name: "window-opening-after-the-deadline",
    lie: "the body's window opens after the intent has already expired and closes months later, which is the whole of both interval rules broken at once",
    declared: tip,
    paid: [{ address: merchant, lovelace: 5_000_000n }],
    validFrom: "2026-02-01T00:00:00Z",
    validUntil: "2026-06-01T00:00:00Z",
    blocked: [
      { code: "interval.beyond-declared", validUntil: 1_780_272_000_000n, declared: 1_767_225_600_000n },
      { code: "interval.not-yet-valid", validFrom: 1_769_904_000_000n, now: 1_764_547_200_000n }
    ]
  }
]
