/**
 * A CIP-30 provider that answers from a script. Every wallet test runs against
 * this rather than a mock of our own code: the typed wrapper is an assertion
 * about what an extension returns, so mocking it would prove nothing (ADR-0004).
 */
import type { Cip30Api, Cip30Provider } from "../src/cip30.js"

/** A mainnet base address, and the hex CIP-30 returns for it. */
export const mainnetAddress = {
  hex: "01f52f4b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c491273afff94578568768bfab2e84b94fa87f5ae61f8a3ac5edaa2ddfa5d",
  bech32: "addr1q86j7jcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjynn4lleg4u9dpmgh74jap9ef7587khxr79r430d4gkalfws2vu3wk"
}

export const testnetAddress = {
  hex: "007de95d293df3b26372d5aa159fe9b12dd3cf4891190907379325322de2473fb11d227c765bcf5fcb0d8c32709f63b54decf85c8809615faf",
  bech32: "addr_test1qp77jhff8hemycmj6k4pt8lfkyka8n6gjyvsjpehjvjnyt0zgulmz8fz03m9hn6levxccvnsna3m2n0vlpwgsztpt7hslczztq"
}

/** No stake part: a wallet may well hand back an enterprise address. */
export const enterpriseAddress = {
  hex: "61af384b1994711d3adf7bc3fbf0b50ae867aeb219dd3988dce39c4912",
  bech32: "addr1vxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjyseeq605"
}

/** How a wallet rejects: a plain object, never an `Error`. */
export const apiError = (code: number, info: string): unknown => ({ code, info })

const unused = (method: string) => (): never => {
  throw new Error(`the stub was not asked for ${method}`)
}

export type StubApi = Partial<Cip30Api>

export const stubApi = (overrides: StubApi = {}): Cip30Api => ({
  getNetworkId: async () => 1,
  getChangeAddress: async () => mainnetAddress.hex,
  getUsedAddresses: async () => [mainnetAddress.hex],
  getUnusedAddresses: async () => [],
  getRewardAddresses: async () => [],
  getBalance: unused("getBalance"),
  getUtxos: async () => [],
  getCollateral: async () => [],
  signTx: unused("signTx"),
  signData: unused("signData"),
  submitTx: unused("submitTx"),
  ...overrides
})

export type StubProvider = {
  readonly name?: string
  readonly icon?: string
  readonly apiVersion?: string
  readonly supportedExtensions?: ReadonlyArray<{ readonly cip: number }>
  readonly api?: StubApi
  /** What `enable()` rejects with, where it does not resolve. */
  readonly enableRejects?: unknown
  /** What `enable()` resolves to, where it is not an API at all. */
  readonly enableResolves?: unknown
}

export const stubProvider = (options: StubProvider = {}): Cip30Provider => ({
  apiVersion: options.apiVersion ?? "0.1.0",
  name: options.name ?? "Stub",
  icon: options.icon ?? "data:image/svg+xml;base64,PHN2Zy8+",
  supportedExtensions: options.supportedExtensions ?? [],
  isEnabled: async () => false,
  enable: async () => {
    if (options.enableRejects !== undefined) throw options.enableRejects
    if (options.enableResolves !== undefined) return options.enableResolves as Cip30Api
    return stubApi(options.api)
  }
})

/** A window-shaped host carrying exactly the keys given. */
export const hostWith = (wallets: Record<string, unknown>): { readonly cardano: Record<string, unknown> } => ({
  cardano: wallets
})
