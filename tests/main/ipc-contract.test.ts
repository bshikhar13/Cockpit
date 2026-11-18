import { expect, test } from 'vitest'
import { API_CHANNELS } from '../../src/core/types'
import { registerIpc, type Runtime } from '../../src/main/ipc'
import { DiaryService } from '../../src/main/services/diary'
import { HabitsService } from '../../src/main/services/habits'
import { NotesService } from '../../src/main/services/notes'
import { TasksService } from '../../src/main/services/tasks'
import { tempVault } from './helpers'

async function setup(withVault = true) {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  let changed = 0
  let runtime: Runtime | null = null
  if (withVault) {
    const { v, ix } = await tempVault()
    const settings = () => ({ vaultPath: v.root, rolloverHour: 4, encrypted: false })
    const diary = new DiaryService(v, ix, settings, () => new Date(2026, 10, 11, 12))
    runtime = {
      vault: v, index: ix, diary,
      notes: new NotesService(v, ix),
      tasks: new TasksService(v, ix, () => diary.today()),
      habits: new HabitsService(v, ix)
    }
  }
  registerIpc((channel, fn) => void handlers.set(channel, fn), {
    runtime: () => runtime,
    appState: async () => ({ vaultPath: null, vaultUsable: false, rolloverHour: 4, today: '2026-11-11', duplicates: [], encrypted: false, locked: false, unreadable: [] }),
    chooseVault: async () => false,
    setRolloverHour: async () => {},
    flushed: () => {},
    unlock: async () => {},
    lock: async () => {},
    createEncrypted: async () => null,
    changePasscode: async () => {},
    setFocusMode: () => {},
    emitChanged: () => void changed++
  })
  return { handlers, changed: () => changed }
}

test('every channel in the contract has a handler, and nothing extra', async () => {
  const { handlers } = await setup()
  expect([...handlers.keys()].sort()).toEqual([...API_CHANNELS].sort())
})

test('handlers reach the services, and mutations announce a change', async () => {
  const { handlers, changed } = await setup()
  const item: any = await handlers.get('tasks.add')!({ title: 'Via IPC', due: '2026-11-11' })
  expect(item.title).toBe('Via IPC')
  expect(changed()).toBe(1)
  const today: any = await handlers.get('tasks.list')!({ view: 'today' })
  expect(today.map((t: any) => t.title)).toEqual(['Via IPC'])
  expect(changed()).toBe(1)
  expect(await handlers.get('diary.open')!('2026-11-11')).toBe('Diary/2026/2026-11-11.md')
})

test('without a notes folder, data channels fail clearly and app.state still works', async () => {
  const { handlers } = await setup(false)
  await expect(handlers.get('notes.tree')!()).rejects.toThrow('No notes folder is open')
  expect(await handlers.get('app.state')!()).toMatchObject({ vaultUsable: false })
})
