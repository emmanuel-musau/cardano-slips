"use client"

/**
 * The transaction preview, drawn from `4 · Anatomy` and `6 · Preview states` on
 * the design sheet. Every figure is derived from the transaction; the claim is
 * only the title it is held against. A mismatch removes the sign button rather
 * than disabling it, and no prop brings it back.
 */
import type { Verdict } from "@cardano-slips/verifier"
import { useEffect, useId, useState } from "react"

import type { Derived } from "./derived.js"
import { formatCountdown, secondsLeft } from "./explain.js"
import {
  blockedLine,
  evidenceOf,
  groupsOf,
  headlineOf,
  isCollapsed,
  isGrouped,
  ledgerOf,
  matchLine,
  rawLines,
  type Group,
  type Row
} from "./ledger.js"

export type EffectsPanelProps = {
  /** What the card promised, restated so it can be compared with what follows. */
  readonly claim: string
  /** The card's description, set beside the transaction when the two disagree. */
  readonly description?: string
  /** The host that served the link, as a host only. Whether it is verified is the identity chip's to say. */
  readonly origin?: string
  readonly derived: Derived
  /** The verifier's own verdict. Required, so no caller renders a match by leaving the reasons out. */
  readonly verdict: Verdict
  /** Read once a second for the countdown. */
  readonly clock?: () => number
  readonly onSign?: () => void
  readonly onCancel?: () => void
  readonly onRebuild?: () => void
  /** "Report this link" is offered only where there is somewhere to send the report. */
  readonly onReport?: () => void
}

/** Under this, the countdown leaves the meta row and takes the headline's place (state f). */
const expiringUnder = 60

const groupNames: { readonly [group in Group]: string } = {
  arriving: "Arriving",
  leaving: "Leaving",
  unmoved: "No value moved"
}

const markWords = { "not-in-the-link": "Not in the link", "not-as-the-link-says": "Not as the link says" } as const

const chipWords = { refundable: "Refundable", "as-stated": "As stated" } as const

const useNow = (clock: () => number): number => {
  const [now, setNow] = useState(clock)
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 1000)
    return () => clearInterval(timer)
  }, [clock])
  return now
}

const LedgerRow = ({ row }: { readonly row: Row }): React.JSX.Element => (
  <div className="slip-panel__row" data-mark={row.mark}>
    <div className="slip-panel__row-name">
      <div className="slip-panel__row-label">
        <span className="slip-panel__label">{row.label}</span>
        {row.chip === undefined ? undefined : (
          <span className="slip-panel__chip" data-chip={row.chip}>
            {chipWords[row.chip]}
          </span>
        )}
        {row.mark === undefined ? undefined : (
          <span className="slip-panel__chip" data-chip="mark">
            {markWords[row.mark]}
          </span>
        )}
      </div>
      {row.detail === undefined ? undefined : <span className="slip-panel__detail">{row.detail}</span>}
    </div>
    <div className="slip-panel__amounts">
      {row.identifier === undefined ? undefined : <span className="slip-panel__identifier">{row.identifier}</span>}
      {row.amounts.map((amount, index) => (
        <span key={index} className="slip-panel__amount" data-tone={amount.tone}>
          {amount.text}
        </span>
      ))}
    </div>
    {row.note === undefined ? undefined : <p className="slip-panel__note">{row.note}</p>}
  </div>
)

const Rows = ({ rows }: { readonly rows: ReadonlyArray<Row> }): React.JSX.Element => (
  <div className="slip-panel__ledger">
    {rows.map((row) => (
      <LedgerRow key={row.key} row={row} />
    ))}
  </div>
)

/**
 * Past eight rows each group folds to its header and a count. A group holding
 * a marked row never starts folded: the one thing the block points at is not
 * something a person should have to open.
 */
