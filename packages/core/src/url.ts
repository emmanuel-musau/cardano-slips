/**
 * Templated references: the placeholders in a linked action's `label` and
 * `href`, the values a person supplies for them, and the `POST` target that
 * results.
 *
 * This is where the three rules `types.ts` defers land — same-origin `href`,
 * `max` against `min`, placeholders against parameters — because each needs the
 * discovery URL or a comparison of two siblings that no JSON Schema can make.
 */
import { Either } from "effect"

import type { LinkedAction, Parameter, Slip } from "./types.js"

/** Braces are never literal, so anything between a pair of them is a placeholder that must name a parameter. */
const placeholder = /\{([^{}]*)\}/g

export const placeholdersIn = (template: string): ReadonlyArray<string> =>
  [...template.matchAll(placeholder)].map((match) => match[1])

/** A defect in the Slip itself, found against the discovery URL. Every one of these rejects the response. */
export type TemplateDefect =
  | { readonly _tag: "CrossOriginHref"; readonly action: number; readonly href: string }
  | { readonly _tag: "UndeclaredPlaceholder"; readonly action: number; readonly name: string }
  | { readonly _tag: "UnreferencedParameter"; readonly action: number; readonly name: string }
  | { readonly _tag: "DuplicateParameter"; readonly action: number; readonly name: string }
  | { readonly _tag: "BoundsReversed"; readonly action: number; readonly name: string }

const bounds = (parameter: Parameter): { min?: number; max?: number } =>
  parameter.type === "select" ? {} : { min: parameter.min, max: parameter.max }

const staysOnOrigin = (href: string, discoveryUrl: string): boolean => {
  try {
    return new URL(href, discoveryUrl).origin === new URL(discoveryUrl).origin
  } catch {
    return false
  }
}

const defectsIn = (action: LinkedAction, index: number, discoveryUrl: string): Array<TemplateDefect> => {
  const defects: Array<TemplateDefect> = []
  const parameters = action.parameters ?? []

  // A Slip that hands a person to a third party is indistinguishable from a hijacked link.
  if (!staysOnOrigin(action.href, discoveryUrl)) {
    defects.push({ _tag: "CrossOriginHref", action: index, href: action.href })
  }

  const declared = new Set<string>()
  for (const parameter of parameters) {
    if (declared.has(parameter.name)) {
      defects.push({ _tag: "DuplicateParameter", action: index, name: parameter.name })
    }
    declared.add(parameter.name)
  }

  const referenced = new Set([...placeholdersIn(action.label), ...placeholdersIn(action.href)])

  for (const name of referenced) {
    if (!declared.has(name)) defects.push({ _tag: "UndeclaredPlaceholder", action: index, name })
  }

  for (const parameter of parameters) {
    // A collected value that reaches nothing is a defect in the endpoint, not an optional extra.
    if (!referenced.has(parameter.name)) {
      defects.push({ _tag: "UnreferencedParameter", action: index, name: parameter.name })
    }

    const { min, max } = bounds(parameter)
    if (min !== undefined && max !== undefined && max < min) {
      defects.push({ _tag: "BoundsReversed", action: index, name: parameter.name })
    }
  }

  return defects
}

/**
 * Run once, on the response, before a person is shown anything. A Slip with any
 * defect here is not a Slip a client may act on.
 */
export const checkTemplates = (slip: Slip, discoveryUrl: string): ReadonlyArray<TemplateDefect> =>
  (slip.links?.actions ?? []).flatMap((action, index) => defectsIn(action, index, discoveryUrl))

export type ValueIssue = {
  readonly name: string
  readonly reason: "required" | "notANumber" | "belowMin" | "aboveMax" | "notAnOption"
  readonly message: string
}

/** Decimal, with an optional exponent. `Number` alone would read `0x10` as 16 and `""` as 0. */
const numeric = /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/

const issuesFor = (parameter: Parameter, raw: string): Array<ValueIssue> => {
  const at = (reason: ValueIssue["reason"], message: string): ValueIssue => ({ name: parameter.name, reason, message })

  if (raw === "") {
    // Not required and not supplied: the placeholder fills with nothing.
    return parameter.required === true ? [at("required", `${parameter.label} is required`)] : []
  }

  if (parameter.type === "select") {
    return parameter.options.some((option) => option.value === raw)
      ? []
      : [at("notAnOption", `${parameter.label} must be one of the offered options`)]
  }

  if (parameter.type === "number") {
    if (!numeric.test(raw.trim())) return [at("notANumber", `${parameter.label} must be a number`)]
    const value = Number(raw.trim())
    const issues: Array<ValueIssue> = []
    if (parameter.min !== undefined && value < parameter.min) {
      issues.push(at("belowMin", `${parameter.label} must be at least ${parameter.min}`))
    }
    if (parameter.max !== undefined && value > parameter.max) {
      issues.push(at("aboveMax", `${parameter.label} must be at most ${parameter.max}`))
    }
    return issues
  }

  // On `text` the bounds are character counts, not values.
  const issues: Array<ValueIssue> = []
  if (parameter.min !== undefined && raw.length < parameter.min) {
    issues.push(at("belowMin", `${parameter.label} must be at least ${parameter.min} characters`))
  }
  if (parameter.max !== undefined && raw.length > parameter.max) {
    issues.push(at("aboveMax", `${parameter.label} must be at most ${parameter.max} characters`))
  }
  return issues
}

export type ParameterValues = Readonly<Record<string, string>>

/** Every one of these MUST be clear before a client sends the request. */
export const checkValues = (parameters: ReadonlyArray<Parameter>, values: ParameterValues): ReadonlyArray<ValueIssue> =>
  parameters.flatMap((parameter) => issuesFor(parameter, values[parameter.name] ?? ""))

/**
 * RFC 3986 unreserved and nothing else. `encodeURIComponent` leaves `!'()*`
 * alone, and those are sub-delimiters rather than unreserved characters.
 */
const encodeValue = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

const fill = (template: string, values: ParameterValues, encode: boolean): string =>
  template.replaceAll(placeholder, (_, name: string) => {
    const value = values[name] ?? ""
    return encode ? encodeValue(value) : value
  })

/** Substituted verbatim: a label is display, and an encoded one reads as machine output. */
export const fillLabel = (action: LinkedAction, values: ParameterValues): string => fill(action.label, values, false)

/**
 * The `POST` target, absolute. Percent-encoding is what keeps the origin fixed
 * by the template rather than by a value: an encoded value carries no `:`, `/`,
 * `?`, `#` or `@`, so no answer a person gives can move the request.
 */
export const fillHref = (
  action: LinkedAction,
  values: ParameterValues,
  discoveryUrl: string
): Either.Either<string, ReadonlyArray<ValueIssue>> => {
  const issues = checkValues(action.parameters ?? [], values)
  if (issues.length > 0) return Either.left(issues)
  return Either.right(new URL(fill(action.href, values, true), discoveryUrl).href)
}
