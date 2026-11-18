import { expect, test } from 'vitest'
import { addHabit, archiveHabit, parseHabits, renameHabit, reorderHabits, unarchiveHabit } from '../../src/core/habits'

const h = '# Habits\n\n- Run\n- Read\n\n## Archived\n\n- Yoga\n'

test('parses active and archived habits', () => {
  expect(parseHabits(h)).toEqual({ active: ['Run', 'Read'], archived: ['Yoga'] })
  expect(parseHabits('')).toEqual({ active: [], archived: [] })
  expect(parseHabits('# Habits\r\n\r\n- Run\r\n')).toEqual({ active: ['Run'], archived: [] })
})

test('only top-level bullets in the habit sections are habits', () => {
  const text = '# Habits\n\nSome prose.\n\n- Run\n  - a sub-point\n\n## Archived habits\n\n- Yoga\n\n## Ideas\n\n- Cold showers\n'
  expect(parseHabits(text)).toEqual({ active: ['Run'], archived: ['Yoga'] })
})

test('adding builds the file up from nothing', () => {
  expect(addHabit('', 'Run')).toBe('# Habits\n\n- Run\n')
  expect(addHabit('# Habits\n', 'Run')).toBe('# Habits\n\n- Run\n')
  expect(addHabit('# Habits\n\n- Run\n', 'Read')).toBe('# Habits\n\n- Run\n- Read\n')
  expect(addHabit(h, 'Guitar')).toBe('# Habits\n\n- Run\n- Read\n- Guitar\n\n## Archived\n\n- Yoga\n')
})

test('rename, archive, unarchive, and reorder touch only their own lines', () => {
  expect(renameHabit(h, 'Read', 'Read 20 min')).toBe(h.replace('- Read', '- Read 20 min'))
  expect(archiveHabit(h, 'Run')).toBe('# Habits\n\n- Read\n\n## Archived\n\n- Yoga\n- Run\n')
  expect(unarchiveHabit(h, 'Yoga')).toBe('# Habits\n\n- Run\n- Read\n- Yoga\n\n## Archived\n\n')
  expect(reorderHabits(h, ['Read', 'Run'])).toBe('# Habits\n\n- Read\n- Run\n\n## Archived\n\n- Yoga\n')
  expect(reorderHabits(h, ['Read'])).toBe('# Habits\n\n- Read\n- Run\n\n## Archived\n\n- Yoga\n')
  expect(archiveHabit(h, 'Nope')).toBe(h)
})

test('CRLF files stay CRLF', () => {
  expect(addHabit('# Habits\r\n\r\n- Run\r\n', 'Read')).toBe('# Habits\r\n\r\n- Run\r\n- Read\r\n')
})
