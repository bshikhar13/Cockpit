import { daysBetween, isDate } from './day'

export type ProjectStatus = 'active' | 'to-pick-up' | 'done'

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'to-pick-up', label: 'To be picked up' },
  { value: 'done', label: 'Done' }
]

/** The status written in a project's home note. Missing or unknown values count as active. */
export function projectStatus(raw: string | undefined): ProjectStatus {
  const s = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  if (s === 'done') return 'done'
  if (s === 'to-pick-up' || s === 'to-be-picked-up') return 'to-pick-up'
  return 'active'
}

export interface DaysLeft {
  /** negative once the deadline has passed */
  days: number
  label: string
  /** ok: more than a week away; near: within a week; over: passed */
  tone: 'ok' | 'near' | 'over'
}

export function daysLeft(deadline: string | undefined, today: string): DaysLeft | null {
  if (!deadline || !isDate(deadline)) return null
  const days = daysBetween(today, deadline)
  const plural = (n: number): string => `${n} day${n === 1 ? '' : 's'}`
  if (days > 0) return { days, label: `${plural(days)} left`, tone: days > 7 ? 'ok' : 'near' }
  if (days === 0) return { days, label: 'Due today', tone: 'near' }
  return { days, label: `${plural(-days)} overdue`, tone: 'over' }
}
