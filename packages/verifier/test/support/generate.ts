/**
 * Balanced transactions built to a seed, for the arithmetic that has to hold
 * over every transaction rather than over the ones we happen to have.
 * The generator funds the transaction itself, so a run that does not balance is
 * the derivation disagreeing with the ledger's equation, never the fixture.
 */
import type {
  Certificate,
  Credential,
  MultiAsset,
  PoolParams,
  TransactionBody,
  TransactionInput,
  TransactionOutput
} from "../../src/decode.js"
import type { ProtocolParameters } from "../../src/parameters.js"

/** mulberry32: small, and the same sequence everywhere, so a failing seed is a failing case forever. */
const streamOf = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

type Stream = () => number

const upTo = (next: Stream, limit: number): number => Math.floor(next() * limit)
const between = (next: Stream, low: bigint, high: bigint): bigint => low + BigInt(upTo(next, Number(high - low) + 1))
const oneOf = <A>(next: Stream, choices: ReadonlyArray<A>): A => choices[upTo(next, choices.length)]
const bytes = (next: Stream, length: number): Uint8Array => Uint8Array.from({ length }, () => upTo(next, 256))

const credential = (next: Stream): Credential => ({ _tag: "KeyHash", hash: bytes(next, 28) })

const poolParams = (next: Stream): PoolParams => ({
  operator: bytes(next, 28),
  vrfKeyHash: bytes(next, 32),
  pledge: between(next, 0n, 1_000_000n),
  cost: 340_000_000n,
  margin: { numerator: 1n, denominator: 50n },
  rewardAccount: bytes(next, 29),
  owners: [bytes(next, 28)],
  relays: [],
  metadata: null
})

/**
 * Six assets across three policies, so a policy holding more than one name and
 * an output holding more than one policy both turn up. Two names under one
 * policy is the case a delta keyed on the policy alone gets wrong.
 */
const assetPool: ReadonlyArray<{ policyId: Uint8Array; name: Uint8Array; key: string }> = [
  [0x11, 0x01],
  [0x11, 0x02],
  [0x22, 0x01],
  [0x22, 0x02],
  [0x33, 0x01],
  [0x33, 0x02]
].map(([policy, name]) => ({
  policyId: new Uint8Array(28).fill(policy),
  name: Uint8Array.of(name),
  key: `${policy}.${name}`
}))

const toKey = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16)).join("")

const bundle = (held: ReadonlyMap<string, bigint>): MultiAsset => {
  const byPolicy = new Map<string, { policyId: Uint8Array; assets: Array<{ name: Uint8Array; quantity: bigint }> }>()
  for (const asset of assetPool) {
    const quantity = held.get(asset.key) ?? 0n
    if (quantity === 0n) continue
    const policy = toKey(asset.policyId)
    const group = byPolicy.get(policy) ?? { policyId: asset.policyId, assets: [] }
    group.assets.push({ name: asset.name, quantity })
    byPolicy.set(policy, group)
  }
  return [...byPolicy.values()]
}

/** What the generator has to fund for a certificate, which is the answer `deposits.ts` must reach independently. */
export type GeneratedCertificate = {
  readonly certificate: Certificate
  readonly deposit: bigint
  readonly refund: bigint
}

