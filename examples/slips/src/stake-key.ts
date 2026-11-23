/** Whether the stake key behind a change address is registered, read from Koios. */
import type { Network } from "@cardano-slips/core"
import * as Address from "@evolution-sdk/evolution/Address"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import { Either, Schema } from "effect"

/** Resolves true or false, and rejects whenever the chain's answer cannot be read. */
export type StakeKeyLookup = (changeAddress: string) => Promise<boolean>

const koiosUrl: Readonly<Record<Network, string>> = {
  mainnet: "https://api.koios.rest/api/v1",
  preprod: "https://preprod.koios.rest/api/v1",
  preview: "https://preview.koios.rest/api/v1"
}

const AccountInfo = Schema.Array(
  Schema.Struct({ stake_address: Schema.String, status: Schema.Literal("registered", "not registered") })
)

const stakeAddressOf = (changeAddress: string): string => {
  const address = Address.fromBech32(changeAddress)
  if (address.stakingCredential === undefined) throw new Error(`${changeAddress} carries no stake key`)
  return RewardAccount.toBech32(
    new RewardAccount.RewardAccount({ networkId: address.networkId, stakeCredential: address.stakingCredential })
  )
}

export const koiosStakeKey =
  (network: Network, token?: string): StakeKeyLookup =>
  async (changeAddress) => {
    const stakeAddress = stakeAddressOf(changeAddress)

    const response = await fetch(`${koiosUrl[network]}/account_info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` })
      },
      body: JSON.stringify({ _stake_addresses: [stakeAddress] })
    })
    if (!response.ok) throw new Error(`Koios answered account_info with ${response.status}`)

    const rows = Schema.decodeUnknownEither(AccountInfo)(await response.json())
    if (Either.isLeft(rows)) throw new Error("Koios answered account_info with a body it does not document")

    // A key no transaction has ever carried has no row at all.
    if (rows.right.length === 0) return false
    const row = rows.right.find((candidate) => candidate.stake_address === stakeAddress)
    if (row === undefined) throw new Error("Koios answered account_info about another stake address")
    return row.status === "registered"
  }
