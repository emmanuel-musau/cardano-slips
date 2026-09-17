/**
 * The rendered face of a Slip link — `2 · Action card` on the design sheet.
 * It renders what the endpoint declared and collects what the endpoint asked
 * for; it makes no claim about the transaction, which is the effects panel's
 * job and is checked against the bytes rather than against this card.
 *
 * The Slip is assumed to have been decoded and passed `checkTemplates`: a
 * response with a placeholder naming no parameter is one a client never renders.
 */
import { checkValues, fillHref, type LinkedAction, type ParameterValues, type Slip } from "@cardano-slips/core"
import { Either } from "effect"
import { useState } from "react"

import { actionLabel, actionsOf, blockedLabel, closureOf, monogramOf, originOf, valuesFor } from "./card.js"
import { type FieldError, ParameterForm } from "./parameter-form.js"

/** What the person chose, ready to `POST`. */
export type SlipSubmission = {
  readonly action: LinkedAction
  /** Only what this action asked for. A caller is handed no answer it did not request. */
  readonly values: ParameterValues
  /** Absolute, with every placeholder percent-encoded, so no typed value can move the request. */
  readonly href: string
}

export type SlipCardProps = {
  readonly slip: Slip
  /**
   * Where the metadata came from. Every `href` resolves against it and its host
   * is the publisher the card names, so the card cannot be rendered without it.
   */
  readonly discoveryUrl: string
  readonly onSubmit?: (submission: SlipSubmission) => void
  /**
   * What the endpoint refused, by parameter name. The only failure that lands
   * on a field instead of replacing the card, because there is something to fix.
   * It is the caller's to clear, since only the caller knows which answer the
   * endpoint was refusing.
   */
  readonly rejected?: Readonly<Record<string, FieldError>>
  /** True while a request is in flight: every button stops taking presses. */
  readonly busy?: boolean
  /** Prefixes generated ids, so two cards on one page do not collide. */
  readonly idPrefix?: string
}

/** The line that is the whole point of the card, and the reason it is worth pressing. */
const promise = "You'll see the exact effects, checked against this card, before you sign."

/** Nothing to choose between means the one action is already the open one. */
const opened = (count: number): number | undefined => (count === 1 ? 0 : undefined)

