// The booking domain, reused from the generative-ui POC (sports courts).
// This is the in-memory data the MCP server reads from. In a real system this
// module would be a call to the booking backend; here it is deterministic mock
// data so the same query always renders the same grid.

export const SPORTS = ["Tennis", "Football", "Basketball", "Padel"] as const
export type Sport = (typeof SPORTS)[number]

// One shared daily slot grid: these are the columns of the availability panel.
export const SLOTS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]

// How many courts each sport has (the rows of the panel).
const COURTS: Record<Sport, string[]> = {
  Tennis: ["Court 1", "Court 2", "Court 3"],
  Football: ["Pitch A", "Pitch B"],
  Basketball: ["Court 1", "Court 2"],
  Padel: ["Court 1", "Court 2", "Court 3"],
}

export interface Cell {
  time: string
  taken: boolean
}
export interface Court {
  name: string
  cells: Cell[]
}
export interface Availability {
  date: string
  sport: Sport
  slots: string[]
  courts: Court[]
  summary: { free: number; total: number }
}

export function isoToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// FNV-1a: a tiny stable string hash. Used to decide free vs taken from the
// (date, sport, court, slot) tuple, so availability is deterministic per query
// but still varies believably across dates and sports.
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function getAvailability(date: string, sport: Sport): Availability {
  const courts: Court[] = COURTS[sport].map((name) => {
    const cells: Cell[] = SLOTS.map((time) => ({
      time,
      // roughly one slot in three is taken, chosen deterministically
      taken: hash(`${date}|${sport}|${name}|${time}`) % 3 === 0,
    }))
    return { name, cells }
  })
  const total = courts.length * SLOTS.length
  const free = courts.reduce((n, c) => n + c.cells.filter((x) => !x.taken).length, 0)
  return { date, sport, slots: SLOTS, courts, summary: { free, total } }
}