const Ledger = ({ rows }: { readonly rows: ReadonlyArray<Row> }): React.JSX.Element => {
  if (!isGrouped(rows)) return <Rows rows={rows} />
  const collapsed = isCollapsed(rows)
  return (
    <div className="slip-panel__groups">
      {groupsOf(rows).map(({ group, rows: inGroup }) =>
        collapsed ? (
          <details
            key={group}
            className="slip-panel__group"
            open={inGroup.some((row) => row.mark !== undefined) || undefined}
          >
            <summary className="slip-panel__group-name">
              {groupNames[group]} · {inGroup.length}
            </summary>
            <Rows rows={inGroup} />
          </details>
        ) : (
          <div key={group} className="slip-panel__group">
            <p className="slip-panel__group-name">{groupNames[group]}</p>
            <Rows rows={inGroup} />
          </div>
        )
      )}
    </div>
  )
}

const Raw = ({ derived }: { readonly derived: Derived }): React.JSX.Element => (
  <pre className="slip-panel__raw-lines">{rawLines(derived).join("\n")}</pre>
)

const Countdown = ({ seconds }: { readonly seconds: number }): React.JSX.Element => (
  // The server and the browser read the clock a moment apart.
  <span suppressHydrationWarning>{formatCountdown(seconds)}</span>
)

