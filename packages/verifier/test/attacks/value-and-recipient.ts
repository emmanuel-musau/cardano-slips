/**
 * Attacks on what a transaction pays and who it pays. The headline case is the
 * whole reason the comparison exists: the card says tip 5 ADA, the transaction
 * sends 500 to an address the person has never seen.
 *
 * Every case here is one edit away from `honest`, which signs. That is what
 * makes each block attributable to the lie rather than to a gate that blocks
 * everything.
 */
import type { Intent } from "@cardano-slips/core"

import type { Attack, Slip } from "../support/attacks.js"
import { attacker, bech32, DEADLINE, merchant } from "../support/attacks.js"

/** USDM, six decimals, as it is written on mainnet — the asset the display-unit cases lie about. */
const USDM = { policyId: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad", assetName: "0014df105553444d" }

/** Same asset name, a policy nobody has heard of. What a lookalike token is. */
const LOOKALIKE = { policyId: "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", assetName: USDM.assetName }

const tip = (lovelace: string): Intent => ({
  outputs: [{ address: bech32(merchant), lovelace }],
  validUntil: DEADLINE
})

const paying = (quantity: string, asset = USDM): Intent => ({
  outputs: [{ address: bech32(merchant), lovelace: "2000000", assets: [{ ...asset, quantity }] }],
  validUntil: DEADLINE
})

/** A 5 ADA tip to the merchant the intent names, and change back to the signer. */
export const honest: Slip = {
  declared: tip("5000000"),
  paid: [{ address: merchant, lovelace: 5_000_000n }]
}

export const attacks: ReadonlyArray<Attack> = [
  {
    name: "inflated-amount",
    lie: "the intent declares a 5 ADA tip and the body pays that address 500 ADA",
    declared: tip("5000000"),
    paid: [{ address: merchant, lovelace: 500_000_000n }],
    blocked: [{ code: "output.lovelace", address: bech32(merchant), declared: 5_000_000n, paid: 500_000_000n }]
  },
  {
    name: "shaved-amount",
    lie: "the intent declares a 5 ADA payment and the body pays 1 ADA, so a bill the person believes settled is not",
    declared: tip("5000000"),
    paid: [{ address: merchant, lovelace: 1_000_000n }],
    blocked: [{ code: "output.lovelace", address: bech32(merchant), declared: 5_000_000n, paid: 1_000_000n }]
  },
  {
    name: "redirected-recipient",
    lie: "the intent declares the tip to the merchant and the body pays the whole of it to an address the intent never names",
    declared: tip("5000000"),
    paid: [{ address: attacker, lovelace: 5_000_000n }],
    blocked: [
      { code: "output.missing", address: bech32(merchant), declared: 1, paid: 0 },
      { code: "output.undeclared", address: bech32(attacker), declared: 0, paid: 1 }
    ]
  },
  {
    name: "hidden-extra-output",
    lie: "the body pays the declared 5 ADA tip, and 200 ADA more to a second address that appears nowhere in the intent",
    declared: tip("5000000"),
    paid: [
      { address: merchant, lovelace: 5_000_000n },
      { address: attacker, lovelace: 200_000_000n }
    ],
    blocked: [{ code: "output.undeclared", address: bech32(attacker), declared: 0, paid: 1 }]
  },
  {
    name: "hidden-payment-behind-a-known-address",
    lie: "the body pays the merchant twice, so the extra 200 ADA hides behind the one address the person was shown",
    declared: tip("5000000"),
    paid: [
      { address: merchant, lovelace: 5_000_000n },
      { address: merchant, lovelace: 200_000_000n }
    ],
    blocked: [{ code: "output.undeclared", address: bech32(merchant), declared: 1, paid: 2 }]
  },
  {
    name: "split-into-two-payments",
    lie: "the intent declares one payment to the merchant and the body makes two adding to the same total, which only a comparison holding the body to the declaration rather than to a sum can see",
    declared: tip("5000000"),
    paid: [
      { address: merchant, lovelace: 2_000_000n },
      { address: merchant, lovelace: 3_000_000n }
    ],
    blocked: [{ code: "output.undeclared", address: bech32(merchant), declared: 1, paid: 2 }]
  },
  {
    name: "ada-in-place-of-the-stablecoin",
    lie: "the intent declares 100 USDM and the body moves no USDM at all, paying 100 ADA instead",
    declared: paying("100000000"),
    paid: [{ address: merchant, lovelace: 100_000_000n }],
    blocked: [
      { code: "output.lovelace", address: bech32(merchant), declared: 2_000_000n, paid: 100_000_000n },
      {
        code: "output.assets",
        address: bech32(merchant),
        policyId: USDM.policyId,
        assetName: USDM.assetName,
        declared: 100_000_000n,
        paid: 0n
      }
    ]
  },
  {
    name: "lookalike-policy",
    lie: "the intent declares 100 USDM and the body moves 100 of a worthless token carrying the same asset name under another policy",
    declared: paying("100000000"),
    paid: [{ address: merchant, lovelace: 2_000_000n, assets: [{ ...LOOKALIKE, quantity: 100_000_000n }] }],
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
      }
    ]
  },
  {
    name: "display-units-declared-for-base-units",
    lie: "the intent declares 10 where the body moves 10000000 base units, which is what writing a six-decimal display amount into a base-unit field does — and the person pays a million times what the page said",
    declared: paying("10"),
    paid: [{ address: merchant, lovelace: 2_000_000n, assets: [{ ...USDM, quantity: 10_000_000n }] }],
    blocked: [
      {
        code: "output.assets",
        address: bech32(merchant),
        policyId: USDM.policyId,
        assetName: USDM.assetName,
        declared: 10n,
        paid: 10_000_000n
      }
    ]
  },
  {
    name: "base-units-declared-for-display-units",
    lie: "the reverse: the intent declares 10000000 base units and the body moves 10, so the merchant is paid a millionth of what the page promised",
    declared: paying("10000000"),
    paid: [{ address: merchant, lovelace: 2_000_000n, assets: [{ ...USDM, quantity: 10n }] }],
    blocked: [
      {
        code: "output.assets",
        address: bech32(merchant),
        policyId: USDM.policyId,
        assetName: USDM.assetName,
        declared: 10_000_000n,
        paid: 10n
      }
    ]
  }
]