const certificateKinds: ReadonlyArray<(next: Stream, parameters: ProtocolParameters) => GeneratedCertificate> = [
  (next, parameters) => ({
    certificate: { _tag: "StakeRegistration", credential: credential(next) },
    deposit: parameters.stakeDeposit,
    refund: 0n
  }),
  (next, parameters) => ({
    certificate: { _tag: "StakeDeregistration", credential: credential(next) },
    deposit: 0n,
    refund: parameters.stakeDeposit
  }),
  (next) => ({
    certificate: { _tag: "StakeDelegation", credential: credential(next), poolKeyHash: bytes(next, 28) },
    deposit: 0n,
    refund: 0n
  }),
  (next, parameters) => ({
    certificate: { _tag: "PoolRegistration", params: poolParams(next) },
    deposit: parameters.poolDeposit,
    refund: 0n
  }),
  (next) => ({
    certificate: { _tag: "PoolRetirement", poolKeyHash: bytes(next, 28), epoch: between(next, 600n, 700n) },
    deposit: 0n,
    refund: 0n
  }),
  (next) => {
    // Deliberately not the protocol parameter: a certificate that states an
    // amount is the amount the ledger charges, and reading the parameter here
    // instead would balance only by coincidence.
    const deposit = between(next, 1_000_000n, 4_000_000n)
    return { certificate: { _tag: "Registration", credential: credential(next), deposit }, deposit, refund: 0n }
  },
  (next) => {
    const refund = between(next, 1_000_000n, 4_000_000n)
    return { certificate: { _tag: "Deregistration", credential: credential(next), refund }, deposit: 0n, refund }
  },
  (next) => ({
    certificate: { _tag: "VoteDelegation", credential: credential(next), drep: { _tag: "Abstain" } },
    deposit: 0n,
    refund: 0n
  }),
  (next) => ({
    certificate: {
      _tag: "StakeVoteDelegation",
      credential: credential(next),
      poolKeyHash: bytes(next, 28),
      drep: { _tag: "NoConfidence" }
    },
    deposit: 0n,
    refund: 0n
  }),
  (next) => {
    const deposit = between(next, 1_000_000n, 4_000_000n)
    return {
      certificate: {
        _tag: "StakeRegistrationDelegation",
        credential: credential(next),
        poolKeyHash: bytes(next, 28),
        deposit
      },
      deposit,
      refund: 0n
    }
  },
  (next) => {
    const deposit = between(next, 1_000_000n, 4_000_000n)
    return {
      certificate: {
        _tag: "VoteRegistrationDelegation",
        credential: credential(next),
        drep: { _tag: "KeyHash", hash: bytes(next, 28) },
        deposit
      },
      deposit,
      refund: 0n
    }
  },
  (next) => {
    const deposit = between(next, 1_000_000n, 4_000_000n)
    return {
      certificate: {
        _tag: "StakeVoteRegistrationDelegation",
        credential: credential(next),
        poolKeyHash: bytes(next, 28),
        drep: { _tag: "ScriptHash", hash: bytes(next, 28) },
        deposit
      },
      deposit,
      refund: 0n
    }
  },
  (next) => ({
    certificate: { _tag: "AuthorizeCommitteeHot", cold: credential(next), hot: credential(next) },
    deposit: 0n,
    refund: 0n
  }),
  (next) => ({
    certificate: { _tag: "ResignCommitteeCold", cold: credential(next), anchor: null },
    deposit: 0n,
    refund: 0n
  }),
  (next) => {
    const deposit = between(next, 100_000_000n, 900_000_000n)
    return {
      certificate: { _tag: "RegisterDrep", credential: credential(next), deposit, anchor: null },
      deposit,
      refund: 0n
    }
  },
  (next) => {
    const refund = between(next, 100_000_000n, 900_000_000n)
    return { certificate: { _tag: "UnregisterDrep", credential: credential(next), refund }, deposit: 0n, refund }
  },
  (next) => ({
    certificate: { _tag: "UpdateDrep", credential: credential(next), anchor: null },
    deposit: 0n,
    refund: 0n
  })
]

/** Every certificate the decoder models is generated, so the deposit table cannot quietly lose a row. */
export const certificateKindCount = certificateKinds.length

export type Generated = {
  readonly body: TransactionBody
  readonly userAddresses: ReadonlyArray<Uint8Array>
  readonly resolved: ReadonlyArray<{
    input: TransactionInput
    address: Uint8Array
    coin: bigint
    assets: MultiAsset
  }>
  readonly certificateTags: ReadonlyArray<Certificate["_tag"]>
  /** What the generator funded, which is what `deposits.ts` has to reach on its own. */
  readonly funded: { readonly deposits: bigint; readonly refunds: bigint }
  /**
   * The user's side, known because the generator decided whose each input,
   * output and withdrawal was before it picked an address for it. The
   * derivation reaches the same figures by matching bytes, which is the part
   * being tested.
   */
  readonly expected: {
    readonly spent: bigint
    readonly received: bigint
    readonly withdrawn: bigint
    /** Per asset, keyed the way `assetPool` keys them: what the user's side nets to. */
    readonly assets: ReadonlyMap<string, { readonly spent: bigint; readonly received: bigint }>
  }
}

