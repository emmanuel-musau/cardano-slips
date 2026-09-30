/**
 * Example transactions for the effects preview, one per state the panel draws.
 * Written by hand in the shape `flow` derives, so the page never reaches past
 * `flow` for them. They are not checked by the verifier: a preview, not a proof.
 */
import type { CompletionError, Derived } from "@cardano-slips/flow"

type Reasons = NonNullable<CompletionError["reasons"]>
type Effects = Derived["effects"]
type Lovelace = Derived["lovelace"]

export type Example = {
  readonly id: string
  /** Which state on the design sheet this is, and what it shows. */
  readonly title: string
  /** What the card promised, as the panel restates it. */
  readonly claim: string
  readonly description: string
  readonly derived: Derived
  /** Present only where the transaction is blocked. */
  readonly reasons?: Reasons
}

const bytes = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))

// Each written as the verifier spells the bytes below it, so a reason names the row it is about.
const shop = "addr1qxettqng6ydgrkad6vdp0lpaffxsnfgkgwc6afzn43w9wdmuzypalp3d5af6xuugz49cgz85gpennu9xyyje087tkjjsn64vcu"
const shopBytes = bytes(
  "01" +
    "b2b58268d11a81dbadd31a17fc3d4a4d09a51643b1aea453ac5c57377c1103df862da753a37388154b8408f4407339f0a62125979fcbb4a5"
)
const walletBytes = bytes("01" + "a1".repeat(28) + "b2".repeat(28))
const strangerBytes = bytes("01" + "c3".repeat(28) + "d4".repeat(28))
const stranger =
  "addr1q8pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0pu8s756n2df4x56n2df4x56n2df4x56n2df4x56n2df4x56n2qajnege"
const rewardBytes = bytes("e1" + "b2".repeat(28))

