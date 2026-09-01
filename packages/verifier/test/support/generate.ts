/**
 * Balanced transactions built to a seed, for the arithmetic that has to hold
 * over every transaction rather than over the twenty-six we happen to have.
 * The generator funds the transaction itself, so a run that does not balance is
 * the derivation disagreeing with the ledger's equation, never the fixture.
 */
import type {
  Certificate,
  Credential,
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
  readonly resolved: ReadonlyArray<{ input: TransactionInput; address: Uint8Array; coin: bigint }>
  readonly certificateTags: ReadonlyArray<Certificate["_tag"]>
  /** What the generator funded, which is what `deposits.ts` has to reach on its own. */
  readonly funded: { readonly deposits: bigint; readonly refunds: bigint }
  /**
   * The user's side, known because the generator decided whose each input,
   * output and withdrawal was before it picked an address for it. The
   * derivation reaches the same figures by matching bytes, which is the part
   * being tested.
   */
  readonly expected: { readonly spent: bigint; readonly received: bigint; readonly withdrawn: bigint }
}

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
  const resolved = Array.from({ length: 1 + upTo(next, 4) }, (_, index) => {
    const mine = next() < 0.8
    const coin = between(next, 1_000_000n, 20_000_000_000n)
    if (mine) expectedSpent += coin
    return {
      input: { transactionId: bytes(next, 32), index: BigInt(index) },
      address: oneOf(next, mine ? userAddresses : strangers),
      coin,
      mine
    }
  })
  const funded = resolved.reduce((running, one) => running + one.coin, 0n)
  // Top the first input up where the obligations outrun what was drawn, so the
  // shape stays random but the transaction always balances.
  const shortfall = owedOut - (funded + broughtIn)
  if (shortfall > 0n) {
    resolved[0] = { ...resolved[0], coin: resolved[0].coin + shortfall }
    if (resolved[0].mine) expectedSpent += shortfall
  }

  let remaining = resolved.reduce((running, one) => running + one.coin, 0n) + broughtIn - owedOut
  let expectedReceived = 0n
  const outputs: Array<TransactionOutput> = []
  const payTo = (coin: bigint): void => {
    const mine = next() < 0.6
    if (mine) expectedReceived += coin
    outputs.push({
      form: "legacy",
      address: oneOf(next, mine ? userAddresses : strangers),
      value: { coin, assets: [] },
      datum: null,
      scriptRef: null
    })
  }

  const wanted = upTo(next, 4)
  for (let index = 0; index < wanted && remaining > 0n; index++) {
    const share = index === wanted - 1 ? remaining : between(next, 0n, remaining)
    remaining -= share
    payTo(share)
  }
  if (remaining > 0n) payTo(remaining)

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
      mint: [],
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
    expected: { spent: expectedSpent, received: expectedReceived, withdrawn: expectedWithdrawn }
  }
}
