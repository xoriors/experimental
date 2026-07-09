import { useState } from 'react'
import type { FormField, FormSpec, FormValues } from './uiSpec'

// Renders a FormSpec as a live form inside the chat.
//
// The form is ephemeral by design: once submitted it freezes into a
// read-only receipt of what was sent, mirroring how a real agent
// conversation moves forward and never edits the past.

interface Props {
  spec: FormSpec
  // True while the spec is still streaming in from the agent. The form
  // renders and grows field by field, but cannot be submitted yet.
  streaming?: boolean
  onSubmit: (values: FormValues) => void
}

function initialValues(fields: FormField[]): FormValues {
  const values: FormValues = {}
  for (const f of fields) {
    values[f.id] = f.type === 'checkbox' ? false : ''
  }
  return values
}

export default function AdHocForm({ spec, streaming = false, onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>(() => initialValues(spec.fields))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  // Fields can arrive after mount while the spec streams in, so a field
  // may not have an entry in values yet. Reads always go through here.
  function valueOf(f: FormField): string | number | boolean {
    return values[f.id] ?? (f.type === 'checkbox' ? false : '')
  }

  function setValue(id: string, value: string | number | boolean) {
    setValues((prev) => ({ ...prev, [id]: value }))
    setErrors((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function validate(): boolean {
    const found: Record<string, string> = {}
    for (const f of spec.fields) {
      const v = valueOf(f)
      const empty = f.type === 'checkbox' ? v !== true : v === ''
      if (f.required && empty) {
        found[f.id] = 'This field is required'
        continue
      }
      // ISO dates compare correctly as strings, so bounds are simple checks.
      if (f.type === 'date' && typeof v === 'string' && v !== '') {
        if (f.min && v < f.min) found[f.id] = `Pick ${f.min} or later`
        if (f.max && v > f.max) found[f.id] = `Pick ${f.max} or earlier`
      }
    }
    setErrors(found)
    return Object.keys(found).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitted || streaming || !validate()) return
    setSubmitted(true)
    const complete: FormValues = {}
    for (const f of spec.fields) complete[f.id] = valueOf(f)
    onSubmit(complete)
  }

  return (
    <form
      className={`adhoc-form${submitted ? ' is-submitted' : ''}${streaming ? ' is-streaming' : ''}`}
      onSubmit={handleSubmit}
      noValidate
    >
      <header className="adhoc-form-header">
        <div className="adhoc-form-heading">
          <h3>{spec.title}</h3>
          {spec.description && <p className="form-description">{spec.description}</p>}
        </div>
        {streaming && (
          <span className="form-status form-status-streaming" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            Receiving
          </span>
        )}
        {submitted && (
          <span className="form-status form-status-sent">
            <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2.5 6.5L5 9L9.5 3.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Sent
          </span>
        )}
      </header>

      <div className="adhoc-form-fields">
        {spec.fields.map((field) => (
          <div key={field.id} className="form-field">
            <FieldInput
              field={field}
              value={valueOf(field)}
              disabled={submitted}
              onChange={(v) => setValue(field.id, v)}
            />
            {errors[field.id] && (
              <span className="field-error" role="alert">
                {errors[field.id]}
              </span>
            )}
          </div>
        ))}
        {streaming && (
          <div className="form-caret" aria-hidden="true">
            <span />
          </div>
        )}
      </div>

      <button type="submit" className="form-submit" disabled={submitted || streaming}>
        {streaming
          ? 'Receiving form...'
          : submitted
            ? 'Sent to agent'
            : (spec.submitLabel ?? 'Submit')}
      </button>
    </form>
  )
}

interface FieldProps {
  field: FormField
  value: string | number | boolean
  disabled: boolean
  onChange: (value: string | number | boolean) => void
}

function FieldInput({ field, value, disabled, onChange }: FieldProps) {
  const label = (
    <span className="field-label">
      {field.label}
      {field.required && <span className="field-required"> *</span>}
    </span>
  )

  switch (field.type) {
    case 'text':
      return (
        <label>
          {label}
          <input
            type="text"
            value={String(value)}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
    case 'number':
      return (
        <label>
          {label}
          <input
            type="number"
            value={String(value)}
            min={field.min}
            max={field.max}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
      )
    case 'date':
      return (
        <label>
          {label}
          <input
            type="date"
            value={String(value)}
            min={field.min}
            max={field.max}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
    case 'select':
      return (
        <label>
          {label}
          <select
            value={String(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>
              Choose an option
            </option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      )
    case 'checkbox':
      return (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
      )
  }
}
