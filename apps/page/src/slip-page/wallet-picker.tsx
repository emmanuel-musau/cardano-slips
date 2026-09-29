/**
 * `9 · Wallet connect`: after an action is chosen, never on arrival, and the
 * one screen where what is shared is spelled out in full.
 */
import type { DiscoveredWallet } from "@cardano-slips/flow"

export type WalletPickerProps = {
  /** The action, as the card put it, so the person can see it is still there. */
  readonly claim: string
  readonly host: string
  readonly wallets: ReadonlyArray<DiscoveredWallet>
  readonly onPick: (key: string) => void
  readonly onBack: () => void
}

export const WalletPicker = ({ claim, host, onBack, onPick, wallets }: WalletPickerProps): React.JSX.Element => (
  <section className="page-connect" aria-labelledby="page-connect-title">
    <div className="page-connect__head">
      <h1 className="page-connect__title" id="page-connect-title">
        Connect a wallet to continue
      </h1>
      <p className="page-connect__claim">{claim}</p>
    </div>
    <ul className="page-connect__wallets">
      {wallets.map((wallet) => (
        <li key={wallet.key}>
          <button type="button" className="page-connect__wallet" onClick={() => onPick(wallet.key)}>
            {wallet.icon === undefined ? (
              <span className="page-connect__icon" aria-hidden="true" />
            ) : (
              <img className="page-connect__icon" src={wallet.icon} alt="" />
            )}
            <span className="page-connect__name">
              <span className="page-connect__wallet-name">{wallet.name}</span>
              <span className="page-connect__detected">Detected</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
    <div className="page-connect__privacy">
      <p>
        <strong>Your wallet contents stay here.</strong> {host} receives one change address so it can name a recipient.
        The list of what you hold is read in this page and never sent anywhere.
      </p>
      <p>You can disconnect at any time. Nothing is signed by connecting.</p>
    </div>
    <button type="button" className="page-connect__back" onClick={onBack}>
      Back
    </button>
  </section>
)