const Blocked = ({
  claim,
  description,
  derived,
  reasons,
  onCancel,
  onReport
}: Pick<EffectsPanelProps, "claim" | "description" | "derived" | "onCancel" | "onReport"> & {
  readonly reasons: Extract<Verdict, { _tag: "mismatch" }>["reasons"]
}): React.JSX.Element => {
  const [rawOpen, setRawOpen] = useState(false)
  const title = useId()
  const rows = ledgerOf(derived, reasons)
  return (
    <section className="slip-root slip-panel" data-blocked="" aria-labelledby={title}>
      <div className="slip-panel__claim" role="alert">
        <p className="slip-panel__kicker" data-tone="bad">
          Signing blocked
        </p>
        <h2 className="slip-panel__title" id={title}>
          This transaction doesn't do what the link says
        </h2>
        <p className="slip-panel__lead">{blockedLine(reasons)}</p>
      </div>

      <div className="slip-panel__compare">
        <div className="slip-panel__side">
          <p className="slip-panel__kicker">The link claims</p>
          <p className="slip-panel__claimed">{claim}</p>
          {description === undefined ? undefined : <p className="slip-panel__note">{description}</p>}
        </div>
        <div className="slip-panel__side" data-tone="bad">
          <p className="slip-panel__kicker" data-tone="bad">
            The transaction does
          </p>
          {reasons.map((reason, index) => {
            const { figure, lines } = evidenceOf(reason, derived)
            return (
              <div key={index} className="slip-panel__evidence">
                {figure === undefined ? undefined : <p className="slip-panel__evidence-figure">{figure}</p>}
                {lines.map((line) => (
                  <p key={line} className="slip-panel__detail">
                    {line}
                  </p>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      <Ledger rows={rows} />

      {rawOpen ? <Raw derived={derived} /> : undefined}

      <div className="slip-panel__exits">
        <button type="button" className="slip-panel__button" data-kind="close" onClick={onCancel}>
          Close without signing
        </button>
        <div className="slip-panel__quiet">
          <button
            type="button"
            className="slip-panel__button"
            data-kind="quiet"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((open) => !open)}
          >
            {rawOpen ? "Hide raw transaction" : "Show raw transaction"}
          </button>
          {onReport === undefined ? undefined : (
            <button type="button" className="slip-panel__button" data-kind="quiet" onClick={onReport}>
              Report this link
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

export const EffectsPanel = ({
  claim,
  description,
  origin,
  derived,
  verdict,
  clock = Date.now,
  onSign,
  onCancel,
  onRebuild,
  onReport
}: EffectsPanelProps): React.JSX.Element => {
  const now = useNow(clock)
  const [rawOpen, setRawOpen] = useState(false)
  const title = useId()

  if (verdict._tag === "mismatch") {
    return (
      <Blocked
        claim={claim}
        derived={derived}
        reasons={verdict.reasons}
        {...(description === undefined ? {} : { description })}
        {...(onCancel === undefined ? {} : { onCancel })}
        {...(onReport === undefined ? {} : { onReport })}
      />
    )
  }

  const rows = ledgerOf(derived)
  const until = derived.effects.validity.validUntil
  const seconds = until === null ? undefined : secondsLeft(until.time, BigInt(now))

  if (seconds === 0) {
    return (
      <section className="slip-root slip-panel" data-expired="" aria-labelledby={title}>
        <div className="slip-panel__claim">
          <p className="slip-panel__kicker" data-tone="warn">
            Expired
          </p>
          <h2 className="slip-panel__title" id={title}>
            This transaction ran out of time
          </h2>
          <p className="slip-panel__lead">
            Nothing was signed and nothing left your wallet. Building a new one takes a second, and the amounts will be
            checked again.
          </p>
        </div>
        <div className="slip-panel__stale">
          <Ledger rows={rows} />
        </div>
        <div className="slip-panel__buttons">
          <button type="button" className="slip-panel__button" data-kind="cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="slip-panel__button" data-kind="primary" onClick={onRebuild}>
            Build a new transaction
          </button>
        </div>
      </section>
    )
  }

  const headline = headlineOf(derived)
  const expiring = seconds !== undefined && seconds < expiringUnder

  return (
    <section className="slip-root slip-panel" aria-labelledby={title}>
      <div className="slip-panel__claim">
        <p className="slip-panel__kicker">What you're signing</p>
        <h2 className="slip-panel__title" id={title}>
          {claim}
        </h2>
        {origin === undefined ? undefined : <span className="slip-panel__origin">{origin}</span>}
      </div>

      {expiring ? (
        <div className="slip-panel__expiring" role="timer">
          <div className="slip-panel__expiring-head">
            <span>This transaction expires in</span>
            <span className="slip-panel__expiring-clock">
              <Countdown seconds={seconds} />
            </span>
          </div>
          <div className="slip-panel__bar" aria-hidden="true">
            <span
              className="slip-panel__bar-fill"
              suppressHydrationWarning
              style={{ width: `${(seconds / expiringUnder) * 100}%` }}
            />
          </div>
          <p className="slip-panel__note">After that the amounts could be stale, so we'll build a fresh one.</p>
        </div>
      ) : (
        <div className="slip-panel__headline">
          <div className="slip-panel__figure">
            <span className="slip-panel__note">{headline.label}</span>
            <span className="slip-panel__figure-amount" data-tone={headline.tone}>
              {headline.amount}
            </span>
            {headline.fee === undefined ? undefined : <span className="slip-panel__note">{headline.fee}</span>}
          </div>
          {headline.held === undefined ? undefined : (
            <>
              <span className="slip-panel__rule" aria-hidden="true" />
              <div className="slip-panel__figure">
                <span className="slip-panel__note">{headline.held.label}</span>
                <span className="slip-panel__figure-amount" data-tone={headline.held.tone}>
                  {headline.held.amount}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <Ledger rows={rows} />

      {expiring || seconds === undefined ? undefined : (
        <div className="slip-panel__expiry">
          <span className="slip-panel__note">Expires in</span>
          <span className="slip-panel__clock">
            <Countdown seconds={seconds} />
          </span>
        </div>
      )}

      <p className="slip-panel__verdict">
        <span className="slip-panel__tick" aria-hidden="true">
          ✓
        </span>
        <span>{matchLine(derived, rows)}</span>
      </p>

      <div className="slip-panel__buttons">
        <button type="button" className="slip-panel__button" data-kind="cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="slip-panel__button" data-kind="primary" onClick={onSign}>
          Sign transaction
        </button>
      </div>

      <div className="slip-panel__raw">
        <button
          type="button"
          className="slip-panel__raw-toggle"
          aria-expanded={rawOpen}
          onClick={() => setRawOpen((open) => !open)}
        >
          <span aria-hidden="true">{rawOpen ? "▾" : "▸"}</span>
          <span>Raw transaction</span>
        </button>
        {rawOpen ? <Raw derived={derived} /> : undefined}
      </div>
    </section>
  )
}
