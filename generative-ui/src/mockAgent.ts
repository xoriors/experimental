import type { FormValues } from './uiSpec'

// The mock agent, shaped like the real thing.
//
// AG-UI is an event-based protocol and A2UI specs are designed to stream
// (JSONL, one line at a time). So instead of returning a finished spec,
// the mock emits an event stream: text tokens, then a form that grows
// field by field. Swapping this file for a real LLM behind AG-UI keeps
// the whole UI untouched, only the event source changes.
//
// Field payloads are intentionally typed as unknown: they represent
// untrusted JSONL lines and must pass through parseFormField on arrival,
// same as real agent output will.

export type AgentEvent =
  | { type: 'typing' }
  | { type: 'text'; text: string }
  | { type: 'form-start'; formId: string; title: string; description?: string; submitLabel?: string }
  | { type: 'form-field'; field: unknown }
  | { type: 'form-end' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isoToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Opening turn: the user asked to book a court, the agent answers with a
// form. Date is constrained to today or later, bookings in the past make
// no sense and the agent, not the UI, is the one who knows that.
export async function* openingTurn(): AsyncGenerator<AgentEvent> {
  yield { type: 'typing' }
  await sleep(700)
  yield { type: 'text', text: 'Sure. Instead of typing everything out, here is a quick form:' }
  await sleep(450)

  yield {
    type: 'form-start',
    formId: 'booking',
    title: 'Court booking',
    description: 'Fill this in and I will check availability for you.',
    submitLabel: 'Request booking',
  }
  const lines: unknown[] = [
    { id: 'date', type: 'date', label: 'Date', required: true, min: isoToday() },
    {
      id: 'sport',
      type: 'select',
      label: 'Sport',
      required: true,
      options: ['Tennis', 'Football', 'Basketball', 'Padel'],
    },
    { id: 'players', type: 'number', label: 'Players', min: 1, max: 22 },
    { id: 'notes', type: 'text', label: 'Notes', placeholder: 'Anything else?' },
    { id: 'reminder', type: 'checkbox', label: 'Send me a reminder' },
  ]
  for (const field of lines) {
    await sleep(320)
    yield { type: 'form-field', field }
  }
  yield { type: 'form-end' }
}

const SLOTS: Record<string, string[]> = {
  Tennis: ['09:00', '11:00', '17:00'],
  Football: ['10:00', '18:00', '20:00'],
  Basketball: ['12:00', '16:00', '19:00'],
  Padel: ['08:00', '13:00', '21:00'],
}

// Follow-up turn: the agent reads the submitted values and generates the
// next form from them. Different sport, different slots. This is where
// forms stop being one-shot widgets and become a dialogue.
export async function* followUpTurn(values: FormValues): AsyncGenerator<AgentEvent> {
  const sport = String(values.sport || 'Tennis')
  const date = String(values.date || 'the requested date')
  const slots = SLOTS[sport] ?? SLOTS.Tennis

  yield { type: 'typing' }
  await sleep(900)
  yield {
    type: 'text',
    text: `Found ${slots.length} open ${sport} slots on ${date}. Pick what works:`,
  }
  await sleep(450)

  yield {
    type: 'form-start',
    formId: 'slot',
    title: 'Available slots',
    submitLabel: 'Lock it in',
  }
  const lines: unknown[] = [
    { id: 'slot', type: 'select', label: 'Start time', required: true, options: slots },
    {
      id: 'duration',
      type: 'select',
      label: 'Duration',
      required: true,
      options: ['60 min', '90 min', '120 min'],
    },
    { id: 'confirm', type: 'checkbox', label: 'I confirm this booking', required: true },
  ]
  for (const field of lines) {
    await sleep(320)
    yield { type: 'form-field', field }
  }
  yield { type: 'form-end' }
}

// Closing turn: plain text, the loop is complete.
export async function* closingTurn(
  booking: FormValues,
  slot: FormValues,
): AsyncGenerator<AgentEvent> {
  yield { type: 'typing' }
  await sleep(800)
  yield {
    type: 'text',
    text: `Done. ${String(booking.sport)} on ${String(booking.date)} at ${String(
      slot.slot,
    )} for ${String(slot.duration)}. ${
      booking.reminder === true ? 'I will remind you the day before.' : 'See you there.'
    }`,
  }
}
