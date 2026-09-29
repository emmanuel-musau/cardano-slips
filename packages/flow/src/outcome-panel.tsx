"use client"

/**
 * What happens after the person presses sign — `10 · Signing and outcomes`.
 * Every state but the receipt keeps the effects on screen, because waiting is
 * not a modal: a spinner over a hidden ledger asks for trust the panel exists
 * to avoid needing.
 */
import type { Network } from "@cardano-slips/core"
import { useId } from "react"

import type { Derived } from "./derived.js"
import { Ledger } from "./effects-panel.js"
import { ledgerOf } from "./ledger.js"

export type Outcome =
  /** The wallet is open over the page, asked for a signature. */
  | { readonly _tag: "Waiting"; readonly wallet: string }
  /** The person said no in the wallet. Not a failure: the offer stands. */
  | { readonly _tag: "Declined" }
  /** Signed, and on its way to the network. */
  | { readonly _tag: "Submitting"; readonly transactionId: string }
  /** The funds moved; a fresh transaction is being built and will be shown before it is signed. */
  | { readonly _tag: "Rebuilding"; readonly number: number; readonly of: number }
  /** The network refused it. `reason` is the node's own words, shown as they came. */
  | { readonly _tag: "Refused"; readonly reason: string }

export type OutcomePanelProps = {
  readonly claim: string
  readonly derived: Derived
  readonly outcome: Outcome
  /** Cancel while waiting or rebuilding; Close once declined or refused. */
  readonly onClose?: () => void
  /** Review and sign again after a decline; start again after a refusal. */
  readonly onAgain?: () => void
}

const Spinner = (): React.JSX.Element => <span className="slip-panel__spin" aria-hidden="true" />

const Head = ({
  kicker,
  lead,
  title,
  titleId,
  tone
}: {
  readonly kicker: string
  readonly title: string
  readonly titleId: string
  readonly lead?: string
  readonly tone?: "bad" | "warn"
}): React.JSX.Element => (
  <div className="slip-panel__claim">
    <p className="slip-panel__kicker" data-tone={tone}>
      {kicker}
    </p>
    <h2 className="slip-panel__title" id={titleId}>
      {title}
    </h2>
    {lead === undefined ? undefined : <p className="slip-panel__lead">{lead}</p>}
  </div>
)

