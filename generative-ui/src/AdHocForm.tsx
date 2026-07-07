import { useState } from 'react'
import type { FormField, FormSpec, FormValues } from './uiSpec'

// Renders a FormSpec as a live form inside the chat.
//
// The form is ephemeral by design: once submitted it freezes into a
// read-only receipt of what was sent, mirroring how a real agent
// conversation moves forward and never edits the past.

interface Props {
  spec: FormSpec
  onSubmit: (values: FormValues) => void
}

function initialValues(fields: FormField[]): FormValues {
  const values: FormValues = {}
  for (const f of fields) {
    values[f.id] = f.type === 'checkbox' ? false : ''
  }
  return values
}

export default function AdHocForm({ spec, onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>(() => initialValues(spec.fields))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

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
      const v = values[f.id]
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
    if (submitted || !validate()) return
    setSubmitted(true)
    onSubmit(values)
  }

  return (
    <form className={`adhoc-form${submitted ? ' is-submitted' : ''}`} onSubmit={handleSubmit}>
      <header>
        <h3>{spec.title}</h3>
        {spec.description && <p className="form-description">{spec.description}</p>}
      </header>

      {spec.fields.map((field) => (
        <div key={field.id} className="form-field">
          <FieldInput
            field={field}
            value={values[field.id]}
            disabled={submitted}
            onChange={(v) => setValue(field.id, v)}
          />
          {errors[field.id] && <span className="field-error">{errors[field.id]}</span>}
        </div>
      ))}

      <button type="submit" disabled={submitted}>
        {submitted ? 'Sent to agent' : (spec.submitLabel ?? 'Submit')}
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
