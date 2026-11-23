/**
 * A delegation Slip: no output, and the stake key registered first, deposit and
 * all, where the chain says it is not. Its pool and registered-key message are
 * the spec's own, so the fixture and the written spec cannot drift apart.
 */
import type { Certificate, Network } from "@cardano-slips/core"
import { defineSlip, fail } from "@cardano-slips/server"

import { inMinutes } from "./deadline.js"
import { koiosStakeKey, stakeAddressOf, type StakeKeyLookup } from "./stake-key.js"

export const communityPool = "pool1ayfz9ymjutjzx0a33q8tq6zrn8lj3ckmzp69c9vxk8kyxylly5y"

/** The delegate Slip for any network, pointed at a pool that exists there. */
export const delegateSlip = (network: Network, pool: string, isRegistered: StakeKeyLookup) =>
  defineSlip({
    network,

    get: () => ({
      title: "Delegate to the Community Stake Pool",
      description: "One delegation certificate. No payment to anyone, and the pool never gains control of your funds.",
      icon: "https://linktap.example/i/community-pool.png",
      label: "Delegate"
    }),

    post: async ({ changeAddress }) => {
      if (stakeAddressOf(changeAddress) === undefined) {
        return fail("INVALID_PARAMETER", "This wallet's address has no stake key, so it cannot delegate.")
      }

      let registered: boolean
      try {
        registered = await isRegistered(changeAddress)
      } catch {
        return fail(
          "UPSTREAM_FAILURE",
          "We could not check whether your stake key is registered, so nothing was built. Try again in a minute."
        )
      }

      const delegation: Certificate = { type: "stakeDelegation", poolId: pool }
      return registered
        ? {
            intent: { certificates: [delegation], validUntil: inMinutes(10) },
            message: "Delegate to the Community Stake Pool. Your ADA never leaves your wallet."
          }
        : {
            intent: { certificates: [{ type: "stakeRegistration" }, delegation], validUntil: inMinutes(10) },
            message:
              "Register your stake key and delegate to the Community Stake Pool. Registering holds a deposit you get back if you deregister."
          }
    }
  })

export const delegate = delegateSlip("mainnet", communityPool, koiosStakeKey("mainnet"))