export const assetKeys: ReadonlyArray<string> = assetPool.map((asset) => asset.key)

/**
 * A transaction that satisfies the ledger's equation by construction:
 * inputs plus withdrawals plus refunds equals outputs plus fee plus deposits
 * plus donation. Whatever is left after the obligations becomes the outputs.
 */
export const generate = (seed: number, parameters: ProtocolParameters): Generated => {
  const next = streamOf(seed)

  const userAddresses = Array.from({ length: 1 + upTo(next, 3) }, () => bytes(next, 57))
  const userRewardAccounts = Array.from({ length: 1 + upTo(next, 2) }, () => bytes(next, 29))
  const strangers = Array.from({ length: 1 + upTo(next, 3) }, () => bytes(next, 57))
  const strangerRewardAccounts = [bytes(next, 29)]
  const owned = [...userAddresses, ...userRewardAccounts]

  const certificates = Array.from({ length: upTo(next, 4) }, () => oneOf(next, certificateKinds)(next, parameters))
  const proposals = Array.from({ length: upTo(next, 2) }, () => ({
    deposit: parameters.governanceActionDeposit,
    rewardAccount: bytes(next, 29),
    action: { kind: "info" as const, arguments: [] },
    anchor: { url: "https://example.invalid/a", dataHash: bytes(next, 32) }
  }))

  // Whose it is, then which address: the generator never learns ownership by
  // matching bytes, which is what keeps it an independent opinion.
  let expectedWithdrawn = 0n
  const withdrawals = Array.from({ length: upTo(next, 3) }, () => {
    const mine = next() < 0.7
    const amount = between(next, 0n, 5_000_000_000n)
    if (mine) expectedWithdrawn += amount
    return { rewardAccount: oneOf(next, mine ? userRewardAccounts : strangerRewardAccounts), amount }
  })

  const fee = between(next, 150_000n, 2_000_000n)
  const donation = next() < 0.2 ? between(next, 1n, 1_000_000n) : null

  const owedOut =
    fee +
    (donation ?? 0n) +
    certificates.reduce((running, one) => running + one.deposit, 0n) +
    proposals.reduce((running, one) => running + one.deposit, 0n)
  const broughtIn =
    withdrawals.reduce((running, one) => running + one.amount, 0n) +
    certificates.reduce((running, one) => running + one.refund, 0n)

  let expectedSpent = 0n
  const spentAssets = new Map<string, bigint>()
  const heldAssets = new Map<string, bigint>()
  const resolved = Array.from({ length: 1 + upTo(next, 4) }, (_, index) => {
    const mine = next() < 0.8
    const coin = between(next, 1_000_000n, 20_000_000_000n)
    if (mine) expectedSpent += coin
    const held = new Map<string, bigint>()
    for (const asset of assetPool) {
      if (next() > 0.3) continue
      const quantity = between(next, 1n, 1_000_000n)
      held.set(asset.key, (held.get(asset.key) ?? 0n) + quantity)
      heldAssets.set(asset.key, (heldAssets.get(asset.key) ?? 0n) + quantity)
      if (mine) spentAssets.set(asset.key, (spentAssets.get(asset.key) ?? 0n) + quantity)
    }
    return {
      input: { transactionId: bytes(next, 32), index: BigInt(index) },
      address: oneOf(next, mine ? userAddresses : strangers),
      coin,
      assets: bundle(held),
      mine
    }
  })

  // Mint what nobody holds, burn out of what the inputs do: both leave the
  // asset equation satisfiable, which is what the derivation has to reach.
  const minted = new Map<string, bigint>()
  for (const asset of assetPool) {
    const held = heldAssets.get(asset.key) ?? 0n
    const roll = next()
    if (roll < 0.15) {
      minted.set(asset.key, between(next, 1n, 500_000n))
    } else if (roll > 0.85 && held > 0n) {
      // Never more than the inputs hold: a burn of what nothing carries is a
      // transaction the ledger would not accept.
      minted.set(asset.key, -between(next, 1n, held))
    }
  }
  const available = new Map<string, bigint>()
  for (const asset of assetPool) {
    const total = (heldAssets.get(asset.key) ?? 0n) + (minted.get(asset.key) ?? 0n)
    if (total > 0n) available.set(asset.key, total)
  }
  const funded = resolved.reduce((running, one) => running + one.coin, 0n)
  // Top the first input up where the obligations outrun what was drawn, so the
  // shape stays random but the transaction always balances.
  const shortfall = owedOut - (funded + broughtIn)
  if (shortfall > 0n) {
    resolved[0] = { ...resolved[0], coin: resolved[0].coin + shortfall }
    if (resolved[0].mine) expectedSpent += shortfall
  }

  let remaining = resolved.reduce((running, one) => running + one.coin, 0n) + broughtIn - owedOut
  // Always at least one, so every asset the inputs and the mint bring has
  // somewhere to go even when the lovelace has all been spent on obligations.
  const wanted = 1 + upTo(next, 3)
  const shares: Array<bigint> = []
  for (let index = 0; index < wanted; index++) {
    const share = index === wanted - 1 ? remaining : between(next, 0n, remaining)
    remaining -= share
    shares.push(share)
  }

  const mineByOutput = shares.map(() => next() < 0.6)
  const heldByOutput = shares.map(() => new Map<string, bigint>())
  for (const [key, quantity] of available) {
    let left = quantity
    for (let index = 0; index < shares.length; index++) {
      const share = index === shares.length - 1 ? left : between(next, 0n, left)
      left -= share
      if (share > 0n) heldByOutput[index].set(key, (heldByOutput[index].get(key) ?? 0n) + share)
    }
  }

  let expectedReceived = 0n
  const receivedAssets = new Map<string, bigint>()
  const outputs: Array<TransactionOutput> = shares.map((coin, index) => {
    const mine = mineByOutput[index]
    if (mine) {
      expectedReceived += coin
      for (const [key, quantity] of heldByOutput[index]) {
        receivedAssets.set(key, (receivedAssets.get(key) ?? 0n) + quantity)
      }
    }
    return {
      form: "legacy" as const,
      address: oneOf(next, mine ? userAddresses : strangers),
      value: { coin, assets: bundle(heldByOutput[index]) },
      datum: null,
      scriptRef: null
    }
  })

  return {
    body: {
      inputs: resolved.map((one) => one.input),
      outputs,
      fee,
      certificates: certificates.map((one) => one.certificate),
      withdrawals,
      proposalProcedures: proposals,
      donation,
      validityIntervalEnd: null,
      auxiliaryDataHash: null,
      validityIntervalStart: null,
      mint: bundle(minted),
      scriptDataHash: null,
      collateralInputs: [],
      requiredSigners: [],
      networkId: null,
      collateralReturn: null,
      totalCollateral: null,
      referenceInputs: [],
      votingProcedures: [],
      currentTreasuryValue: null
    },
    userAddresses: owned,
    resolved,
    certificateTags: certificates.map((one) => one.certificate._tag),
    funded: {
      deposits:
        certificates.reduce((running, one) => running + one.deposit, 0n) +
        proposals.reduce((running, one) => running + one.deposit, 0n),
      refunds: certificates.reduce((running, one) => running + one.refund, 0n)
    },
    expected: {
      spent: expectedSpent,
      received: expectedReceived,
      withdrawn: expectedWithdrawn,
      assets: new Map(
        assetPool.map((asset) => [
          asset.key,
          { spent: spentAssets.get(asset.key) ?? 0n, received: receivedAssets.get(asset.key) ?? 0n }
        ])
      )
    }
  }
}
