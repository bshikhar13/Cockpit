import { beforeEach, expect, test } from 'vitest'
import { DiaryService } from '../../src/main/services/diary'
import { HabitsService } from '../../src/main/services/habits'
import { TasksService } from '../../src/main/services/tasks'
import type { Vault } from '../../src/main/vault'
import type { VaultIndex } from '../../src/main/vault-index'
import { tempVault } from './helpers'

let v: Vault
let ix: VaultIndex
let t: TasksService
const titles = (date: string): string[] => t.list({ view: 'day', date }).map((x) => `${x.done ? '✓ ' : ''}${x.title}`)
beforeEach(async () => {
  ;({ v, ix } = await tempVault())
  t = new TasksService(v, ix, () => '2026-11-12')
  await t.add({ title: 'Overdue', due: '2026-11-09' })
  await t.add({ title: 'Due today', due: '2026-11-12' })
  await t.add({ title: 'Flights', due: '2026-11-18', priority: 'high', container: 'Projects/Trip' })
  await t.add({ title: 'Also the 18th', due: '2026-11-18' })
  await t.add({ title: 'Undated' })
})

test('today shows what is due today plus anything overdue', () => {
  expect(titles('2026-11-12')).toEqual(['Overdue', 'Due today'])
})

test('another day shows the tasks due on that day, and only those', () => {
  expect(titles('2026-11-18')).toEqual(['Flights', 'Also the 18th'])
  expect(titles('2026-11-17')).toEqual([])
  expect(titles('2026-11-09')).toEqual(['Overdue']) // a past day still shows what was due then and is not done
})

test('tasks finished on a day stay listed for that day, after the open ones', async () => {
  const due = t.list({ view: 'day', date: '2026-11-12' }).find((x) => x.title === 'Due today')!
  await t.complete({ file: due.file, ref: { id: due.id! } })
  const undated = t.list({ view: 'inbox' }).find((x) => x.title === 'Undated')!
  await t.complete({ file: undated.file, ref: { id: undated.id! } })
  expect(titles('2026-11-12')).toEqual(['Overdue', '✓ Due today', '✓ Undated'])
  expect(titles('2026-11-18')).toEqual(['Flights', 'Also the 18th'])
})

test('the days that have open tasks are known, for marking the week strip', () => {
  expect(t.dueDates('2026-11-09', '2026-11-18')).toEqual({ '2026-11-09': 1, '2026-11-12': 1, '2026-11-18': 2 })
  expect(t.dueDates('2026-11-13', '2026-11-17')).toEqual({})
})

test('looking at a day does not create a diary file; writing or ticking a habit does', async () => {
  const d = new DiaryService(v, ix, () => ({ vaultPath: v.root, rolloverHour: 0, encrypted: false }), () => new Date(2026, 10, 12, 16))
  for (const date of ['2026-11-12', '2026-11-18', '2026-11-25']) {
    const rel = await d.open(date)
    expect(await v.exists(rel)).toBe(false)
    expect(await d.read(rel)).toEqual({ text: `---\ndate: ${date}\n---\n\n`, hash: '' })
  }
  expect((await v.listMarkdown()).filter((r) => r.startsWith('Diary/'))).toEqual([])
  // the first save creates it, with no conflict copy
  const saved = await v.save('Diary/2026/2026-11-18.md', '---\ndate: 2026-11-18\n---\n\nTrip prep.', '')
  expect(saved.conflictCopy).toBeUndefined()
  expect((await d.read('Diary/2026/2026-11-18.md')).text).toContain('Trip prep.')
  await new HabitsService(v, ix).setTick('2026-11-25', 'Run', true)
  expect(await v.exists('Diary/2026/2026-11-25.md')).toBe(true)
  await expect(d.read('Inbox/Missing.md')).rejects.toThrow() // only diary pages get a stand-in
})
