import { expect, test } from 'vitest'
import { addDays, daysBetween, logicalDate, weekday } from '../../src/core/day'

test('logical date rolls over at the rollover hour, not midnight', () => {
  expect(logicalDate(new Date(2026, 10, 12, 0, 30), 4)).toBe('2026-11-11')
  expect(logicalDate(new Date(2026, 10, 12, 3, 59), 4)).toBe('2026-11-11')
  expect(logicalDate(new Date(2026, 10, 12, 4, 0), 4)).toBe('2026-11-12')
  expect(logicalDate(new Date(2026, 0, 1, 2, 0), 4)).toBe('2025-12-31')
})

test('date arithmetic', () => {
  expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  expect(weekday('2026-11-11')).toBe(3)
  expect(daysBetween('2026-11-11', '2026-11-16')).toBe(5)
})
