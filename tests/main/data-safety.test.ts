import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, expect, test } from 'vitest'
import { readFrontmatter } from '../../src/core/frontmatter'
import { registerIpc, type Runtime } from '../../src/main/ipc'
import { DiaryService } from '../../src/main/services/diary'
import { HabitsService } from '../../src/main/services/habits'
import { NotesService } from '../../src/main/services/notes'
import { TasksService } from '../../src/main/services/tasks'
import type { Vault } from '../../src/main/vault'
import type { VaultIndex } from '../../src/main/vault-index'
import { tempVault } from './helpers'

let v: Vault
let ix: VaultIndex
let notes: NotesService
beforeEach(async () => {
  ;({ v, ix } = await tempVault())
  notes = new NotesService(v, ix)
})
/** writes straight to disk, behind the index's back, like Finder or another editor would */
const outside = (rel: string, text: string): void => {
  mkdirSync(join(v.root, rel, '..'), { recursive: true })
  writeFileSync(join(v.root, rel), text)
}

test('creating an area over a hand-made folder keeps its tasks and notes', async () => {
  outside('Areas/Fitness/Tasks.md', '- [ ] Book physio 🆔 aaaaaa\n')
  outside('Areas/Fitness/Plan.md', 'Run three times a week.\n')
  expect(await notes.createContainer('area', 'Fitness')).toBe('Areas/Fitness/Fitness.md')
  expect((await v.read('Areas/Fitness/Tasks.md')).text).toBe('- [ ] Book physio 🆔 aaaaaa\n')
  expect((await v.read('Areas/Fitness/Plan.md')).text).toBe('Run three times a week.\n')
  expect(ix.tasks().map((t) => t.title)).toEqual(['Book physio'])
})

test('creating a project never overwrites a home note the index has not seen', async () => {
  outside('Projects/Launch/Launch.md', 'Words written elsewhere.\n')
  await notes.createContainer('project', 'Launch').catch(() => undefined)
  expect((await v.read('Projects/Launch/Launch.md')).text).toBe('Words written elsewhere.\n')
})

test('creating a note never overwrites a file the index has not seen', async () => {
  outside('Inbox/Idea.md', 'Already here.\n')
  await expect(notes.create(null, 'Idea')).rejects.toThrow('already exists')
  expect((await v.read('Inbox/Idea.md')).text).toBe('Already here.\n')
})

test('a file that cannot be checked is not treated as absent', async () => {
  outside('Locked/Tasks.md', '- [ ] Keep me 🆔 aaaaaa\n')
  chmodSync(join(v.root, 'Locked'), 0o000)
  try {
    await expect(v.exists('Locked/Tasks.md')).rejects.toThrow()
    const tasks = new TasksService(v, ix, () => '2026-11-11')
    await expect(tasks.add({ title: 'New', container: 'Locked' })).rejects.toThrow()
  } finally {
    chmodSync(join(v.root, 'Locked'), 0o755)
  }
  expect((await v.read('Locked/Tasks.md')).text).toBe('- [ ] Keep me 🆔 aaaaaa\n')
  expect(await v.exists('Inbox/nope.md')).toBe(false)
  expect(await v.exists('Inbox/Tasks.md/child.md')).toBe(false)
})

test('project settings and archive keep a note that opens with a horizontal rule', async () => {
  const rel = await notes.createContainer('area', 'Job')
  const prose = '---\nOpening words\n---\n\nRest of the note.\n'
  await v.write(rel, prose)
  ix.upsert(rel, prose)
  await notes.archive('Areas/Job')
  const archived = (await v.read('Archive/Job/Job.md')).text
  expect(archived.endsWith(prose)).toBe(true)
  expect(readFrontmatter(archived)).toEqual({ archivedFrom: 'Areas' })
  expect(await notes.unarchive('Archive/Job')).toBe('Areas/Job')
  expect((await v.read(rel)).text).toBe(prose)
})