export const OutcomePanel = ({ claim, derived, onAgain, onClose, outcome }: OutcomePanelProps): React.JSX.Element => {
  const title = useId()
  const rows = ledgerOf(derived)

  switch (outcome._tag) {
    case "Waiting":
      return (
        <section className="slip-root slip-panel" data-outcome="waiting" aria-labelledby={title} aria-busy="true">
          <Head kicker="What you're signing" title={claim} titleId={title} />
          <Ledger rows={rows} />
          <div className="slip-panel__wallet" role="status">
            <Spinner />
            <div className="slip-panel__wallet-words">
              <span>Approve in your wallet</span>
              <span className="slip-panel__note">{outcome.wallet} is open. Nothing is sent until you do.</span>
            </div>
          </div>
          <button type="button" className="slip-panel__button" data-kind="cancel" onClick={onClose}>
            Cancel
          </button>
        </section>
      )

    case "Declined":
      return (
        <section className="slip-root slip-panel" data-outcome="declined" aria-labelledby={title}>
          <Head
            kicker="Not signed"
            title="You declined in your wallet"
            titleId={title}
            lead="Nothing was sent and nothing left your wallet. The link still works if you want to look again."
          />
          <div className="slip-panel__stale">
            <Ledger rows={rows} />
          </div>
          <div className="slip-panel__buttons">
            <button type="button" className="slip-panel__button" data-kind="close" onClick={onClose}>
              Close
            </button>
            <button type="button" className="slip-panel__button" data-kind="primary" onClick={onAgain}>
              Review and sign again
            </button>
          </div>
        </section>
      )

    case "Submitting":
      return (
        <section className="slip-root slip-panel" data-outcome="submitting" aria-labelledby={title} aria-busy="true">
          <Head kicker="Submitting" title="Sending your signed transaction" titleId={title} />
          <ol className="slip-panel__steps">
            <li className="slip-panel__step">
              <span className="slip-panel__tick" aria-hidden="true">
                ✓
              </span>
              <span>Signature checked against the transaction you read</span>
            </li>
            <li className="slip-panel__step" role="status">
              <Spinner />
              <span>Handing it to the network</span>
            </li>
          </ol>
          {/* The id is what a person can carry away if the page dies mid-submit, so it is here in full. */}
          <div className="slip-panel__transaction">
            <span className="slip-panel__note">Transaction</span>
            <span className="slip-panel__transaction-id">{outcome.transactionId}</span>
          </div>
        </section>
      )

    case "Rebuilding":
      return (
        <section className="slip-root slip-panel" data-outcome="rebuilding" aria-labelledby={title} aria-busy="true">
          <Head
            kicker="Rebuilding"
            tone="warn"
            title="Your funds moved while you were signing"
            titleId={title}
            lead="Something else spent the outputs this transaction used. Nothing was signed twice and nothing left your wallet."
          />
          <div className="slip-panel__wallet" role="status">
            <Spinner />
            <div className="slip-panel__wallet-words">
              <span>Building a fresh transaction</span>
              <span className="slip-panel__note">
                Attempt {outcome.number} of {outcome.of}
              </span>
            </div>
          </div>
          <p className="slip-panel__note">
            It will have different amounts and a different id, so you'll see its effects checked before your wallet is
            asked again.
          </p>
          <div className="slip-panel__stale">
            <Ledger rows={rows} />
          </div>
          <button type="button" className="slip-panel__button" data-kind="cancel" onClick={onClose}>
            Cancel
          </button>
        </section>
      )

    case "Refused":
      return (
        <section className="slip-root slip-panel" data-outcome="refused" aria-labelledby={title}>
          <Head
            kicker="Not submitted"
            tone="bad"
            title="The network wouldn't accept this transaction"
            titleId={title}
            lead="You signed it, but it never took effect and nothing left your wallet. Your signature cannot be reused."
          />
          <pre className="slip-panel__reason">{outcome.reason}</pre>
          <div className="slip-panel__buttons">
            <button type="button" className="slip-panel__button" data-kind="close" onClick={onClose}>
              Close
            </button>
            <button type="button" className="slip-panel__button" data-kind="primary" onClick={onAgain}>
              Start again
            </button>
          </div>
        </section>
      )
  }
}

export type SlipReceiptProps = {
  readonly claim: string
  readonly derived: Derived
  readonly transactionId: string
  readonly network: Network
  /** Where this transaction can be looked up: the only durable copy anyone keeps. */
  readonly explorer: { readonly name: string; readonly url: string }
}

/** A transaction id is hex with no separator, so it is shortened from both ends. */
const shortId = (id: string): string => (id.length <= 12 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`)

const networkNames: Readonly<Record<Network, string>> = { mainnet: "mainnet", preprod: "Preprod", preview: "Preview" }

/**
 * `10 · d`, back on the card surface. It says sent rather than confirmed: the
 * node accepted the transaction, and nothing here watches the chain for it.
 */
export const SlipReceipt = ({
  claim,
  derived,
  explorer,
  network,
  transactionId
}: SlipReceiptProps): React.JSX.Element => {
  const title = useId()
  return (
    <section className="slip-root slip-receipt" aria-labelledby={title}>
      <div className="slip-receipt__head">
        <span className="slip-receipt__tick" aria-hidden="true">
          ✓
        </span>
        <div className="slip-receipt__identity">
          <h2 className="slip-receipt__title" id={title}>
            {claim}
          </h2>
          <span className="slip-receipt__note">Sent to {networkNames[network]}</span>
        </div>
      </div>
      <div className="slip-receipt__ledger">
        {ledgerOf(derived).map((row) => (
          <div key={row.key} className="slip-receipt__row">
            <span className="slip-receipt__label">{row.label}</span>
            <span className="slip-receipt__amounts">
              {row.identifier ?? undefined}
              {row.amounts.map((amount, index) => (
                <span key={index} className="slip-receipt__amount" data-tone={amount.tone}>
                  {amount.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="slip-receipt__transaction">
        <span className="slip-receipt__kicker">Transaction</span>
        <span className="slip-receipt__id" title={transactionId}>
          {shortId(transactionId)}
        </span>
        <a className="slip-receipt__link" href={explorer.url} target="_blank" rel="noreferrer">
          View on {explorer.name}
        </a>
      </div>
      <p className="slip-receipt__note slip-receipt__foot">
        No account was created and nothing was stored. This page keeps none of it.
      </p>
    </section>
  )
}
