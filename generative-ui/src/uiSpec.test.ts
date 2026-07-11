import { describe, it, expect } from 'vitest'
import { parseFormSpec, parseFormField, SpecError, type FormSpec } from './uiSpec'

// The parser is the trust boundary: everything it accepts gets rendered,
// and everything it rejects is what an agent would be told to fix. These
// tests pin both sides of that line.

const validSpec: FormSpec = {
  title: 'Booking',
  fields: [
    { id: 'date', type: 'date', label: 'Date', required: true, min: '2026-07-08' },
    { id: 'sport', type: 'select', label: 'Sport', options: ['Tennis', 'Padel'] },
    { id: 'players', type: 'number', label: 'Players', min: 1, max: 22 },
    { id: 'notes', type: 'text', label: 'Notes' },
    { id: 'reminder', type: 'checkbox', label: 'Remind me' },
  ],
}

describe('parseFormSpec', () => {
  it('accepts a well formed spec and returns it', () => {
    const parsed = parseFormSpec(validSpec)
    expect(parsed.title).toBe('Booking')
    expect(parsed.fields).toHaveLength(5)
  })

  it('keeps optional top level fields when present', () => {
    const parsed = parseFormSpec({
      ...validSpec,
      description: 'Pick a slot',
      submitLabel: 'Book',
    })
    expect(parsed.description).toBe('Pick a slot')
    expect(parsed.submitLabel).toBe('Book')
  })

  it('rejects a non object', () => {
    expect(() => parseFormSpec(null)).toThrow(SpecError)
    expect(() => parseFormSpec('nope')).toThrow(/must be an object/)
  })

  it('requires a non empty title', () => {
    expect(() => parseFormSpec({ ...validSpec, title: '' })).toThrow(/title/)
  })

  it('requires a non empty fields array', () => {
    expect(() => parseFormSpec({ ...validSpec, fields: [] })).toThrow(/fields/)
  })

  it('rejects duplicate field ids', () => {
    const spec = {
      title: 'Dup',
      fields: [
        { id: 'x', type: 'text', label: 'A' },
        { id: 'x', type: 'text', label: 'B' },
      ],
    }
    expect(() => parseFormSpec(spec)).toThrow(/duplicate field id "x"/)
  })

  it('reports the field index in nested errors', () => {
    const spec = {
      title: 'Bad',
      fields: [
        { id: 'ok', type: 'text', label: 'Fine' },
        { id: 'bad', type: 'carousel', label: 'Nope' },
      ],
    }
    expect(() => parseFormSpec(spec)).toThrow(/fields\[1\]\.type/)
  })
})

describe('parseFormField', () => {
  it('requires id, label and a known type', () => {
    expect(() => parseFormField({ type: 'text', label: 'x' })).toThrow(/id/)
    expect(() => parseFormField({ id: 'a', type: 'text' })).toThrow(/label/)
    expect(() => parseFormField({ id: 'a', type: 'wat', label: 'x' })).toThrow(/type/)
  })

  it('requires a non empty options array for selects', () => {
    expect(() => parseFormField({ id: 's', type: 'select', label: 'S' })).toThrow(/options/)
    expect(() =>
      parseFormField({ id: 's', type: 'select', label: 'S', options: [] }),
    ).toThrow(/options/)
    expect(() =>
      parseFormField({ id: 's', type: 'select', label: 'S', options: [1, 2] }),
    ).toThrow(/options/)
  })

  it('accepts numeric bounds only as numbers', () => {
    expect(() =>
      parseFormField({ id: 'n', type: 'number', label: 'N', min: 'low' }),
    ).toThrow(/min/)
    expect(parseFormField({ id: 'n', type: 'number', label: 'N', min: 1, max: 9 })).toMatchObject({
      id: 'n',
      min: 1,
      max: 9,
    })
  })

  it('accepts date bounds only as ISO dates', () => {
    expect(() =>
      parseFormField({ id: 'd', type: 'date', label: 'D', min: '08/07/2026' }),
    ).toThrow(/ISO date/)
    expect(
      parseFormField({ id: 'd', type: 'date', label: 'D', min: '2026-07-08' }),
    ).toMatchObject({ id: 'd', min: '2026-07-08' })
  })

  it('rejects out-of-range dates that match the shape', () => {
    // Date.parse rejects impossible ranges like month 13 or day 45, which
    // would otherwise make a bounded date field unsatisfiable.
    expect(() =>
      parseFormField({ id: 'd', type: 'date', label: 'D', min: '2026-13-45' }),
    ).toThrow(/ISO date/)
  })

  it('rejects a non boolean required flag', () => {
    expect(() =>
      parseFormField({ id: 't', type: 'text', label: 'T', required: 'yes' }),
    ).toThrow(/required/)
  })
})
