/**
 * The parts of a Slip card that need no React: which buttons a Slip asks for,
 * whether each one may be pressed, and what a button says once the person's
 * values are in it.
 */
import {
  fillLabel,
  type LinkedAction,
  type ParameterValues,
  type Reason,
  type Slip,
  type ValueIssue
} from "@cardano-slips/core"

/**
 * The buttons the Slip asks for. `links` absent is one button labelled `label`
 * whose target is the discovery URL itself — the spec's rule, not a default of
 * ours, which is why it is written once here rather than in each component.
 */
export const actionsOf = (slip: Slip, discoveryUrl: string): ReadonlyArray<LinkedAction> =>
  slip.links?.actions ?? [{ label: slip.label, href: discoveryUrl }]

/**
 * Why this action cannot be used, or undefined while it can. The top level
 * wins: an action carrying `disabled: false` under a disabled Slip stays
 * closed, and is never reopened by its own field.
 */
export const closureOf = (slip: Slip, action: LinkedAction): Reason | undefined => {
  if (slip.disabled === true) return slip.reason
  return action.disabled === true ? action.reason : undefined
}

/** The host that served the link. Undefined where the URL is not one we can read. */
export const originOf = (discoveryUrl: string): string | undefined => {
  try {
    return new URL(discoveryUrl).host
  } catch {
    return undefined
  }
}

/** The publisher's initial, for an icon that did not load. Never a generic glyph. */
export const monogramOf = (discoveryUrl: string): string | undefined =>
  /\p{L}|\p{N}/u.exec(originOf(discoveryUrl) ?? "")?.[0]?.toUpperCase()

/**
 * Own properties only. `ParameterName` admits `constructor`, `toString` and the
 * rest of `Object.prototype`, and a plain object answers for every one of them —
 * so a field nobody filled would be handed a function where a string belongs.
 */
export const valueOf = (values: ParameterValues, name: string): string =>
  Object.hasOwn(values, name) ? values[name] : ""

/** Just the values this action asked for, so a caller is handed no answer it did not request. */
export const valuesFor = (action: LinkedAction, values: ParameterValues): ParameterValues => {
  const picked: Record<string, string> = {}
  for (const parameter of action.parameters ?? []) picked[parameter.name] = valueOf(values, parameter.name)
  return picked
}

const spelled = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"]

/**
 * Runs of whitespace collapse because a label is a template: `Contribute
 * {amount} {token}` with nothing typed is `Contribute`, not `Contribute  `.
 */
const filled = (action: LinkedAction, values: ParameterValues): string =>
  fillLabel(action, values).replace(/\s+/g, " ").trim()

/**
 * What the button says. A label made only of placeholders empties out, and the
 * Slip's own call to action stands in rather than a blank button.
 */
export const actionLabel = (slip: Slip, action: LinkedAction, values: ParameterValues): string => {
  const label = filled(action, values)
  return label === "" ? slip.label : label
}

/**
 * The label of a button that was pressed and cannot send. It counts fields
 * rather than issues: one field can fail two ways and is still one thing to fix.
 */
export const blockedLabel = (issues: ReadonlyArray<ValueIssue>): string => {
  const fields = new Set(issues.map((issue) => issue.name)).size
  return `Fix ${spelled[fields] ?? String(fields)} ${fields === 1 ? "field" : "fields"} to continue`
}
