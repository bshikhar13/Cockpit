import { expect, test } from 'vitest'
import {
  addTask, completeTask, insertTask, listTasks, removeTask, uncompleteTask, updateTask
} from '../../src/core/tasks/file'

const file = '# Tasks\n\nSome prose the owner wrote.\n\n- [ ] A 📅 2026-11-11 🆔 aaaaaa\n- [ ] B\n- not a task\n'

test('lists only task lines with their line numbers', () => {
  expect(listTasks(file).map((t) => [t.task.title, t.line])).toEqual([['A', 4], ['B', 5]])
})

test('add appends after the last task line and assigns an id', () => {
  const added = addTask(file, { title: 'C', due: '2026-11-12' })
  expect(added.text.split('\n')[6]).toBe(`- [ ] C 📅 2026-11-12 🆔 ${added.task.id}`)
  expect(added.text.split('\n')[7]).toBe('- not a task')
  expect(addTask('', { title: 'First' }).text).toMatch(/^- \[ \] First 🆔 [a-z0-9]{6}\n$/)
  expect(addTask('# Tasks', { title: 'First' }).text).toMatch(/^# Tasks\n- \[ \] First 🆔 [a-z0-9]{6}\n$/)
})

test('update by id changes only that line', () => {
  const up = updateTask(file, { id: 'aaaaaa' }, { title: 'A2', due: undefined, priority: 'high' })
  expect(up.split('\n')[4]).toBe('- [ ] A2 ⏫ 🆔 aaaaaa')
  expect(up.split('\n').filter((_, i) => i !== 4)).toEqual(file.split('\n').filter((_, i) => i !== 4))
})

test('mutating a line without an id assigns one', () => {
  expect(updateTask(file, { line: 5 }, { due: '2026-11-13' }).split('\n')[5]).toMatch(
    /^- \[ \] B 📅 2026-11-13 🆔 [a-z0-9]{6}$/
  )
})

test('completes a non-repeating task', () => {
  expect(completeTask(file, { id: 'aaaaaa' }, '2026-11-11').split('\n')[4]).toBe(
    '- [x] A 📅 2026-11-11 ✅ 2026-11-11 🆔 aaaaaa'
  )
})

test('completing a repeating task adds exactly one next occurrence below it', () => {
  const rep = '- [ ] Run 🔁 every day 📅 2026-11-06 🆔 rrrrrr\n- [ ] Other 🆔 oooooo\n'
  const done = completeTask(rep, { id: 'rrrrrr' }, '2026-11-11').split('\n')
  expect(done[0]).toBe('- [x] Run 🔁 every day 📅 2026-11-06 ✅ 2026-11-11 🆔 rrrrrr')
  expect(done[1]).toMatch(/^- \[ \] Run 🔁 every day 📅 2026-11-12 🆔 (?!rrrrrr)[a-z0-9]{6}$/)
  expect(done[2]).toBe('- [ ] Other 🆔 oooooo')
  expect(done).toHaveLength(4)
})

test('completing a repeating task with no due date uses today as the due date', () => {
  const done = completeTask('- [ ] Run 🔁 every week 🆔 rrrrrr\n', { id: 'rrrrrr' }, '2026-11-11').split('\n')
  expect(done[1]).toMatch(/^- \[ \] Run 🔁 every week 📅 2026-11-18 🆔 [a-z0-9]{6}$/)
})

test('completing an already completed task changes nothing', () => {
  const t = '- [x] A ✅ 2026-11-10 🆔 aaaaaa\n'
  expect(completeTask(t, { id: 'aaaaaa' }, '2026-11-11')).toBe(t)
})

test('uncomplete removes the tick and the completion date', () => {
  expect(uncompleteTask('- [x] A ✅ 2026-11-11 🆔 aaaaaa\n', { id: 'aaaaaa' })).toBe('- [ ] A 🆔 aaaaaa\n')
})

test('remove deletes the line and returns the task', () => {
  const r = removeTask(file, { id: 'aaaaaa' })
  expect(r.text).not.toContain('aaaaaa')
  expect(r.removed.title).toBe('A')
  expect(r.text.split('\n')).toHaveLength(file.split('\n').length - 1)
})

test('insert keeps the task id', () => {
  const t = insertTask('', { id: 'keepme', title: 'Moved', done: false })
  expect(t).toBe('- [ ] Moved 🆔 keepme\n')
})

test('unknown refs throw', () => {
  expect(() => updateTask(file, { id: 'zzzzzz' }, {})).toThrow('task not found')
  expect(() => updateTask(file, { line: 2 }, {})).toThrow('task not found')
})

test('line endings and unknown trailing text survive an edit', () => {
  expect(updateTask('- [ ] A 🆔 aaaaaa\r\n- [ ] B\r\n', { id: 'aaaaaa' }, { title: 'Z' })).toBe(
    '- [ ] Z 🆔 aaaaaa\r\n- [ ] B\r\n'
  )
  expect(updateTask('- [ ] A 📅 soon 🆔 aaaaaa\n', { id: 'aaaaaa' }, { priority: 'low' })).toBe(
    '- [ ] A 🔽 📅 soon 🆔 aaaaaa\n'
  )
})
