/**
 * A delegation Slip: one certificate, no output, nothing spent but the fee.
 * Its pool and message are the spec's own, so the fixture and the written spec
 * cannot drift apart without a test noticing.
 */
import { defineSlip } from "@cardano-slips/server"

import { inMinutes } from "./deadline.js"

export const communityPool = "pool1ayfz9ymjutjzx0a33q8tq6zrn8lj3ckmzp69c9vxk8kyxylly5y"

export const delegate = defineSlip({
  network: "mainnet",

  get: () => ({
    title: "Delegate to the Community Stake Pool",
    description: "One delegation certificate. No payment to anyone, and the pool never gains control of your funds.",
    icon: "https://linktap.example/i/community-pool.png",
    label: "Delegate"
  }),

  post: () => ({
    intent: {
      certificates: [{ type: "stakeDelegation", poolId: communityPool }],
      validUntil: inMinutes(10)
    },
    message: "Delegate to the Community Stake Pool. Your ADA never leaves your wallet."
  })
})
