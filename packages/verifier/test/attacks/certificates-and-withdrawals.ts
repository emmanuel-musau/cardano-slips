/**
 * Attacks on what a transaction stakes and what it drains. A "delegate" link is
 * a Slip whose whole visible effect is a certificate, and a person reading two
 * pool hashes cannot tell them apart — so the certificate a body carries and
 * the rewards it moves are held to the intent the same way an output is.
 *
 * Every case here is one edit away from `honest`, which signs.
 */
import type { Intent } from "@cardano-slips/core"

import { encodeBech32 } from "../../src/bech32.js"
import type { Attack, Slip } from "../support/attacks.js"
import {
  DEADLINE,
  drep,
  otherDrep,
  otherPool,
  pool,
  rewardAccount,
  strangerRewardAccount,
  strangerStakeKey
} from "../support/attacks.js"
import { toHex } from "../support/bytes.js"

const poolId = (hash: Uint8Array): string => encodeBech32("pool", hash)

/** CIP-129 writes a header byte before the credential; 0x22 is a key. */
const drepId = (hash: Uint8Array): string => encodeBech32("drep", Uint8Array.from([0x22, ...hash]))

const stranger = encodeBech32("stake", strangerRewardAccount)

const delegating: Intent = {
  certificates: [{ type: "stakeDelegation", poolId: poolId(pool) }],
  validUntil: DEADLINE
}

const claiming: Intent = { withdrawRewards: true, validUntil: DEADLINE }

/** A plain delegation to the pool the intent names, and change back to the signer. */
export const honest: Slip = {
  declared: delegating,
  paid: [],
  carries: [{ type: "stakeDelegation", pool }]
}

export const attacks: ReadonlyArray<Attack> = [
  {
    name: "wrong-pool",
    lie: "the intent names one pool and the certificate delegates the signer's stake to another",
    declared: delegating,
    paid: [],
    carries: [{ type: "stakeDelegation", pool: otherPool }],
    blocked: [{ code: "certificate.target", index: 0, declared: poolId(pool), carried: poolId(otherPool) }]
  },
  {
    name: "wrong-drep",
    lie: "the intent names one DRep and the certificate hands the signer's vote to another",
    declared: { certificates: [{ type: "voteDelegation", drep: drepId(drep) }], validUntil: DEADLINE },
    paid: [],
    carries: [{ type: "voteDelegation", drep: otherDrep }],
    blocked: [
      { code: "certificate.target", index: 0, declared: `key.${toHex(drep)}`, carried: `key.${toHex(otherDrep)}` }
    ]
  },
  {
    name: "undeclared-deregistration",
    lie: "the intent declares a delegation and the body delegates and then deregisters, so the stake the person meant to move ends up staked nowhere and the deposit comes back as if they had asked for it",
    declared: delegating,
    paid: [],
    carries: [{ type: "stakeDelegation", pool }, { type: "stakeDeregistration" }],
    blocked: [{ code: "certificate.undeclared", declared: 1, carried: 2 }]
  },
  {
    name: "deregistration-in-place-of-the-declared-registration",
    lie: "the intent declares a registration and the body deregisters instead, which unstakes the person in the one move they thought was staking them",
    declared: { certificates: [{ type: "stakeRegistration" }], validUntil: DEADLINE },
    paid: [],
    carries: [{ type: "stakeDeregistration" }],
    blocked: [
      { code: "certificate.missing", declared: 1, carried: 1 },
      { code: "certificate.undeclared", declared: 1, carried: 1 }
    ]
  },
  {
    name: "certificates-out-of-order",
    lie: "the intent registers and then delegates, and the body delegates and then registers — the ledger applies them in order, so only one of the two does what the person was shown",
    declared: {
      certificates: [{ type: "stakeRegistration" }, { type: "stakeDelegation", poolId: poolId(pool) }],
      validUntil: DEADLINE
    },
    paid: [],
    carries: [{ type: "stakeDelegation", pool }, { type: "stakeRegistration" }],
    blocked: [{ code: "certificate.order" }]
  },
  {
    name: "certificate-on-a-strangers-credential",
    lie: "the certificate names the declared pool but acts on a stake credential the wallet never reported, so the signature pays for someone else's delegation",
    declared: delegating,
    paid: [],
    carries: [{ type: "stakeDelegation", pool, credential: strangerStakeKey }],
    blocked: [{ code: "certificate.credential", index: 0 }]
  },
  {
    name: "undeclared-reward-withdrawal",
    lie: "the intent declares a delegation and says nothing about rewards, and the body drains the signer's whole reward balance on the way past",
    declared: delegating,
    paid: [],
    carries: [{ type: "stakeDelegation", pool }],
    withdraws: [{ rewardAccount, amount: 120_000_000n }],
    blocked: [{ code: "withdrawal.undeclared", carried: 1 }]
  },
  {
    name: "withdrawal-to-a-strangers-account",
    lie: "the intent asks to withdraw the signer's rewards and the body withdraws from a reward account the wallet never reported",
    declared: claiming,
    paid: [],
    withdraws: [{ rewardAccount: strangerRewardAccount, amount: 120_000_000n }],
    blocked: [{ code: "withdrawal.account", account: stranger }]
  },
  {
    name: "declared-withdrawal-never-made",
    lie: "the intent says the rewards are being withdrawn and the body withdraws nothing, so the person pays a fee for a claim that did not happen",
    declared: claiming,
    paid: [],
    blocked: [{ code: "withdrawal.missing" }]
  },
  {
    name: "second-undeclared-withdrawal",
    lie: "the intent asks for one withdrawal and the body makes two, the second from an account the wallet never reported",
    declared: claiming,
    paid: [],
    withdraws: [
      { rewardAccount, amount: 120_000_000n },
      { rewardAccount: strangerRewardAccount, amount: 40_000_000n }
    ],
    blocked: [
      { code: "withdrawal.undeclared", carried: 2 },
      { code: "withdrawal.account", account: stranger }
    ]
  }
]
