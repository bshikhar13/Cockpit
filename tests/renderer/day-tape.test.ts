import { expect, test } from 'vitest'
import { tapeDays } from '../../src/renderer/src/components/DayTape'

test('the day tape shows a week centred on the day in view', () => {
  expect(tapeDays('2026-11-11', '2026-11-11')).toEqual([
    { date: '2026-11-08', weekday: 'SUN', day: 8, current: false, today: false },
    { date: '2026-11-09', weekday: 'MON', day: 9, current: false, today: false },
    { date: '2026-11-10', weekday: 'TUE', day: 10, current: false, today: false },
    { date: '2026-11-11', weekday: 'WED', day: 11, current: true, today: true },
    { date: '2026-11-12', weekday: 'THU', day: 12, current: false, today: false },
    { date: '2026-11-13', weekday: 'FRI', day: 13, current: false, today: false },
    { date: '2026-11-14', weekday: 'SAT', day: 14, current: false, today: false }
  ])
})

test('today stays marked when another day is in view, across a month boundary', () => {
  const tape = tapeDays('2026-10-30', '2026-11-01')
  expect(tape.map((d) => d.day)).toEqual([27, 28, 29, 30, 31, 1, 2])
  expect(tape.find((d) => d.current)?.date).toBe('2026-10-30')
  expect(tape.find((d) => d.today)?.date).toBe('2026-11-01')
})
