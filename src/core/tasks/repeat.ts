import { addDays, daysBetween, weekday } from '../day'

export type RepeatRule =
  | { kind: 'days'; every: number }
  | { kind: 'weekday' }
  | { kind: 'weeks'; every: number }
  | { kind: 'month' }

export const REPEAT_PRESETS = ['every day', 'every weekday', 'every week', 'every month']

export function parseRepeat(text: string): RepeatRule | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (t === 'every day') return { kind: 'days', every: 1 }
  if (t === 'every weekday') return { kind: 'weekday' }
  if (t === 'every week') return { kind: 'weeks', every: 1 }
  if (t === 'every month') return { kind: 'month' }
  const m = /^every (\d+) (day|week)s?$/.exec(t)
  if (!m) return null
  const every = Number(m[1])
  if (every < 1) return null
  return m[2] === 'day' ? { kind: 'days', every } : { kind: 'weeks', every }
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The earliest date on the due date's cadence that falls strictly after both the due date
 * and the day the task was completed. A task ticked late yields one next task, never a backlog.
 */
export function nextOccurrence(rule: RepeatRule, due: string, completedOn: string): string {
  const floor = completedOn > due ? completedOn : due
  if (rule.kind === 'weekday') {
    let d = addDays(floor, 1)
    while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1)
    return d
  }
  if (rule.kind === 'month') {
    const [y, m, day] = due.split('-').map(Number)
    for (let k = 1; ; k++) {
      const year = y + Math.floor((m - 1 + k) / 12)
      const month = ((m - 1 + k) % 12) + 1
      const d = Math.min(day, lastDayOfMonth(year, month))
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (candidate > floor) return candidate
    }
  }
  const step = rule.kind === 'weeks' ? rule.every * 7 : rule.every
  const k = Math.floor(daysBetween(due, floor) / step) + 1
  return addDays(due, k * step)
}
