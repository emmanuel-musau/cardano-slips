/**
 * The page's own frame, `7 · Hosted page · anatomy`. Fixed and not themeable
 * (`13 · Chrome rules`): the publisher owns the card, never what surrounds it.
 */
import type { Network } from "@cardano-slips/core"
import type { ReactNode } from "react"

const networkNames: Readonly<Record<Network, string>> = {
  mainnet: "Mainnet",
  preprod: "Preprod",
  preview: "Preview"
}

/** A dot and a word. Mainnet is quiet; a test network is named and gets the bar below. */
const NetworkMark = ({ network }: { readonly network: Network | undefined }): React.JSX.Element =>
  network === undefined ? (
    <span className="page__network">—</span>
  ) : (
    <span className="page__network" data-network={network}>
      {network === "mainnet" ? <span className="page__live" aria-hidden="true" /> : undefined}
      {networkNames[network]}
    </span>
  )

export type ChromeProps = {
  /** The host that served the Slip, stated where the publisher cannot style it. */
  readonly host: string | undefined
  readonly network: Network | undefined
  readonly children: ReactNode
}

export const Chrome = ({ children, host, network }: ChromeProps): React.JSX.Element => (
  <div className="slip-root page">
    <header className="page__bar">
      <span className="page__origin">{host}</span>
      <NetworkMark network={network} />
    </header>
    {network === undefined || network === "mainnet" ? undefined : (
      // Never dismissible: a testnet transaction that reads as mainnet is its own kind of harm.
      <p className="page__testnet" role="note">
        {networkNames[network]} testnet · not real funds
      </p>
    )}
    <main className="page__stage">{children}</main>
    <footer className="page__foot">
      <span>No custody, no relayer. Your keys and your funds never leave your wallet.</span>
      <a className="page__link" href="https://github.com/emmanuel-musau/cardano-slips#readme">
        How this works
      </a>
    </footer>
  </div>
)
