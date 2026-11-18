import { beforeEach, expect, test } from 'vitest'
import { TasksService } from '../../src/main/services/tasks'
import type { Vault } from '../../src/main/vault'
import type { VaultIndex } from '../../src/main/vault-index'
import { tempVault } from './helpers'

let v: Vault
let ix: VaultIndex
let t: TasksService
const handle = (title: string) => {
  const x = t.list({ view: 'all' }, true).find((i) => i.title === title)!
  return { file: x.file, ref: x.id ? { id: x.id } : { line: x.line } }
}
beforeEach(async () => {
  ;({ v, ix } = await tempVault())
  t = new TasksService(v, ix, () => '2026-11-11')
  await t.add({ title: 'Overdue', due: '2026-11-09' })
  await t.add({ title: 'Today low', due: '2026-11-11', priority: 'low' })
  await t.add({ title: 'Today high', due: '2026-11-11', priority: 'high', container: 'Areas/Job' })
  await t.add({ title: 'Undated' })
  await t.add({ title: 'Next week', due: '2026-11-18' })
  await t.add({ title: 'Far', due: '2026-11-19' })
})

test('today shows overdue then today by priority; undated tasks stay out', () => {
  expect(t.list({ view: 'today' }).map((x) => x.title)).toEqual(['Overdue', 'Today high', 'Today low'])
})

test('upcoming covers the next seven days only', () => {
  expect(t.list({ view: 'upcoming' }).map((x) => x.title)).toEqual(['Next week'])
})

test('inbox and container views include undated tasks', () => {
  expect(t.list({ view: 'inbox' }).map((x) => x.title)).toContain('Undated')
  expect(t.list({ view: 'container', container: 'Areas/Job' }).map((x) => x.title)).toEqual(['Today high'])
})

test('add creates the task file for a new container and returns the item', async () => {
  const item = await t.add({ title: 'New', container: 'Projects/New' })
  expect(item).toMatchObject({ title: 'New', container: 'Projects/New', file: 'Projects/New/Tasks.md' })
  expect(await v.exists('Projects/New/Tasks.md')).toBe(true)
  await expect(t.add({ title: '   ' })).rejects.toThrow('title')
})

test('adding a repeat to an undated task dates it today', async () => {
  await t.update(handle('Undated'), { repeat: 'every day' })
  expect(t.list({ view: 'today' }).map((x) => x.title)).toContain('Undated')
  await expect(t.update(handle('Undated'), { repeat: 'whenever' })).rejects.toThrow('Unknown repeat rule')
  await expect(t.add({ title: 'Bad', repeat: 'whenever' })).rejects.toThrow('Unknown repeat rule')
})

test('completing a repeating task leaves exactly one open copy, due tomorrow', async () => {
  await t.update(handle('Undated'), { repeat: 'every day' })
  await t.complete(handle('Undated'))
  const open = t.list({ view: 'all' }).filter((x) => x.title === 'Undated')
  expect(open.map((x) => x.due)).toEqual(['2026-11-12'])
  expect(t.list({ view: 'all' }, true).filter((x) => x.title === 'Undated')).toHaveLength(2)
})

test('complete hides a task; uncomplete brings it back', async () => {
  const h = handle('Overdue')
  await t.complete(h)
  expect(t.list({ view: 'today' }).map((x) => x.title)).not.toContain('Overdue')
  await t.uncomplete(h)
  expect(t.list({ view: 'today' }).map((x) => x.title)).toContain('Overdue')
})

test('move keeps the id and creates the destination file', async () => {
  const before = t.list({ view: 'all' }).find((x) => x.title === 'Far')!
  await t.move(handle('Far'), 'Projects/New')
  const after = t.list({ view: 'all' }).find((x) => x.title === 'Far')!
  expect(after).toMatchObject({ id: before.id, container: 'Projects/New' })
  expect((await v.read('Inbox/Tasks.md')).text).not.toContain('Far')
})

test('remove deletes the line', async () => {
  await t.remove(handle('Far'))
  expect(t.list({ view: 'all' }).map((x) => x.title)).not.toContain('Far')
})

test('a hand-written line with no id can be completed by line number', async () => {
  await v.write('Areas/Job/Tasks.md', '- [ ] Hand written 📅 2026-11-11\n')
  ix.upsert('Areas/Job/Tasks.md', (await v.read('Areas/Job/Tasks.md')).text)
  const hw = t.list({ view: 'today' }).find((x) => x.title === 'Hand written')!
  expect(hw.id).toBeNull()
  await t.complete({ file: hw.file, ref: { line: hw.line } })
  expect((await v.read('Areas/Job/Tasks.md')).text).toMatch(
    /^- \[x\] Hand written 📅 2026-11-11 ✅ 2026-11-11 🆔 [a-z0-9]{6}\n$/
  )
})