test('project settings refuse to touch frontmatter with a typo, and keep comments otherwise', async () => {
  const rel = await notes.createContainer('project', 'Launch')
  const broken = '---\nstatus: active\ndeadline: [tbd\n---\nBody\n'
  await v.write(rel, broken)
  await expect(notes.setProjectMeta(rel, { status: 'done' })).rejects.toThrow('invalid frontmatter')
  expect((await v.read(rel)).text).toBe(broken)
  const commented = '---\n# my own comment\nstatus: active\ncustom: keep me\n---\nBody\n'
  await v.write(rel, commented)
  await notes.setProjectMeta(rel, { status: 'done', deadline: '2026-12-01' })
  expect((await v.read(rel)).text).toBe('---\n# my own comment\nstatus: done\ncustom: keep me\ndeadline: 2026-12-01\n---\nBody\n')
})

test('habit changes keep everything else in Habits.md', async () => {
  const habits = new HabitsService(v, ix)
  const file = '# Habits\n\nMy trackers, filled in at night.\n\n- Run\n  - not a habit, a sub-point\n- Read\n\n## Archived habits\n\n- Yoga\n\n## Ideas\n\n- Cold showers\n'
  await v.write('Habits.md', file)
  expect(await habits.list()).toEqual({ active: ['Run', 'Read'], archived: ['Yoga'] })
  await habits.add('Guitar')
  await habits.rename('Read', 'Read 20 min')
  await habits.reorder(['Guitar', 'Run', 'Read 20 min'])
  await habits.archive('Run')
  await habits.unarchive('Yoga')
  expect((await v.read('Habits.md')).text).toBe(
    '# Habits\n\nMy trackers, filled in at night.\n\n- Guitar\n  - not a habit, a sub-point\n- Read 20 min\n- Yoga\n\n## Archived habits\n\n- Run\n\n## Ideas\n\n- Cold showers\n'
  )
})

test('archiving the first habit creates the archived section', async () => {
  const habits = new HabitsService(v, ix)
  await habits.add('Run')
  await habits.add('Read')
  await habits.archive('Run')
  expect((await v.read('Habits.md')).text).toBe('# Habits\n\n- Read\n\n## Archived\n\n- Run\n')
})

test('if the notes folder vanishes mid-session, writes fail and do not recreate it', async () => {
  renameSync(v.root, v.root + '-moved')
  await expect(v.write('Diary/2026/2026-11-11.md', 'x')).rejects.toThrow('notes folder')
  await expect(v.save('Inbox/A.md', 'x', null)).rejects.toThrow('notes folder')
  expect(existsSync(v.root)).toBe(false)
})

test('overlapping changes to one file are applied one after another', async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const diary = new DiaryService(v, ix, () => ({ vaultPath: v.root, rolloverHour: 4, encrypted: false }))
  const runtime: Runtime = {
    vault: v, index: ix, diary, notes,
    tasks: new TasksService(v, ix, () => '2026-11-11'),
    habits: new HabitsService(v, ix)
  }
  registerIpc((channel, fn) => void handlers.set(channel, fn), {
    runtime: () => runtime,
    appState: async () => ({ vaultPath: v.root, vaultUsable: true, rolloverHour: 4, today: '2026-11-11', duplicates: [], encrypted: false, locked: false, unreadable: [] }),
    chooseVault: async () => false,
    setRolloverHour: async () => {},
    flushed: () => {},
    unlock: async () => {},
    lock: async () => {},
    createEncrypted: async () => null,
    changePasscode: async () => {},
    setFocusMode: () => {},
    emitChanged: () => {}
  })
  const add = handlers.get('tasks.add')!
  await Promise.all([add({ title: 'One' }), add({ title: 'Two' }), add({ title: 'Three' })])
  expect(ix.tasks().map((t) => t.title).sort()).toEqual(['One', 'Three', 'Two'])
  await Promise.all([
    handlers.get('habits.add')!('Run'),
    handlers.get('habits.add')!('Read'),
    handlers.get('habits.setTick')!('2026-11-11', 'Run', true),
    handlers.get('habits.setTick')!('2026-11-11', 'Read', true)
  ])
  expect(runtime.habits.history('2026-11-11', '2026-11-11')).toEqual({ '2026-11-11': { Run: true, Read: true } })
  expect((await runtime.habits.list()).active).toEqual(['Run', 'Read'])
})