const usdm = { policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128", assetName: "5553444d" }
const usdmValue = [{ policyId: bytes(usdm.policyId), assets: [{ name: bytes(usdm.assetName), quantity: 12_000_000n }] }]
const badge = { policyId: bytes("a1b2".repeat(14)), name: bytes("506f6f6c4261646765") }

const pool = bytes("0f".repeat(28))
const stakeKey = { _tag: "KeyHash" as const, hash: bytes("b2".repeat(28)) }

const fee = 172_541n
const fiveMinutes = 5n * 60_000n

const stakeDeposit = (basis: "parameter" | "assumed") =>
  ({ kind: "stake", amount: 2_000_000n, basis, source: "certificate", index: 0 }) as const

type Shape = {
  readonly outputs: Effects["outputs"]
  readonly certificates?: Effects["certificates"]
  readonly withdrawals?: Effects["withdrawals"]
  readonly deposits?: Lovelace["deposits"]
  readonly refunds?: Lovelace["refunds"]
  readonly assets?: Derived["assets"]["user"]
  readonly fee?: bigint
  readonly validUntil: bigint
}

const sum = (values: ReadonlyArray<bigint>): bigint => values.reduce((total, value) => total + value, 0n)

/** Balanced by construction: what the wallet spends is what the outputs, fee and deposits take, less what comes back. */
const derivedFrom = (shape: Shape): Derived => {
  const paidFee = shape.fee ?? fee
  const deposits = shape.deposits ?? []
  const refunds = shape.refunds ?? []
  const withdrawals = shape.withdrawals ?? []
  const deposited = sum(deposits.map((deposit) => deposit.amount))
  const refunded = sum(refunds.map((refund) => refund.amount))
  const withdrawn = sum(withdrawals.map((withdrawal) => withdrawal.amount))
  const outputs = sum(shape.outputs.map((output) => output.value.coin))
  const received = sum(shape.outputs.filter((output) => output.mine).map((output) => output.value.coin))
  const spent = outputs + paidFee + deposited - withdrawn - refunded
  return {
    effects: {
      size: 412,
      outputs: shape.outputs,
      fee: paidFee,
      certificates: shape.certificates ?? [],
      withdrawals,
      mint: [],
      unsupported: [],
      validity: { validFrom: null, validUntil: { slot: 141_992_118n, time: shape.validUntil } }
    },
    lovelace: {
      fee: paidFee,
      donation: 0n,
      deposits,
      refunds,
      user: { spent, received, ada: spent - received, withdrawn },
      total: { inputs: spent, outputs, withdrawn, deposited, refunded },
      unaccounted: 0n
    },
    assets: { user: shape.assets ?? [], unaccounted: [] }
  }
}

const output = (index: number, address: Uint8Array, coin: bigint, mine: boolean, assets = [] as typeof usdmValue) => ({
  index,
  address,
  value: { coin, assets },
  mine,
  size: 67
})

const certificate = (index: number, kind: Effects["certificates"][number]["kind"], extra = {}) => ({
  kind,
  credential: stakeKey,
  role: "stake" as const,
  ours: true,
  pool: null,
  drep: null,
  deposit: null,
  refund: null,
  index,
  ...extra
})

/** The examples as they stand at `now`, so each countdown is where its state needs it. */
export const examples = (now: bigint): ReadonlyArray<Example> => {
  const validUntil = now + fiveMinutes
  const payment = derivedFrom({
    outputs: [output(0, shopBytes, 12_000_000n, false), output(1, walletBytes, 87_827_459n, true)],
    validUntil
  })
  const shopClaim = { claim: "Pay 12 ADA to Corner Store", description: "One payment to the shop's address." }
  const delegateClaim = {
    claim: "Delegate to Community Stake Pool",
    description: "Stake your ADA. Funds never leave your wallet."
  }

  return [
    { id: "payment", title: "a · A payment that matches", ...shopClaim, derived: payment },
    {
      id: "token-payment",
      title: "a · A token payment, with the minimum ADA that travels with it",
      claim: "Pay 12 USDM to Corner Store",
      description: "One payment to the shop's address.",
      derived: derivedFrom({
        outputs: [output(0, shopBytes, 1_176_630n, false, usdmValue), output(1, walletBytes, 98_650_829n, true)],
        assets: [
          {
            policyId: bytes(usdm.policyId),
            name: bytes(usdm.assetName),
            spent: 20_000_000n,
            received: 8_000_000n,
            delta: 12_000_000n
          }
        ],
        validUntil
      })
    },
    {
      id: "delegation",
      title: "b · A delegation, with a deposit that comes back",
      ...delegateClaim,
      derived: derivedFrom({
        outputs: [output(0, walletBytes, 97_827_459n, true)],
        certificates: [
          certificate(0, "StakeRegistration", { deposit: stakeDeposit("parameter") }),
          certificate(1, "StakeDelegation", { pool })
        ],
        deposits: [stakeDeposit("parameter")],
        validUntil
      })
    },
    {
      id: "as-stated",
      title: "i · A refund the transaction states and the ledger does not promise",
      claim: "Stop delegating and close your stake key",
      description: "Close your stake key and take back its deposit.",
      derived: derivedFrom({
        outputs: [output(0, walletBytes, 101_827_459n, true)],
        certificates: [certificate(0, "StakeDeregistration", { refund: stakeDeposit("assumed") })],
        refunds: [stakeDeposit("assumed")],
        validUntil
      })
    },
    {
      id: "long-ledger",
      title: "h · A long ledger, grouped",
      claim: "Claim rewards and redelegate to Community Stake Pool",
      description: "Withdraw your rewards, register, delegate, and collect the pool's badge.",
      derived: derivedFrom({
        outputs: [output(0, walletBytes, 103_847_459n, true)],
        withdrawals: [{ rewardAccount: rewardBytes, amount: 4_210_000n, ours: true }],
        certificates: [
          certificate(0, "StakeRegistration", { deposit: stakeDeposit("parameter") }),
          certificate(1, "StakeDelegation", { pool })
        ],
        deposits: [stakeDeposit("parameter")],
        assets: [{ ...badge, spent: 0n, received: 1n, delta: -1n }],
        validUntil
      })
    },
    {
      id: "expiring",
      title: "f · Under a minute left",
      ...shopClaim,
      derived: { ...payment, effects: { ...payment.effects, validity: validity(now + 47_000n) } }
    },
    {
      id: "expired",
      title: "g · Expired",
      ...shopClaim,
      derived: { ...payment, effects: { ...payment.effects, validity: validity(now - 1_000n) } }
    },
    {
      id: "mismatch-amount",
      title: "e · Blocked: pays ten times what the link asks for",
      ...shopClaim,
      derived: derivedFrom({
        outputs: [output(0, shopBytes, 120_000_000n, false), output(1, walletBytes, 79_827_459n, true)],
        validUntil
      }),
      reasons: [{ code: "output.lovelace", address: shop, declared: 12_000_000n, paid: 120_000_000n }]
    },
    {
      id: "mismatch-stranger",
      title: "e · Blocked: a delegation that also pays a stranger",
      ...delegateClaim,
      derived: derivedFrom({
        outputs: [output(0, strangerBytes, 500_000_000n, false), output(1, walletBytes, 39_000_000n, true)],
        certificates: [certificate(0, "StakeDelegation", { pool })],
        fee: 210_000n,
        validUntil
      }),
      reasons: [{ code: "output.undeclared", address: stranger, declared: 0, paid: 1 }]
    }
  ]
}

const validity = (time: bigint): Effects["validity"] => ({ validFrom: null, validUntil: { slot: 141_992_118n, time } })
