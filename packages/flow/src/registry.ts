/**
 * Display metadata for the wallets we know by name. Ours to maintain — the one
 * cost ADR-0004 accepted — and deliberately thin: a key an entry does not cover
 * still connects, using the name and icon the extension injects.
 *
 * `install` is the wallet's own home page rather than a store listing, because
 * a store listing is per browser and goes stale on its own schedule.
 */
export type KnownWallet = {
  readonly key: string
  readonly name: string
  readonly install: string
  /** A second key the same extension injects. Hidden while the primary is present. */
  readonly aliasOf?: string
}

export const knownWallets: ReadonlyArray<KnownWallet> = [
  { key: "lace", name: "Lace", install: "https://www.lace.io" },
  { key: "eternl", name: "Eternl", install: "https://eternl.io" },
  { key: "ccvault", name: "Eternl", install: "https://eternl.io", aliasOf: "eternl" },
  { key: "vespr", name: "VESPR", install: "https://vespr.xyz" },
  { key: "typhoncip30", name: "Typhon", install: "https://typhonwallet.io" },
  { key: "nami", name: "Nami", install: "https://www.namiwallet.io" },
  { key: "begin", name: "Begin", install: "https://begin.is" },
  { key: "nufi", name: "NuFi", install: "https://nu.fi" },
  { key: "gerowallet", name: "GeroWallet", install: "https://gerowallet.io" },
  { key: "yoroi", name: "Yoroi", install: "https://yoroi-wallet.com" }
]

const byKey = new Map(knownWallets.map((wallet) => [wallet.key, wallet]))

export const knownWallet = (key: string): KnownWallet | undefined => byKey.get(key)
