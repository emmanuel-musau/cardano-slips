import { knownWallets } from "@cardano-slips/flow"

import type { Notice } from "./notices.js"

export type NoticeCardProps = {
  readonly notice: Notice
  readonly host: string | undefined
  /** Where "Open …" goes: the publisher's own site, never the endpoint. */
  readonly site: string | undefined
  readonly onRetry?: () => void
  /** Seconds before a retry may go. The button waits rather than letting a person hammer the endpoint. */
  readonly retryIn?: number
  readonly onBack?: () => void
}

const Move = ({ host, notice, onBack, onRetry, retryIn = 0, site }: NoticeCardProps): React.JSX.Element | undefined => {
  switch (notice.move) {
    case "retry": {
      if (onRetry === undefined) return undefined
      const label = notice.moveLabel ?? "Try again"
      return (
        <button type="button" className="page-notice__move" onClick={onRetry} disabled={retryIn > 0}>
          {retryIn > 0 ? `${label} in ${retryIn}s` : label}
        </button>
      )
    }
    case "site":
      return site === undefined || host === undefined ? undefined : (
        <a className="page-notice__move" href={site} rel="noreferrer">
          Open {host}
        </a>
      )
    case "back":
      return onBack === undefined ? undefined : (
        <button type="button" className="page-notice__move" onClick={onBack}>
          Back
        </button>
      )
    case "wallets":
      return (
        <ul className="page-notice__wallets" aria-label="Wallets that work here">
          {knownWallets.map((wallet) => (
            <li key={wallet.key}>
              <a className="page__link" href={wallet.install} target="_blank" rel="noreferrer">
                {wallet.name}
              </a>
            </li>
          ))}
        </ul>
      )
    case "none":
      return undefined
  }
}

export const NoticeCard = (props: NoticeCardProps): React.JSX.Element => {
  const { host, notice } = props
  return (
    <section className="page-notice" data-tone={notice.tone} role="alert">
      <h1 className="page-notice__title">{notice.title}</h1>
      <p className="page-notice__text">{notice.text}</p>
      {notice.said === undefined ? undefined : (
        <p className="page-notice__said">
          {host} says: “{notice.said}”
        </p>
      )}
      <Move {...props} />
      {notice.code === undefined ? undefined : <p className="page-notice__code">{notice.code}</p>}
    </section>
  )
}
