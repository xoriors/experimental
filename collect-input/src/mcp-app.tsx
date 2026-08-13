import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { StrictMode, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import type { Field, Spec, Values } from "../spec.js"
import "./mcp-app.css"

// The view. It renders whatever spec the model sent and, on submit, asks the
// server to check the answers before handing them to the model as the user's
// next message. It knows nothing about any domain either.

const app = new App({ name: "collect-input", version: "1.0.0" })

interface Payload {
  formId: string
  spec: Spec
}

function initialValues(spec: Spec): Values {
  const values: Values = {}
  for (const field of spec.fields) {
    if (field.default !== undefined) {
      values[field.key] = field.default
      continue
    }
    switch (field.type) {
      case "boolean":
        values[field.key] = false
        break
      case "multiselect":
        values[field.key] = []
        break
      case "range":
        values[field.key] = typeof field.min === "number" ? field.min : 0
        break
      default:
        values[field.key] = ""
    }
  }
  return values
}

function Control({
  field,
  value,
  invalid,
  onChange,
}: {
  field: Field
  value: Values[string]
  invalid: boolean
  onChange: (v: Values[string]) => void
}) {
  const id = `f-${field.key}`
  const common = { id, "aria-invalid": invalid || undefined }
  const options = field.options ?? []

  switch (field.type) {
    case "text":
      return (
        <input
          {...common}
          type="text"
          className="control"
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case "textarea":
      return (
        <textarea
          {...common}
          className="control"
          rows={3}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case "number":
      return (
        <input
          {...common}
          type="number"
          className="control"
          value={value === "" || value === undefined ? "" : Number(value)}
          min={typeof field.min === "number" ? field.min : undefined}
          max={typeof field.max === "number" ? field.max : undefined}
          step={field.step}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      )

    case "date":
      return (
        <input
          {...common}
          type="date"
          className="control"
          value={String(value ?? "")}
          min={typeof field.min === "string" ? field.min : undefined}
          max={typeof field.max === "string" ? field.max : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case "time":
      return (
        <input
          {...common}
          type="time"
          className="control"
          value={String(value ?? "")}
          min={typeof field.min === "string" ? field.min : undefined}
          max={typeof field.max === "string" ? field.max : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case "select":
      return (
        <select
          {...common}
          className="control"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            {field.placeholder ?? "Choose an option"}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.detail ? `${o.label} — ${o.detail}` : o.label}
            </option>
          ))}
        </select>
      )

    // A radio group that reads as a row of choices, for when the options carry
    // a second line worth seeing at a glance (a price, a duration).
    case "cards":
      return (
        <div className="cards" role="radiogroup" aria-labelledby={`${id}-label`}>
          {options.map((o) => {
            const picked = value === o.value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={picked}
                className={`card${picked ? " is-picked" : ""}`}
                onClick={() => onChange(o.value)}
              >
                <span className="card-label">{o.label}</span>
                {o.detail && <span className="card-detail">{o.detail}</span>}
              </button>
            )
          })}
        </div>
      )

    case "multiselect": {
      const picked = Array.isArray(value) ? value : []
      return (
        <div className="checks" role="group" aria-labelledby={`${id}-label`}>
          {options.map((o) => (
            <label key={o.value} className="check">
              <input
                type="checkbox"
                checked={picked.includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...picked, o.value]
                      : picked.filter((v) => v !== o.value),
                  )
                }
              />
              <span>
                {o.label}
                {o.detail && <span className="check-detail"> {o.detail}</span>}
              </span>
            </label>
          ))}
        </div>
      )
    }

    case "boolean":
      return (
        <label className="check check-single">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.placeholder ?? "Yes"}</span>
        </label>
      )

    case "range": {
      const min = typeof field.min === "number" ? field.min : 0
      const max = typeof field.max === "number" ? field.max : 10
      return (
        <div className="range">
          <input
            {...common}
            type="range"
            min={min}
            max={max}
            step={field.step ?? 1}
            value={Number(value ?? min)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <output className="range-value">{Number(value ?? min)}</output>
        </div>
      )
    }
  }
}

function Form({ formId, spec }: Payload) {
  const [values, setValues] = useState<Values>(() => initialValues(spec))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  function setValue(key: string, v: Values[string]) {
    setValues((prev) => ({ ...prev, [key]: v }))
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || sent) return
    setBusy(true)
    setFailure(null)
    try {
      // Validation lives on the server, so every client enforces the same
      // rules and the model can trust what it gets back.
      const checked = await app.callServerTool({
        name: "validate_input",
        arguments: { formId, values },
      })
      const result = checked.structuredContent as
        | { valid: boolean; errors: Record<string, string> }
        | undefined

      if (!result?.valid) {
        setErrors(result?.errors ?? {})
        return
      }

      // The answers go straight to the model as the user's next message; the
      // server is out of the loop from here.
      const posted = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: JSON.stringify(values) }],
      })
      if (posted.isError) {
        setFailure("The host would not accept the answers.")
        return
      }
      setSent(true)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not send the answers.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={`form${sent ? " is-sent" : ""}`} onSubmit={submit} noValidate>
      <header className="form-head">
        <h1>{spec.title}</h1>
        {spec.intent && <p className="intent">{spec.intent}</p>}
      </header>

      <div className="fields">
        {spec.fields.map((field) => (
          <div key={field.key} className="field">
            <label
              id={`f-${field.key}-label`}
              className="label"
              htmlFor={`f-${field.key}`}
            >
              {field.label}
              {field.required && <span className="required" aria-hidden="true"> *</span>}
            </label>
            <fieldset disabled={sent || busy}>
              <Control
                field={field}
                value={values[field.key]}
                invalid={field.key in errors}
                onChange={(v) => setValue(field.key, v)}
              />
            </fieldset>
            {field.help && !errors[field.key] && <p className="help">{field.help}</p>}
            {errors[field.key] && (
              <p className="error" role="alert">
                {errors[field.key]}
              </p>
            )}
          </div>
        ))}
      </div>

      {failure && (
        <p className="error form-error" role="alert">
          {failure}
        </p>
      )}

      <button type="submit" className="submit" disabled={busy || sent}>
        {sent ? "Sent" : busy ? "Checking…" : (spec.submitLabel ?? "Submit")}
      </button>
    </form>
  )
}

function Root() {
  const [payload, setPayload] = useState<Payload | null>(null)

  useEffect(() => {
    // Register handlers before connecting: the host may push a result at once.
    app.ontoolresult = (result: CallToolResult) => {
      const data = result.structuredContent as Partial<Payload> | undefined
      if (data?.spec && data.formId) setPayload({ formId: data.formId, spec: data.spec })
    }
    app.onhostcontextchanged = (ctx) => {
      if (ctx.theme) applyDocumentTheme(ctx.theme)
    }
    app.onerror = (err) => console.error(err)

    void app.connect().then(() => {
      // Inherit the host's look: it pushes a full set of design tokens, so the
      // form matches the surrounding chat without shipping a UI kit.
      const ctx = app.getHostContext()
      if (ctx?.theme) applyDocumentTheme(ctx.theme)
      if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
      if (ctx?.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
    })
  }, [])

  const view = useMemo(() => {
    if (!payload) return <p className="waiting">Waiting for a form…</p>
    return <Form key={payload.formId} {...payload} />
  }, [payload])

  return view
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
