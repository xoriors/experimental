// The contract between an agent and the UI.
//
// An agent that needs structured input describes a form as plain JSON
// matching FormSpec. The frontend renders it, the user fills it in, and
// the collected FormValues travel back to the agent. Today the spec is
// hardcoded in the demo; later it will be produced by an LLM tool call,
// which is why parseFormSpec validates untrusted input instead of
// assuming it is well formed.

export type FieldType = 'text' | 'number' | 'select' | 'date' | 'checkbox'

interface BaseField {
  id: string
  type: FieldType
  label: string
  required?: boolean
}

export interface TextField extends BaseField {
  type: 'text'
  placeholder?: string
}

export interface NumberField extends BaseField {
  type: 'number'
  min?: number
  max?: number
}

export interface SelectField extends BaseField {
  type: 'select'
  options: string[]
}

export interface DateField extends BaseField {
  type: 'date'
  // ISO dates (YYYY-MM-DD). The agent expresses constraints here, e.g.
  // min set to today so users cannot book in the past.
  min?: string
  max?: string
}

export interface CheckboxField extends BaseField {
  type: 'checkbox'
}

export type FormField = TextField | NumberField | SelectField | DateField | CheckboxField

export interface FormSpec {
  title: string
  description?: string
  fields: FormField[]
  submitLabel?: string
}

export type FormValues = Record<string, string | number | boolean>

const FIELD_TYPES: FieldType[] = ['text', 'number', 'select', 'date', 'checkbox']

export class SpecError extends Error {}

function fail(message: string): never {
  throw new SpecError(message)
}

// Validates a single field line. Specs can stream in JSONL style, one
// field per line, so each line must be checkable on its own the moment
// it arrives.
export function parseFormField(raw: unknown, i = 0): FormField {
  if (typeof raw !== 'object' || raw === null) fail(`fields[${i}] must be an object`)
  const f = raw as Record<string, unknown>

  if (typeof f.id !== 'string' || f.id.trim() === '') {
    fail(`fields[${i}].id must be a non-empty string`)
  }
  if (typeof f.label !== 'string' || f.label.trim() === '') {
    fail(`fields[${i}].label must be a non-empty string`)
  }
  if (!FIELD_TYPES.includes(f.type as FieldType)) {
    fail(`fields[${i}].type must be one of: ${FIELD_TYPES.join(', ')}`)
  }
  if (f.required !== undefined && typeof f.required !== 'boolean') {
    fail(`fields[${i}].required must be a boolean when present`)
  }

  if (f.type === 'select') {
    const opts = f.options
    const valid =
      Array.isArray(opts) && opts.length > 0 && opts.every((o) => typeof o === 'string')
    if (!valid) fail(`fields[${i}].options must be a non-empty array of strings`)
  }
  if (f.type === 'number') {
    if (f.min !== undefined && typeof f.min !== 'number') {
      fail(`fields[${i}].min must be a number when present`)
    }
    if (f.max !== undefined && typeof f.max !== 'number') {
      fail(`fields[${i}].max must be a number when present`)
    }
  }
  if (f.type === 'date') {
    const isoDate = /^\d{4}-\d{2}-\d{2}$/
    for (const bound of ['min', 'max'] as const) {
      const v = f[bound]
      // The shape check alone accepts impossible dates like 2026-13-45,
      // which would make a bounded date field unsatisfiable. Date.parse
      // rejects out-of-range ISO dates, so it closes that gap.
      if (
        v !== undefined &&
        (typeof v !== 'string' || !isoDate.test(v) || Number.isNaN(Date.parse(v)))
      ) {
        fail(`fields[${i}].${bound} must be an ISO date (YYYY-MM-DD) when present`)
      }
    }
  }

  return f as unknown as FormField
}

// Validates untrusted JSON (eventually coming from an LLM) into a FormSpec.
// Throws SpecError with a message precise enough to feed back to the agent
// so it can correct itself and retry.
export function parseFormSpec(input: unknown): FormSpec {
  if (typeof input !== 'object' || input === null) fail('spec must be an object')
  const spec = input as Record<string, unknown>

  if (typeof spec.title !== 'string' || spec.title.trim() === '') {
    fail('spec.title must be a non-empty string')
  }
  if (spec.description !== undefined && typeof spec.description !== 'string') {
    fail('spec.description must be a string when present')
  }
  if (spec.submitLabel !== undefined && typeof spec.submitLabel !== 'string') {
    fail('spec.submitLabel must be a string when present')
  }
  if (!Array.isArray(spec.fields) || spec.fields.length === 0) {
    fail('spec.fields must be a non-empty array')
  }

  const seen = new Set<string>()
  const fields = spec.fields.map((raw, i) => {
    const f = parseFormField(raw, i)
    if (seen.has(f.id)) fail(`duplicate field id "${f.id}"`)
    seen.add(f.id)
    return f
  })

  return {
    title: spec.title,
    description: spec.description as string | undefined,
    submitLabel: spec.submitLabel as string | undefined,
    fields,
  }
}
