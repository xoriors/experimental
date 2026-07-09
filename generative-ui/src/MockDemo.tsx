import { useEffect, useRef, useState } from 'react'
import AdHocForm from './AdHocForm'
import { parseFormField, SpecError, type FormSpec, type FormValues } from './uiSpec'
import { closingTurn, followUpTurn, openingTurn, type AgentEvent } from './mockAgent'

// The chat consumes an agent event stream and renders it as it arrives:
// typing indicators, text, and forms that grow field by field. The mock
// agent produces the events today; AG-UI wiring will produce them tomorrow.

type ChatMessage =
  | { id: number; from: 'user' | 'agent'; kind: 'text'; text: string }
  | { id: number; from: 'agent'; kind: 'typing' }
  | { id: number; from: 'agent'; kind: 'form'; formId: string; spec: FormSpec; streaming: boolean }
  | { id: number; from: 'user'; kind: 'values'; values: FormValues }

// Omit over a union must distribute per member, otherwise it collapses
// the union to its common properties and rejects every variant.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type NewMessage = DistributiveOmit<ChatMessage, 'id'>

function withoutTrailingTyping(list: ChatMessage[]): ChatMessage[] {
  const last = list[list.length - 1]
  return last && last.kind === 'typing' ? list.slice(0, -1) : list
}

export default function MockDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const runRef = useRef(0)
  const idRef = useRef(1)
  const bookingRef = useRef<FormValues | null>(null)

  function push(msg: NewMessage) {
    setMessages((prev) => [
      ...withoutTrailingTyping(prev),
      { ...msg, id: idRef.current++ } as ChatMessage,
    ])
  }

  function appendFieldToLastForm(field: FormSpec['fields'][number]) {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1 && m.kind === 'form'
          ? { ...m, spec: { ...m.spec, fields: [...m.spec.fields, field] } }
          : m,
      ),
    )
  }

  function closeLastForm() {
    setMessages((prev) =>
      prev.map((m, i) => (i === prev.length - 1 && m.kind === 'form' ? { ...m, streaming: false } : m)),
    )
  }

  // Drains one agent turn. A bumped runRef (replay, StrictMode remount)
  // cancels stale loops so they stop touching state.
  async function play(turn: AsyncGenerator<AgentEvent>) {
    const run = runRef.current
    let fieldIndex = 0
    for await (const event of turn) {
      if (runRef.current !== run) return
      switch (event.type) {
        case 'typing':
          push({ from: 'agent', kind: 'typing' })
          break
        case 'text':
          push({ from: 'agent', kind: 'text', text: event.text })
          break
        case 'form-start':
          fieldIndex = 0
          push({
            from: 'agent',
            kind: 'form',
            formId: event.formId,
            streaming: true,
            spec: {
              title: event.title,
              description: event.description,
              submitLabel: event.submitLabel,
              fields: [],
            },
          })
          break
        case 'form-field':
          try {
            appendFieldToLastForm(parseFormField(event.field, fieldIndex++))
          } catch (err) {
            // In the real loop this message goes back to the agent so it
            // can fix its spec and retry. Here we surface it in the chat.
            if (!(err instanceof SpecError)) throw err
            push({ from: 'agent', kind: 'text', text: `Spec line rejected: ${err.message}` })
          }
          break
        case 'form-end':
          closeLastForm()
          break
      }
    }
  }

  function start() {
    runRef.current++
    idRef.current = 1
    bookingRef.current = null
    setMessages([
      { id: 0, from: 'user', kind: 'text', text: 'Hey, I want to book a court this week.' },
    ])
    void play(openingTurn())
  }

  useEffect(() => {
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(formId: string, values: FormValues) {
    push({ from: 'user', kind: 'values', values })
    if (formId === 'booking') {
      bookingRef.current = values
      void play(followUpTurn(values))
    } else if (formId === 'slot' && bookingRef.current) {
      void play(closingTurn(bookingRef.current, values))
    }
  }

  return (
    <div className="page">
      <main className="chat">
        <header className="chat-header">
          <div className="chat-header-identity">
            <div className="agent-mark" aria-hidden="true" />
            <div>
              <h1>Generative UI</h1>
              <p>An agent that spawns forms in chat instead of asking for free text</p>
            </div>
          </div>
          <button className="ghost" onClick={start}>
            Replay demo
          </button>
        </header>

        <section className="transcript">
          {messages.map((msg) => (
            <article
              key={msg.id}
              className={`msg from-${msg.from}${msg.kind === 'form' ? ' has-form' : ''}`}
            >
              {msg.from === 'agent' && <div className="agent-mark" aria-hidden="true" />}
              <div className="msg-body">
                {msg.kind === 'text' && (
                  <div className="bubble">
                    <p>{msg.text}</p>
                  </div>
                )}

                {msg.kind === 'typing' && (
                  <div className="bubble bubble-typing">
                    <span className="typing-dots" aria-label="Agent is typing">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                )}

                {msg.kind === 'form' && (
                  <div className="form-slot">
                    <AdHocForm
                      spec={msg.spec}
                      streaming={msg.streaming}
                      onSubmit={(values) => handleSubmit(msg.formId, values)}
                    />
                    <details className="spec-viewer">
                      <summary>View the spec behind this form</summary>
                      <div className="spec-terminal">
                        <div className="spec-terminal-bar" aria-hidden="true">
                          <span className="term-dots" />
                          <span className="term-title">FormSpec · JSON</span>
                        </div>
                        <pre>{JSON.stringify(msg.spec, null, 2)}</pre>
                      </div>
                    </details>
                  </div>
                )}

                {msg.kind === 'values' && (
                  <div className="bubble values-receipt">
                    <p>Submitted</p>
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
              </div>
            </article>
          ))}
        </section>

        <footer className="chat-footer">
          The agent is mocked as an event stream, the shape AG-UI delivers. Next step: a real
          LLM produces these events through AG-UI / CopilotKit.
        </footer>
      </main>
    </div>
  )
}
