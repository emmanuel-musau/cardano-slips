/**
 * Derived effects written by hand, one shape per state the panel draws. They
 * are the panel's input rather than the thing under test, so they only need to
 * be shapes the verifier could produce; `complete.test.ts` covers deriving them.
 */
import {
  addressText,
  type AssetAmount,
  type AssetDelta,
  type CertificateEffect,
  type Deposit,
  type OutputEffect,
  type WithdrawalEffect
} from "@cardano-slips/verifier"

import type { Derived } from "../src/derived.js"

export const bytes = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))

export const shopBytes = bytes(
  "01b2b58268d11a81dbadd31a17fc3d4a4d09a51643b1aea453ac5c57377c1103df862da753a37388154b8408f4407339f0a62125979fcbb4a5"
)
export const walletBytes = bytes("01" + "a1".repeat(28) + "b2".repeat(28))
export const strangerBytes = bytes("01" + "c3".repeat(28) + "d4".repeat(28))
export const rewardBytes = bytes("e1" + "b2".repeat(28))

export const shop = addressText(shopBytes)
export const stranger = addressText(strangerBytes)

export const usdm = {
  policyId: bytes("1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128"),
  name: bytes("5553444d")
}
export const badge = { policyId: bytes("a1b2".repeat(14)), name: bytes("506f6f6c4261646765") }

export const pool = bytes("0f".repeat(28))
const stakeKey = { _tag: "KeyHash" as const, hash: bytes("b2".repeat(28)) }

export const fee = 172_541n
export const expiry = BigInt(Date.parse("2026-09-28T12:05:00Z"))

export const output = (
  index: number,
  address: Uint8Array,
  coin: bigint,
  options: { readonly mine?: boolean; readonly tokens?: ReadonlyArray<AssetAmount> } = {}
): OutputEffect => ({
  index,
  address,
  value: {
    coin,
    assets: (options.tokens ?? []).map((token) => ({
      policyId: token.policyId,
      assets: [{ name: token.name, quantity: token.quantity }]
    }))
  },
  mine: options.mine ?? false,
  size: 67
})

export const certificate = (
  index: number,
  kind: CertificateEffect["kind"],
  extra: Partial<CertificateEffect> = {}
): CertificateEffect => ({
  kind,
  credential: stakeKey,
  role: "stake",
  ours: true,
  pool: null,
  drep: null,
  deposit: null,
  refund: null,
  index,
  ...extra
})

export const stakeDeposit = (index: number, basis: Deposit["basis"] = "parameter"): Deposit => ({
  kind: "stake",
  amount: 2_000_000n,
  basis,
  source: "certificate",
  index
})

type Shape = {
  readonly outputs?: ReadonlyArray<OutputEffect>
  readonly certificates?: ReadonlyArray<CertificateEffect>
  readonly withdrawals?: ReadonlyArray<WithdrawalEffect>
  readonly mint?: ReadonlyArray<AssetAmount>
  readonly deposits?: ReadonlyArray<Deposit>
  readonly refunds?: ReadonlyArray<Deposit>
  readonly assets?: ReadonlyArray<AssetDelta>
  readonly fee?: bigint
  readonly validUntil?: bigint | null
}

const sum = (values: ReadonlyArray<bigint>): bigint => values.reduce((total, value) => total + value, 0n)

/** A derivation that balances: what the wallet spends is what the outputs, fee and deposits take, less what comes back. */
export const derivedOf = (shape: Shape): Derived => {
  const outputs = shape.outputs ?? []
  const paidFee = shape.fee ?? fee
  const deposited = sum((shape.deposits ?? []).map((deposit) => deposit.amount))
  const refunded = sum((shape.refunds ?? []).map((refund) => refund.amount))
  const withdrawn = sum((shape.withdrawals ?? []).map((withdrawal) => withdrawal.amount))
  const produced = sum(outputs.map((one) => one.value.coin))
  const received = sum(outputs.filter((one) => one.mine).map((one) => one.value.coin))
  const spent = produced + paidFee + deposited - withdrawn - refunded
  const validUntil = shape.validUntil === undefined ? expiry : shape.validUntil

  return {
    effects: {
      size: 412,
      outputs,
      fee: paidFee,
      certificates: shape.certificates ?? [],
      withdrawals: shape.withdrawals ?? [],
      mint: shape.mint ?? [],
      unsupported: [],
      validity: { validFrom: null, validUntil: validUntil === null ? null : { slot: 141_992_118n, time: validUntil } }
    },
    lovelace: {
      fee: paidFee,
      donation: 0n,
      deposits: shape.deposits ?? [],
      refunds: shape.refunds ?? [],
      user: { spent, received, ada: spent - received, withdrawn },
      total: { inputs: spent, outputs: produced, withdrawn, deposited, refunded },
      unaccounted: 0n
    },
    assets: { user: shape.assets ?? [], unaccounted: [] }
  }
}

/** `4 · Anatomy`: one payment to the shop, change back to the wallet. */
export const payment = derivedOf({
  outputs: [output(0, shopBytes, 12_000_000n), output(1, walletBytes, 87_827_459n, { mine: true })]
})

/** A token payment, carrying the ledger's minimum ADA with it. */
export const tokenPayment = derivedOf({
  outputs: [
    output(0, shopBytes, 1_176_630n, { tokens: [{ ...usdm, quantity: 12_000_000n }] }),
    output(1, walletBytes, 98_650_829n, { mine: true })
  ],
  assets: [{ ...usdm, spent: 20_000_000n, received: 8_000_000n, delta: 12_000_000n }]
})

/** `b · Certificate and refundable deposit`. */
export const delegation = derivedOf({
  outputs: [output(0, walletBytes, 97_827_459n, { mine: true })],
  certificates: [
    certificate(0, "StakeRegistration", { deposit: stakeDeposit(0) }),
    certificate(1, "StakeDelegation", { pool })
  ],
  deposits: [stakeDeposit(0)]
})

/** The state beside `b`: a refund only the transaction claims. */
export const closing = derivedOf({
  outputs: [output(0, walletBytes, 101_827_459n, { mine: true })],
  certificates: [certificate(0, "StakeDeregistration", { refund: stakeDeposit(0, "assumed") })],
  refunds: [stakeDeposit(0, "assumed")]
})

/** `h · Long ledger`: rewards claimed, a badge received, a deposit locked, a delegation. */
export const longLedger = derivedOf({
  outputs: [output(0, walletBytes, 103_847_459n, { mine: true, tokens: [{ ...badge, quantity: 1n }] })],
  withdrawals: [{ rewardAccount: rewardBytes, amount: 4_210_000n, ours: true }],
  certificates: [
    certificate(0, "StakeRegistration", { deposit: stakeDeposit(0) }),
    certificate(1, "StakeDelegation", { pool })
  ],
  deposits: [stakeDeposit(0)],
  assets: [{ ...badge, spent: 0n, received: 1n, delta: -1n }]
})

/** `e · Mismatch`: the shop is paid as asked, and a stranger is paid besides. */
export const strangerPaid = derivedOf({
  outputs: [
    output(0, shopBytes, 12_000_000n),
    output(1, strangerBytes, 40_000_000n),
    output(2, walletBytes, 47_827_459n, { mine: true })
  ]
})
