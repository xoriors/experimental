import { CopilotKit, useCopilotAction } from '@copilotkit/react-core'
import { CopilotChat } from '@copilotkit/react-ui'
import '@copilotkit/react-ui/styles.css'
import AdHocForm from './AdHocForm'
import { parseFormSpec, SpecError, type FormSpec } from './uiSpec'

// The live loop: you chat freely with Gemini, and whenever the model wants
// structured input it calls the show_form tool with a FormSpec as JSON.
// The same parseFormSpec that guards the mock guards the model, and the
// same AdHocForm draws the result inside the chat window.

const CHAT_INSTRUCTIONS = `You can render interactive forms inside this chat.
Whenever you need structured input from the user (dates, choices from a list,
numbers, multiple values at once), do not ask for it as free text. Call the
show_form tool instead, then continue the conversation using the submitted
values. Prefer forms over questions whenever the answer has structure.`

const SPEC_CONTRACT = `JSON object with:
title (string, required), description (string, optional),
submitLabel (string, optional),
fields (array, required, non-empty), each field:
{ id: string, type: "text"|"number"|"select"|"date"|"checkbox",
  label: string, required?: boolean,
  placeholder?: string (text only),
  options?: string[] (select only, required for select),
  min?/max?: number (number) or "YYYY-MM-DD" (date) }.
Example: {"title":"Trip details","fields":[{"id":"when","type":"date",
"label":"Departure","required":true,"min":"2026-07-08"},{"id":"city",
"type":"select","label":"City","required":true,"options":["Rome","Lisbon"]}]}`

type ParseResult = { ok: true; spec: FormSpec } | { ok: false; error: string }

// Parse once and keep the reason on failure, so the render decision and the
// message sent back to the model come from a single source of truth.
function parseSpec(raw: string): ParseResult {
  try {
    return { ok: true, spec: parseFormSpec(JSON.parse(raw)) }
  } catch (err) {
    return { ok: false, error: err instanceof SpecError ? err.message : 'malformed JSON' }
  }
}

function FormAction() {
  useCopilotAction({
    name: 'show_form',
    description:
      'Render an interactive form in the chat to collect structured input from the user. ' +
      'Returns the submitted values as JSON.',
    parameters: [
      {
        name: 'spec',
        type: 'string',
        description: `The form to render, as a JSON string. ${SPEC_CONTRACT}`,
        required: true,
      },
    ],
    renderAndWaitForResponse: ({ args, respond, status }) => {
      // Arguments are still streaming in: the JSON is incomplete, so wait.
      if (status === 'inProgress') {
        return (
          <span className="typing-dots" aria-label="Receiving form">
            <span />
            <span />
            <span />
          </span>
        )
      }

      // Arguments are final (status 'executing' or 'complete'). respond is
      // only live during 'executing', so every branch here must either call
      // respond or render the form (which responds on submit) — the tool
      // call must never be left unresolved, even if the model mistyped spec.
      const raw = typeof args.spec === 'string' ? args.spec.trim() : ''
      const result: ParseResult = raw
        ? parseSpec(raw)
        : { ok: false, error: 'spec must be a non-empty JSON string' }

      if (!result.ok) {
        respond?.(`error: invalid form spec (${result.error}), fix it and call show_form again`)
        return <p className="form-description">Form rejected: {result.error}</p>
      }

      return (
        <AdHocForm spec={result.spec} onSubmit={(values) => respond?.(JSON.stringify(values))} />
      )
    },
  })
  return null
}

export default function LiveChat() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <FormAction />
      <div className="live-wrap">
        <div className="copilot-frame">
          <CopilotChat
            instructions={CHAT_INSTRUCTIONS}
            labels={{
              title: 'Generative UI, live',
              initial: 'Ask me anything. When structured input helps, I will hand you a form instead of twenty questions.',
            }}
          />
        </div>
      </div>
    </CopilotKit>
  )
}
