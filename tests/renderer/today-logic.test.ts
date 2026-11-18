import { expect, test } from 'vitest'
import { lastSevenDays } from '../../src/renderer/src/components/HabitTicks'
import { parseQuickAdd } from '../../src/renderer/src/components/TaskAdd'
import { dueLabel, longDate } from '../../src/renderer/src/components/TaskRow'

test('due labels', () => {
  expect(dueLabel('2026-11-11', '2026-11-11')).toBe('Today')
  expect(dueLabel('2026-11-12', '2026-11-11')).toBe('Tomorrow')
  expect(dueLabel('2026-11-10', '2026-11-11')).toBe('Yesterday')
  expect(dueLabel('2026-11-06', '2026-11-11')).toBe('5 days overdue')
  expect(dueLabel('2026-11-20', '2026-11-11')).toBe('20 Nov')
  expect(dueLabel('2027-01-05', '2026-11-11')).toBe('5 Jan 2027')
  expect(dueLabel(undefined, '2026-11-11')).toBe('')
})

test('long date heading', () => {
  expect(longDate('2026-11-11')).toBe('Wednesday, 11 November')
})

test('last seven days end on the given day', () => {
  expect(lastSevenDays('2026-11-11')).toEqual([
    '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'
  ])
})

test('quick add reads a trailing date word and priority', () => {
  expect(parseQuickAdd('Call CA tomorrow !high', '2026-11-11')).toEqual({ title: 'Call CA', due: '2026-11-12', priority: 'high' })
  expect(parseQuickAdd('Call CA !low tomorrow', '2026-11-11')).toEqual({ title: 'Call CA', due: '2026-11-12', priority: 'low' })
  expect(parseQuickAdd('Send deck today', '2026-11-11')).toEqual({ title: 'Send deck', due: '2026-11-11' })
  expect(parseQuickAdd('Read about tomorrow land', '2026-11-11')).toEqual({ title: 'Read about tomorrow land' })
  expect(parseQuickAdd('Plain', '2026-11-11')).toEqual({ title: 'Plain' })
  expect(parseQuickAdd('  today  ', '2026-11-11')).toEqual({ title: 'today' })
})
