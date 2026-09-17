/**
 * The form a linked action's `parameters` describe. It holds no state: what a
 * person typed, and which errors are ripe to show, belong to the card.
 */
import type { Parameter, ParameterValues } from "@cardano-slips/core"

import { valueOf } from "./card.js"

/** A sentence about one field. `code` is the endpoint's, and is for us rather than for the person. */
export type FieldError = {
  readonly message: string
  readonly code?: string
}

export type ParameterFormProps = {
  readonly parameters: ReadonlyArray<Parameter>
  readonly values: ParameterValues
  /** By parameter name. What is here is shown; deciding when is the card's job. */
  readonly errors?: Readonly<Record<string, FieldError>>
  readonly onChange: (name: string, value: string) => void
  /** Prefixes every generated id, so two cards on one page do not collide. */
  readonly idPrefix?: string
}

/**
 * The bounds line. The spec requires it beside the field rather than only on
 * failure, so a person can tell what will be accepted before they type.
 */
export const boundsOf = (parameter: Parameter): string | undefined => {
  if (parameter.type === "select") {
    const labels = parameter.options.map((option) => option.label)
    if (labels.length > 3) return `${labels.length} options`
    if (labels.length === 1) return labels[0]
    return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`
  }

  // On `text` the bounds count characters; on `number` they bound the value.
  const unit = parameter.type === "text" ? " characters" : ""
  if (parameter.min !== undefined && parameter.max !== undefined) {
    return `Between ${parameter.min} and ${parameter.max}${unit}`
  }
  // The same words `checkValues` uses, so the bounds and the sentence a broken
  // value produces read as one voice rather than two.
  if (parameter.min !== undefined) return `At least ${parameter.min}${unit}`
  if (parameter.max !== undefined) return `At most ${parameter.max}${unit}`
  return undefined
}

const errorOf = (errors: Readonly<Record<string, FieldError>> | undefined, name: string): FieldError | undefined =>
  errors !== undefined && Object.hasOwn(errors, name) ? errors[name] : undefined

type FieldProps = {
  readonly parameter: Parameter
  readonly value: string
  readonly error: FieldError | undefined
  readonly id: string
  readonly onChange: (name: string, value: string) => void
}

const Field = ({ parameter, value, error, id, onChange }: FieldProps): React.JSX.Element => {
  const helpId = `${id}-help`
  const invalid = error === undefined ? undefined : ""
  const change = (next: string): void => onChange(parameter.name, next)

  return (
    <div className="slip-field" data-invalid={invalid}>
      <label className="slip-field__label" htmlFor={id}>
        {parameter.label}
      </label>
      <div className="slip-field__control">
        {parameter.type === "select" ? (
          <select
            id={id}
            className="slip-field__input"
            value={value}
            aria-describedby={helpId}
            aria-invalid={error === undefined ? undefined : true}
            onChange={(event) => change(event.target.value)}
          >
            {parameter.required === true && value !== "" ? undefined : <option value="" />}
            {parameter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            className={
              parameter.type === "number" ? "slip-field__input slip-field__input--numeral" : "slip-field__input"
            }
            type="text"
            // Never `type="number"`: it hands back an empty string for anything
            // the browser dislikes, which hides the very value `checkValues` is
            // there to judge — and the person never learns what was wrong.
            inputMode={parameter.type === "number" ? "decimal" : undefined}
            value={value}
            aria-describedby={helpId}
            aria-invalid={error === undefined ? undefined : true}
            onChange={(event) => change(event.target.value)}
          />
        )}
      </div>
      <div className="slip-field__help" id={helpId}>
        <span className="slip-field__bounds">{error?.message ?? boundsOf(parameter)}</span>
        {error?.code === undefined ? (
          <span className="slip-field__note">{parameter.required === true ? "Required" : "Optional"}</span>
        ) : (
          <span className="slip-field__code">{error.code}</span>
        )}
      </div>
    </div>
  )
}

export const ParameterForm = ({
  parameters,
  values,
  errors,
  onChange,
  idPrefix = "slip"
}: ParameterFormProps): React.JSX.Element => (
  <div className="slip-fields">
    {parameters.map((parameter) => (
      <Field
        key={parameter.name}
        parameter={parameter}
        value={valueOf(values, parameter.name)}
        error={errorOf(errors, parameter.name)}
        id={`${idPrefix}-${parameter.name}`}
        onChange={onChange}
      />
    ))}
  </div>
)
