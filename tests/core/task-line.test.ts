import { expect, test } from 'vitest'
import { formatTaskLine, newTaskId, parseTaskLine } from '../../src/core/tasks/line'

const samples = [
  '- [ ] Send pilot deck 📅 2026-11-12 ⏫ 🆔 k3f9a2',
  '- [x] Book physio 📅 2026-11-10 ✅ 2026-11-10 🆔 m2d7q9',
  '- [ ] Review PR queue 🔁 every weekday 📅 2026-11-11 🆔 p8x1c4',
  '- [ ] Bare task',
  '* [X] Star bullet',
  '- [ ] Bad date 📅 tomorrow'
]

test('parses a full task line', () => {
  expect(parseTaskLine(samples[0])).toEqual({
    id: 'k3f9a2', title: 'Send pilot deck', done: false, due: '2026-11-12', priority: 'high'
  })
})

test('parses completed and repeating tasks', () => {
  expect(parseTaskLine(samples[1])).toMatchObject({ done: true, completed: '2026-11-10' })
  expect(parseTaskLine(samples[2])).toMatchObject({ repeat: 'every weekday', due: '2026-11-11' })
})

test('parses hand-written lines without metadata', () => {
  expect(parseTaskLine(samples[3])).toEqual({ id: null, title: 'Bare task', done: false })
  expect(parseTaskLine(samples[4])).toMatchObject({ done: true, title: 'Star bullet' })
})

test('keeps metadata it cannot understand as extra text', () => {
  expect(parseTaskLine(samples[5])).toEqual({ id: null, title: 'Bad date', done: false, extra: '📅 tomorrow' })
})

test('rejects lines that are not tasks', () => {
  expect(parseTaskLine('Some prose')).toBeNull()
  expect(parseTaskLine('- not a checkbox')).toBeNull()
  expect(parseTaskLine('- [ ] ')).toBeNull()
})

test('formats in canonical order', () => {
  const t = { id: 'ab12cd', title: 'X', done: false, repeat: 'every week', due: '2026-11-12', priority: 'low' as const }
  expect(formatTaskLine(t)).toBe('- [ ] X 🔁 every week 📅 2026-11-12 🔽 🆔 ab12cd')
})

test('round trips every sample', () => {
  for (const l of samples) {
    const once = parseTaskLine(l)!
    expect(parseTaskLine(formatTaskLine(once))).toEqual(once)
  }
})

test('new ids are six lowercase alphanumerics', () => {
  expect(newTaskId()).toMatch(/^[a-z0-9]{6}$/)
})
