import { expect, test } from 'vitest'
import { nextOccurrence, parseRepeat } from '../../src/core/tasks/repeat'

test('parses supported rules', () => {
  expect(parseRepeat('every day')).toEqual({ kind: 'days', every: 1 })
  expect(parseRepeat('every 3 days')).toEqual({ kind: 'days', every: 3 })
  expect(parseRepeat('every weekday')).toEqual({ kind: 'weekday' })
  expect(parseRepeat('every week')).toEqual({ kind: 'weeks', every: 1 })
  expect(parseRepeat('every 2 weeks')).toEqual({ kind: 'weeks', every: 2 })
  expect(parseRepeat('every month')).toEqual({ kind: 'month' })
  expect(parseRepeat('Every Day')).toEqual({ kind: 'days', every: 1 })
})

test('rejects unknown rules', () => {
  expect(parseRepeat('sometimes')).toBeNull()
  expect(parseRepeat('every 0 days')).toBeNull()
})

const n = (r: string, due: string, done: string): string => nextOccurrence(parseRepeat(r)!, due, done)

test('daily task never builds a backlog', () => {
  expect(n('every day', '2026-11-11', '2026-11-11')).toBe('2026-11-12')
  expect(n('every day', '2026-11-06', '2026-11-11')).toBe('2026-11-12')
})

test('completed early still lands after the due day', () => {
  expect(n('every day', '2026-11-11', '2026-11-09')).toBe('2026-11-12')
})

test('every N days stays on the due date cadence', () => {
  expect(n('every 3 days', '2026-11-01', '2026-11-11')).toBe('2026-11-13')
})

test('weekday rule skips the weekend', () => {
  expect(n('every weekday', '2026-11-13', '2026-11-13')).toBe('2026-11-16')
  expect(n('every weekday', '2026-11-13', '2026-11-14')).toBe('2026-11-16')
})

test('weekly rules keep the due weekday', () => {
  expect(n('every week', '2026-11-11', '2026-11-11')).toBe('2026-11-18')
  expect(n('every week', '2026-11-11', '2026-11-20')).toBe('2026-11-25')
  expect(n('every 2 weeks', '2026-11-11', '2026-11-12')).toBe('2026-11-25')
})

test('monthly rule keeps the day of month, clamped', () => {
  expect(n('every month', '2026-01-31', '2026-01-31')).toBe('2026-02-28')
  expect(n('every month', '2026-11-11', '2026-12-20')).toBe('2027-01-11')
})
