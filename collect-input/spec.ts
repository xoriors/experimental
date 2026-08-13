// The contract between the model and the form, plus the validation that
// enforces it. Shared by the server (which validates) and the view (which
// renders), so there is exactly one definition of what a field can be.

import { z } from "zod"

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "time",
  "select",
  "cards",
  "multiselect",
  "boolean",
  "range",
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

// Bounds are numeric for number/range and ISO strings for date/time.
const Bound = z.union([z.number(), z.string()])

export const OptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  detail: z.string().optional().describe("Secondary line, e.g. a price or a hint."),
})

export const FieldSchema = z.object({
  key: z.string().describe("Key this field's answer appears under in the result."),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  help: z.string().optional().describe("Small print under the control."),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  default: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    .optional()
    .describe("Pre-fill anything already inferred, so the form only asks for the gaps."),
  options: z.array(OptionSchema).optional().describe("Required for select, cards, multiselect."),
  min: Bound.optional(),
  max: Bound.optional(),
  step: z.number().optional().describe("Range/number granularity."),
})

export const SpecSchema = z.object({
  title: z.string(),
  intent: z.string().optional().describe("One line telling the user why you are asking."),
  submitLabel: z.string().optional(),
  fields: z.array(FieldSchema).min(1),
})

export type Option = z.infer<typeof OptionSchema>
export type Field = z.infer<typeof FieldSchema>
export type Spec = z.infer<typeof SpecSchema>

export type FieldValue = string | number | boolean | string[]
export type Values = Record<string, FieldValue>

export interface ValidationResult {
  valid: boolean
  errors: Record<string, string>
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

// Types whose answer is a single string drawn from `options`.
const CHOICE_TYPES: FieldType[] = ["select", "cards"]

function isBlank(value: FieldValue | undefined): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  return false
}

// Validates one field's answer, returning an error message or null. Kept
// separate so the same rule set can report every problem at once rather than
// stopping at the first.
function checkField(field: Field, value: FieldValue | undefined): string | null {
  const blank = isBlank(value)

  if (field.required) {
    // An unticked checkbox is "blank" for a required boolean: it is how a
    // form says "you must accept this".
    if (blank || (field.type === "boolean" && value !== true)) {
      return "This field is required"
    }
  }
  // Optional and absent is fine, whatever the type: an unanswered checkbox
  // simply means false.
  if (value === undefined) return null
  // Optional and empty is fine; nothing left to check.
  if (blank && field.type !== "boolean") return null

  switch (field.type) {
    case "text":
    case "textarea":
      if (typeof value !== "string") return "Expected text"
      return null

    case "number":
    case "range": {
      if (typeof value !== "number" || Number.isNaN(value)) return "Expected a number"
      if (typeof field.min === "number" && value < field.min) return `Must be ${field.min} or more`
      if (typeof field.max === "number" && value > field.max) return `Must be ${field.max} or less`
      return null
    }

    case "date": {
      if (typeof value !== "string" || !DATE_RE.test(value)) return "Expected a date (YYYY-MM-DD)"
      // ISO dates compare correctly as plain strings.
      if (typeof field.min === "string" && value < field.min) return `Pick ${field.min} or later`
      if (typeof field.max === "string" && value > field.max) return `Pick ${field.max} or earlier`
      return null
    }

    case "time": {
      if (typeof value !== "string" || !TIME_RE.test(value)) return "Expected a time (HH:MM)"
      if (typeof field.min === "string" && value < field.min) return `Pick ${field.min} or later`
      if (typeof field.max === "string" && value > field.max) return `Pick ${field.max} or earlier`
      return null
    }

    case "select":
    case "cards": {
      if (typeof value !== "string") return "Expected one of the options"
      const allowed = (field.options ?? []).map((o) => o.value)
      if (!allowed.includes(value)) return "Not one of the offered options"
      return null
    }

    case "multiselect": {
      if (!Array.isArray(value)) return "Expected a list of options"
      const allowed = (field.options ?? []).map((o) => o.value)
      const stray = value.find((v) => !allowed.includes(v))
      if (stray !== undefined) return `"${stray}" is not one of the offered options`
      return null
    }

    case "boolean":
      if (typeof value !== "boolean") return "Expected yes or no"
      return null
  }
}

// The single source of truth for whether a set of answers is acceptable.
// The server runs this before the values are ever handed back to the model.
export function validate(spec: Spec, values: Values): ValidationResult {
  const errors: Record<string, string> = {}
  for (const field of spec.fields) {
    const problem = checkField(field, values[field.key])
    if (problem) errors[field.key] = problem
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

// A spec is only usable if every choice field actually offers choices.
export function specProblems(spec: Spec): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const field of spec.fields) {
    if (seen.has(field.key)) problems.push(`Duplicate field key "${field.key}"`)
    seen.add(field.key)
    const needsOptions = CHOICE_TYPES.includes(field.type) || field.type === "multiselect"
    if (needsOptions && !field.options?.length) {
      problems.push(`Field "${field.key}" is a ${field.type} but has no options`)
    }
  }
  return problems
}