export const SlipCard = ({
  slip,
  discoveryUrl,
  onSubmit,
  rejected,
  busy = false,
  idPrefix = "slip"
}: SlipCardProps): React.JSX.Element => {
  const actions = actionsOf(slip, discoveryUrl)

  const [values, setValues] = useState<ParameterValues>({})
  // Errors stay quiet until a send is attempted: a card that opens red is
  // scolding someone for not having typed yet.
  const [attempted, setAttempted] = useState(false)
  const [open, setOpen] = useState<number | undefined>(opened(actions.length))
  const [failedIcon, setFailedIcon] = useState<string | undefined>(undefined)

  // Resetting during render is React's own answer to a prop moving out from
  // under the state derived from it. A second Slip must not open pre-filled
  // with the first one's answers, and remembering to pass a `key` is not a
  // thing to leave to whoever embeds this.
  const [shown, setShown] = useState(discoveryUrl)
  if (shown !== discoveryUrl) {
    setShown(discoveryUrl)
    setValues({})
    setAttempted(false)
    setOpen(opened(actions.length))
    setFailedIcon(undefined)
  }

  const closed = slip.disabled === true
  const parameters = (open === undefined ? undefined : actions[open]?.parameters) ?? []
  const issues = checkValues(parameters, values)
  const blocked = attempted && issues.length > 0

  // `??=` would be wrong here: a parameter may be called `constructor`, and a
  // plain object already answers to that with something that is not nullish.
  const errors: Record<string, FieldError> = {}
  const note = (name: string, error: FieldError): void => {
    if (!Object.hasOwn(errors, name)) errors[name] = error
  }
  if (attempted) for (const issue of issues) note(issue.name, { message: issue.message })
  for (const [name, error] of Object.entries(rejected ?? {})) note(name, error)

  const press = (index: number): void => {
    const action = actions[index]

    // The spec: an action without parameters is submitted as soon as it is
    // chosen. One that has them opens its form instead of sending blind.
    if (action.parameters !== undefined && index !== open) {
      setOpen(index)
      setAttempted(false)
      return
    }

    const target = fillHref(action, values, discoveryUrl)
    if (Either.isLeft(target)) {
      setAttempted(true)
      return
    }
    onSubmit?.({ action, values: valuesFor(action, values), href: target.right })
  }

  const monogram = monogramOf(discoveryUrl)
  const origin = originOf(discoveryUrl)

  return (
    <div className="slip-root slip-card" data-closed={closed ? "" : undefined} data-busy={busy ? "" : undefined}>
      <div className="slip-card__head">
        <div className="slip-card__icon">
          {failedIcon !== slip.icon ? (
            <img className="slip-card__image" src={slip.icon} alt="" onError={() => setFailedIcon(slip.icon)} />
          ) : monogram === undefined ? (
            <span className="slip-card__pattern" />
          ) : (
            <span className="slip-card__monogram">{monogram}</span>
          )}
        </div>
        <div className="slip-card__identity">
          <h2 className="slip-card__title">{slip.title}</h2>
          {origin === undefined ? undefined : <span className="slip-card__origin">{origin}</span>}
        </div>
      </div>

      {/* Plain text by the spec: a description carries no markup, so none is parsed. */}
      <p className="slip-card__description">{slip.description}</p>

      {parameters.length === 0 ? undefined : (
        <ParameterForm
          parameters={parameters}
          values={values}
          errors={errors}
          idPrefix={idPrefix}
          onChange={(name, value) => setValues((held) => ({ ...held, [name]: value }))}
        />
      )}

      <div className="slip-card__actions">
        {actions.map((action, index) => {
          const closure = closureOf(slip, action)
          const stopped = index === (open ?? 0) && blocked
          return (
            <button
              key={index}
              type="button"
              className="slip-card__action"
              data-primary={index === (open ?? 0) ? "" : undefined}
              disabled={busy || closure !== undefined || stopped}
              onClick={() => press(index)}
            >
              {stopped ? blockedLabel(issues) : actionLabel(slip, action, values)}
            </button>
          )
        })}
      </div>

      {/*
        A closed Slip states its reason once, however many actions it carries;
        an open one states the reason of each option that is closed on its own.
        Neither hides the action: a shared link is seen by many people at once.
      */}
      {closed ? (
        <p className="slip-card__reason">{slip.reason?.message}</p>
      ) : (
        actions.map((action, index) =>
          action.disabled === true && action.reason !== undefined ? (
            <p className="slip-card__reason" key={index}>
              {action.reason.message}
            </p>
          ) : undefined
        )
      )}

      {closed ? undefined : <p className="slip-card__note">{promise}</p>}
    </div>
  )
}

/** The same box and the same rhythm while the metadata is in flight, so nothing shifts when it lands. */
export const SlipCardSkeleton = (): React.JSX.Element => (
  <div className="slip-root slip-card slip-card--loading" role="status" aria-busy="true">
    <span className="slip-hidden">Loading this Slip</span>
    <div className="slip-card__head">
      <span className="slip-skeleton slip-skeleton--icon" />
      <div className="slip-card__identity">
        <span className="slip-skeleton slip-skeleton--title" />
        <span className="slip-skeleton slip-skeleton--origin" />
      </div>
    </div>
    <div className="slip-skeleton__lines">
      <span className="slip-skeleton slip-skeleton--line" />
      <span className="slip-skeleton slip-skeleton--line slip-skeleton--short" />
    </div>
    <span className="slip-skeleton slip-skeleton--action" />
  </div>
)

export type SlipCardErrorProps = {
  /** The endpoint that did not answer, in full: the person is being asked to judge it. */
  readonly url: string
  readonly message: string
  readonly onRetry?: () => void
}

/**
 * The endpoint did not answer, or answered with something that is not a Slip.
 * This replaces the card rather than landing on a field, because there is
 * nothing here for the person to fix.
 */
export const SlipCardError = ({ url, message, onRetry }: SlipCardErrorProps): React.JSX.Element => (
  <div className="slip-root slip-card slip-card--failed" role="alert">
    <div className="slip-card__head">
      <span className="slip-card__alarm" aria-hidden="true">
        !
      </span>
      <div className="slip-card__identity">
        <h2 className="slip-card__title">This Slip didn't load</h2>
        <span className="slip-card__origin">{url}</span>
      </div>
    </div>
    <p className="slip-card__description">{message}</p>
    {onRetry === undefined ? undefined : (
      <div className="slip-card__actions">
        <button type="button" className="slip-card__action" onClick={onRetry}>
          Try again
        </button>
      </div>
    )}
  </div>
)
