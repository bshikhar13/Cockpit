const pad = (n: number): string => String(n).padStart(2, '0')

function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The day the owner is living in: the calendar date, shifted so it rolls over at rolloverHour. */
export function logicalDate(now: Date, rolloverHour: number): string {
  const shifted = new Date(now.getTime() - rolloverHour * 3600_000)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}

export function addDays(date: string, n: number): string {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + n)
  return fromUtc(d)
}

/** 0 = Sunday */
export function weekday(date: string): number {
  return toUtc(date).getUTCDay()
}

/** b - a, in days */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000)
}

export function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s
}
