import { expect, test } from 'vitest'
import {
  dateFromDiaryPath, diaryPath, newDiaryText, readHabitTicks, renameHabitTick, setHabitTick
} from '../../src/core/diary'
import { readFrontmatter, splitFrontmatter, updateFrontmatter } from '../../src/core/frontmatter'

const body = '\nSpent the morning on the deck.\n\n| a | b |\n|---|---|\n'
const d = '---\ndate: 2026-11-11\n---\n' + body

test('ticking a habit leaves the body byte-identical', () => {
  const ticked = setHabitTick(d, 'Run', true)
  expect(ticked.endsWith(body)).toBe(true)
  expect(ticked).toBe('---\ndate: 2026-11-11\nhabits:\n  Run: true\n---\n' + body)
  expect(readHabitTicks(ticked)).toEqual({ Run: true })
})

test('unticking removes the key and the empty habits map', () => {
  const ticked = setHabitTick(d, 'Run', true)
  expect(readHabitTicks(setHabitTick(ticked, 'Run', false))).toEqual({})
  expect(setHabitTick(ticked, 'Run', false)).toBe(d)
})

test('a file with no frontmatter gains one and keeps its body', () => {
  expect(setHabitTick('Just text\n', 'Run', true)).toMatch(/^---\n[\s\S]*---\nJust text\n$/)
  expect(setHabitTick('Just text\n', 'Run', false)).toBe('Just text\n')
})

test('awkward habit names stay valid YAML', () => {
  for (const name of ['5k run', 'Read: 20 min', '"Quote"', 'yes', 'No sugar #1', 'Café', 'true', '- dash']) {
    expect(readHabitTicks(setHabitTick(d, name, true))).toEqual({ [name]: true })
  }
})

test('rename keeps the value and the body', () => {
  const ticked = setHabitTick(d, 'Run', true)
  const r = renameHabitTick(ticked, 'Run', 'Morning run')
  expect(readHabitTicks(r)).toEqual({ 'Morning run': true })
  expect(r.endsWith(body)).toBe(true)
  expect(renameHabitTick(d, 'Run', 'X')).toBe(d)
})

test('invalid frontmatter reads as empty and refuses to be written', () => {
  const bad = '---\n: : bad\n  - x: [\n---\nx'
  expect(readHabitTicks(bad)).toEqual({})
  expect(() => setHabitTick(bad, 'Run', true)).toThrow('invalid frontmatter')
})

test('CRLF files keep CRLF', () => {
  const out = setHabitTick('---\r\ndate: 2026-11-11\r\n---\r\nA\r\nB\r\n', 'Run', true)
  expect(out.endsWith('A\r\nB\r\n')).toBe(true)
  expect(out).not.toMatch(/[^\r]\n/)
})

test('frontmatter helpers', () => {
  expect(splitFrontmatter(d)).toEqual({ yaml: 'date: 2026-11-11\n', body, bodyOffset: 25 })
  expect(splitFrontmatter('no fm')).toEqual({ yaml: null, body: 'no fm', bodyOffset: 0 })
  expect(splitFrontmatter('text\n---\nnot: fm\n---\n').yaml).toBeNull()
  expect(readFrontmatter(d)).toEqual({ date: '2026-11-11' })
  expect(updateFrontmatter('Body\n', { status: 'active' })).toBe('---\nstatus: active\n---\nBody\n')
  expect(updateFrontmatter(d, { status: 'done' })).toBe('---\ndate: 2026-11-11\nstatus: done\n---\n' + body)
  expect(updateFrontmatter(d, { date: null })).toBe(body)
  expect(updateFrontmatter(d, { date: '2026-11-11' })).toBe(d)
  // prose between two horizontal rules is the owner's text, not frontmatter
  const prose = '---\nOpening words\n---\n\nRest\n'
  expect(splitFrontmatter(prose).yaml).toBeNull()
  expect(updateFrontmatter(prose, { status: 'done' })).toBe('---\nstatus: done\n---\n' + prose)
  // long values and flow lists are not re-flowed
  const long = '---\nnote: ' + 'word '.repeat(30).trim() + '\ntags: [a, b]\n---\nB\n'
  expect(updateFrontmatter(long, { status: 'x' })).toBe(long.replace('---\nB', 'status: x\n---\nB'))
})

test('diary paths', () => {
  expect(diaryPath('2026-11-11')).toBe('Diary/2026/2026-11-11.md')
  expect(dateFromDiaryPath('Diary/2026/2026-11-11.md')).toBe('2026-11-11')
  expect(dateFromDiaryPath('Areas/Job/Job.md')).toBeNull()
  expect(newDiaryText('2026-11-11')).toBe('---\ndate: 2026-11-11\n---\n\n')
})
