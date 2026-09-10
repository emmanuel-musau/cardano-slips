/**
 * `enable()` and the three answers a connection is not usable without: the API
 * object, the network, and the change address. Everything downstream of here —
 * UTxOs, balancing, signing — goes through evolution-sdk with this API object
 * (ADR-0004).
 */
import { type Network } from "@cardano-slips/core"
import { Effect } from "effect"

import { type NetworkId, readWalletAddress } from "./address.js"
import { type Cip30Api, describeApiError, isCip30Api, readApiError, REFUSED } from "./cip30.js"
import { type DiscoveredWallet, findWallet, injectedUnder } from "./discovery.js"
import { refuse, type WalletConnectError } from "./wallet-error.js"

export type ConnectOptions = {
  /** The network the Slip declares. The wallet is held to it, not asked for it. */
  readonly network: Network
  /** Where `cardano` lives. Defaults to the global object, so a test never needs one. */
  readonly host?: unknown
  /** CIP extensions to ask for. A wallet may grant fewer, and none of ours are required. */
  readonly extensions?: ReadonlyArray<{ readonly cip: number }>
}

export type ConnectedWallet = {
  readonly wallet: DiscoveredWallet
  readonly api: Cip30Api
  /** The Slip's network, now known to be the wallet's as well. */
  readonly network: Network
  readonly networkId: NetworkId
  /** Bech32, ready for a `BuildRequest`. */
  readonly changeAddress: string
}

/**
 * A CIP-19 address separates mainnet from testnet and no further, so this is
 * every network id there is — preprod and preview are one value here. Telling
 * them apart is exactly why a Slip states its network by name (`core/types.ts`).
 */
export const networkIdFor = (network: Network): NetworkId => (network === "mainnet" ? 1 : 0)

const networkNames: Readonly<Record<NetworkId, string>> = { 0: "a test network", 1: "mainnet" }

const call = <A>(key: string, method: string, run: () => Promise<A>): Effect.Effect<A, WalletConnectError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => {
      const cip30 = readApiError(cause)
      return refuse(
        "Unreadable",
        key,
        `${method} failed: ${cip30 === undefined ? String(cause) : describeApiError(cip30)}`,
        cip30
      )
    }
  })

/**
 * Connects, or says why not. The network check happens here rather than in a
 * component because it decides whether there is a connection at all: a wallet
 * on another chain cannot sign this Slip's transaction, and letting the flow
 * continue only moves the failure to where it costs a person more.
 */
export const connectWallet = (
  key: string,
  options: ConnectOptions
): Effect.Effect<ConnectedWallet, WalletConnectError> =>
  Effect.gen(function* () {
    const host = options.host ?? globalThis
    const wallet = findWallet(key, host)
    if (wallet === undefined) {
      return yield* Effect.fail(
        injectedUnder(key, host) === undefined
          ? refuse("NotInjected", key, "no wallet is installed under this name")
          : refuse("NotCip30", key, "what is installed under this name does not implement CIP-30")
      )
    }

    const api = yield* Effect.tryPromise({
      try: () => wallet.provider.enable(options.extensions),
      catch: (cause) => {
        const cip30 = readApiError(cause)
        if (cip30?.code === REFUSED) {
          return refuse("Refused", key, "the connection was declined in the wallet", cip30)
        }
        const detail = cip30 === undefined ? String(cause) : describeApiError(cip30)
        return refuse("EnableFailed", key, `the wallet could not be connected: ${detail}`, cip30)
      }
    })

    // `enable()` is typed to return the API and is under no obligation to.
    if (!isCip30Api(api)) {
      return yield* Effect.fail(refuse("NotCip30", key, "the wallet connected without returning a CIP-30 API"))
    }

    const reported = yield* call(key, "getNetworkId", () => api.getNetworkId())
    if (reported !== 0 && reported !== 1) {
      return yield* Effect.fail(refuse("Unreadable", key, `getNetworkId answered ${String(reported)}`))
    }
    const networkId: NetworkId = reported === 1 ? 1 : 0

    const hex = yield* call(key, "getChangeAddress", () => api.getChangeAddress())
    const address = yield* readWalletAddress(hex).pipe(
      Effect.mapError((detail) => refuse("Unreadable", key, `getChangeAddress answered ${detail}`))
    )

    // Two answers about one wallet. A wallet that gives both cannot be taken at
    // either word, and the disagreement is not the person's to resolve.
    if (address.networkId !== networkId) {
      return yield* Effect.fail(
        refuse(
          "Unreadable",
          key,
          `the wallet reports ${networkNames[networkId]} and its change address is on ${networkNames[address.networkId]}`
        )
      )
    }

    const expected = networkIdFor(options.network)
    if (networkId !== expected) {
      return yield* Effect.fail(
        refuse(
          "WrongNetwork",
          key,
          `this Slip is on ${options.network} and the wallet is on ${networkNames[networkId]}`
        )
      )
    }

    return {
      wallet,
      api,
      network: options.network,
      networkId,
      changeAddress: address.bech32
    }
  })
