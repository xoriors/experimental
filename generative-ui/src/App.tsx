import { useState } from 'react'
import AdHocForm from './AdHocForm'
import { parseFormSpec, type FormSpec, type FormValues } from './uiSpec'

// Chat demo with a mock agent.
//
// The agent side is simulated: instead of an LLM tool call we ship a raw
// JSON spec and run it through parseFormSpec, which is exactly the path a
// real agent response will take. Swapping the mock for CopilotKit / AG-UI
// wiring only replaces where the JSON comes from, not how it is rendered.

function isoToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// A real agent would tailor the spec to the conversation and to context
// like the current date. The mock does the same: bookings cannot start
// in the past, so the date field is constrained to today or later.
function buildBookingSpec(): string {
  return `{
  "title": "Court booking",
  "description": "Fill this in and I will check availability for you.",
  "submitLabel": "Request booking",
  "fields": [
    { "id": "date", "type": "date", "label": "Date", "required": true, "min": "${isoToday()}" },
    { "id": "sport", "type": "select", "label": "Sport", "required": true,
      "options": ["Tennis", "Football", "Basketball", "Padel"] },
    { "id": "players", "type": "number", "label": "Players", "min": 1, "max": 22 },
    { "id": "notes", "type": "text", "label": "Notes", "placeholder": "Anything else?" },
    { "id": "reminder", "type": "checkbox", "label": "Send me a reminder" }
  ]
}`
}

type ChatMessage =
  | { id: number; from: 'user' | 'agent'; kind: 'text'; text: string }
  | { id: number; from: 'agent'; kind: 'form'; spec: FormSpec; rawSpec: string }
  | { id: number; from: 'user'; kind: 'values'; values: FormValues }

function openingMessages(): ChatMessage[] {
  const rawSpec = buildBookingSpec()
  return [
    { id: 1, from: 'user', kind: 'text', text: 'Hey, I want to book a court this week.' },
    {
      id: 2,
      from: 'agent',
      kind: 'text',
      text: 'Sure. Instead of typing everything out, here is a quick form:',
    },
    {
      id: 3,
      from: 'agent',
      kind: 'form',
      spec: parseFormSpec(JSON.parse(rawSpec)),
      rawSpec,
    },
  ]
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(openingMessages)

  function handleSubmit(values: FormValues) {
    setMessages((prev) => [
      ...prev,
      { id: prev.length + 1, from: 'user', kind: 'values', values },
      {
        id: prev.length + 2,
        from: 'agent',
        kind: 'text',
        text: `Got it. Looking for a ${String(values.sport || 'court')} slot on ${
          String(values.date) || 'the requested date'
        }. I will get back to you shortly.`,
      },
    ])
  }

  return (
    <div className="page">
      <main className="chat">
        <header className="chat-header">
          <div>
            <h1>Generative UI</h1>
            <p>An agent that spawns forms in chat instead of asking for free text</p>
          </div>
          <button className="ghost" onClick={() => setMessages(openingMessages())}>
            Replay demo
          </button>
        </header>

        <section className="transcript">
          {messages.map((msg) => (
            <article key={msg.id} className={`bubble from-${msg.from}`}>
              {msg.kind === 'text' && <p>{msg.text}</p>}

              {msg.kind === 'form' && (
                <>
                  <AdHocForm spec={msg.spec} onSubmit={handleSubmit} />
                  <details className="spec-viewer">
                    <summary>View the spec behind this form</summary>
                    <pre>{msg.rawSpec}</pre>
                  </details>
                </>
              )}

              {msg.kind === 'values' && (
                <div className="values-receipt">
                  <p>Submitted:</p>
                  <ul>
                    {Object.entries(msg.values)
                      .filter(([, v]) => v !== '' && v !== false)
                      .map(([key, v]) => (
                        <li key={key}>
                          <span className="value-key">{key}</span> {String(v)}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </section>

        <footer className="chat-footer">
          The agent is mocked for now. Next step: the spec above gets generated live by an LLM
          through AG-UI / CopilotKit.
        </footer>
      </main>
    </div>
  )
}
