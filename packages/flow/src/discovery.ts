/**
 * What is injected at `window.cardano`, read on demand. Nothing here touches a
 * browser global at module scope: this SDK is imported by server-rendered pages
 * we do not control, and a module that reads `window` while loading breaks them
 * before any of it runs (ADR-0004).
 */
import { type Cip30Provider, isCip30Provider } from "./cip30.js"
import { knownWallet } from "./registry.js"

export type DiscoveredWallet = {
  /** The `window.cardano` key. What `connectWallet` is asked for. */
  readonly key: string
  readonly name: string
  readonly icon: string | undefined
  readonly apiVersion: string
  /** CIP numbers the provider says it supports, before `enable()` negotiates any of them. */
  readonly extensions: ReadonlyArray<number>
  /** Present only for a wallet in the registry. */
  readonly install: string | undefined
  readonly provider: Cip30Provider
}

/** Anything with a `cardano` namespace: a `Window`, or a stand-in in a test. */
export type WalletHost = { readonly cardano?: unknown }

const namespaceOf = (host: unknown): Record<string, unknown> | undefined => {
  if (typeof host !== "object" || host === null) return undefined
  const cardano = (host as Record<string, unknown>).cardano
  if (typeof cardano !== "object" || cardano === null) return undefined
  return cardano as Record<string, unknown>
}

const extensionsOf = (provider: Cip30Provider): ReadonlyArray<number> =>
  (provider.supportedExtensions ?? [])
    .filter((extension) => typeof extension?.cip === "number")
    .map((extension) => extension.cip)

const describe = (key: string, provider: Cip30Provider): DiscoveredWallet => {
  const known = knownWallet(key)
  return {
    key,
    // The registry wins over the injected name so one extension reads the same
    // way in every list; an unknown wallet still gets to name itself.
    name: known?.name ?? (provider.name === "" ? key : provider.name),
    icon: typeof provider.icon === "string" && provider.icon !== "" ? provider.icon : undefined,
    apiVersion: provider.apiVersion,
    extensions: extensionsOf(provider),
    install: known?.install,
    provider
  }
}

/**
 * Every CIP-30 provider in the namespace, by display name. Returns an empty
 * list where there is no namespace at all — a page with no wallet and a page
 * rendered on a server are the same case to a caller, and neither is an error.
 */
export const discoverWallets = (host: unknown = globalThis): ReadonlyArray<DiscoveredWallet> => {
  const namespace = namespaceOf(host)
  if (namespace === undefined) return []

  const found = new Map<string, DiscoveredWallet>()
  for (const key of Object.keys(namespace)) {
    const provider = namespace[key]
    if (isCip30Provider(provider)) found.set(key, describe(key, provider))
  }

  // An extension injecting two keys is one wallet: listing it twice asks the
  // person to choose between a wallet and itself.
  for (const key of [...found.keys()]) {
    const alias = knownWallet(key)?.aliasOf
    if (alias !== undefined && found.has(alias)) found.delete(key)
  }

  return [...found.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key)
  )
}

/**
 * Whatever sits under the key, connector or not. Lets a caller separate a
 * wallet that is not installed from one that is and does not speak CIP-30.
 */
export const injectedUnder = (key: string, host: unknown = globalThis): unknown => namespaceOf(host)?.[key]

/** The provider under one key, or `undefined` where nothing usable is there. */
export const findWallet = (key: string, host: unknown = globalThis): DiscoveredWallet | undefined => {
  const namespace = namespaceOf(host)
  if (namespace === undefined) return undefined
  const provider = namespace[key]
  return isCip30Provider(provider) ? describe(key, provider) : undefined
}
