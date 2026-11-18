import { API_CHANNELS, type AppState } from '../core/types'
import type { DiaryService } from './services/diary'
import type { HabitsService } from './services/habits'
import type { NotesService } from './services/notes'
import type { TasksService } from './services/tasks'
import type { Vault } from './vault'
import type { VaultIndex } from './vault-index'

/** Everything that exists only while a notes folder is open. */
export interface Runtime {
  vault: Vault
  index: VaultIndex
  notes: NotesService
  tasks: TasksService
  habits: HabitsService
  diary: DiaryService
}

export interface IpcDeps {
  runtime(): Runtime | null
  appState(): Promise<AppState>
  chooseVault(): Promise<boolean>
  setRolloverHour(h: number): Promise<void>
  /** the window has saved everything and may close */
  flushed(): void
  unlock(secret: string): Promise<void>
  lock(): Promise<void>
  createEncrypted(passcode: string, copyCurrent: boolean): Promise<string | null>
  changePasscode(current: string, next: string): Promise<void>
  setFocusMode(on: boolean): void
  /** tells every window that vault data changed */
  emitChanged(): void
}

type Handler = (...args: any[]) => unknown
type Channel = (typeof API_CHANNELS)[number]

export function registerIpc(handle: (channel: string, fn: Handler) => void, deps: IpcDeps): void {
  const rt = (): Runtime => {
    const r = deps.runtime()
    if (!r) throw new Error('No notes folder is open')
    return r
  }
  // Every change to the vault goes through one queue, so two changes to the same file can never
  // interleave their read-modify-write steps.
  let queue: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }
  /** wraps a handler that changes vault data: runs it in turn, then tells the UI to refresh */
  const mutate = (fn: Handler): Handler => (...args) =>
    inTurn(async () => {
      const result = await fn(...args)
      deps.emitChanged()
      return result
    })

  const handlers: Record<Channel, Handler> = {
    'app.state': () => deps.appState(),
    'app.chooseVault': () => inTurn(() => deps.chooseVault()),
    'app.setRolloverHour': (h: number) => deps.setRolloverHour(h),
    'app.flushed': async () => deps.flushed(),
    // locking, unlocking, and switching folders wait for any change in progress to finish first
    'app.unlock': (secret: string) => inTurn(() => deps.unlock(secret)),
    'app.lock': () => inTurn(() => deps.lock()),
    'app.createEncrypted': (passcode: string, copyCurrent: boolean) => inTurn(() => deps.createEncrypted(passcode, copyCurrent)),
    'app.changePasscode': (current: string, next: string) => inTurn(() => deps.changePasscode(current, next)),
    'app.setFocusMode': async (on: boolean) => deps.setFocusMode(on),

    'notes.tree': async () => rt().index.tree(),
    'notes.all': async () => rt().index.notes(),
    // a diary page that has not been written yet reads as a blank page; it becomes a file on first save
    'notes.read': async (rel: string) => rt().diary.read(rel),
    'notes.save': mutate(async (rel: string, text: string, baseHash: string | null) => {
      const r = rt()
      const result = await r.vault.save(rel, text, baseHash)
      r.index.upsert(rel, text)
      if (result.conflictCopy) r.index.upsert(result.conflictCopy, (await r.vault.read(result.conflictCopy)).text)
      return result
    }),
    'notes.create': mutate((folder: string | null, name: string) => rt().notes.create(folder, name)),
    'notes.openOrCreateByName': mutate((name: string) => rt().notes.openOrCreateByName(name)),
    'notes.rename': mutate((rel: string, newName: string) => rt().notes.rename(rel, newName)),
    'notes.move': mutate((rel: string, toFolder: string) => rt().notes.move(rel, toFolder)),
    'notes.remove': mutate((rel: string) => rt().notes.remove(rel)),
    'notes.backlinks': async (name: string) => rt().index.backlinks(name),
    'notes.search': async (q: string) => rt().index.search(q),
    'notes.importAttachment': (bytes: Uint8Array, filename: string, forNoteRel: string) =>
      inTurn(() => rt().notes.importAttachment(bytes, filename, forNoteRel)),

    'para.createContainer': mutate((kind, name, opts) => rt().notes.createContainer(kind, name, opts)),
    'para.setProjectMeta': mutate((rel, meta) => rt().notes.setProjectMeta(rel, meta)),
    'para.archive': mutate((rel: string) => rt().notes.archive(rel)),
    'para.unarchive': mutate((rel: string) => rt().notes.unarchive(rel)),

    'diary.open': (date: string) => inTurn(() => rt().diary.open(date)),

    'tasks.list': async (view, includeDone) => rt().tasks.list(view, includeDone),
    'tasks.dueDates': async (from: string, to: string) => rt().tasks.dueDates(from, to),
    'tasks.add': mutate((input) => rt().tasks.add(input)),
    'tasks.update': mutate((h, patch) => rt().tasks.update(h, patch)),
    'tasks.complete': mutate((h) => rt().tasks.complete(h)),
    'tasks.uncomplete': mutate((h) => rt().tasks.uncomplete(h)),
    'tasks.move': mutate((h, to: string) => rt().tasks.move(h, to)),
    'tasks.remove': mutate((h) => rt().tasks.remove(h)),

    'habits.list': async () => rt().habits.list(),
    'habits.add': mutate((name: string) => rt().habits.add(name)),
    'habits.rename': mutate((from: string, to: string) => rt().habits.rename(from, to)),
    'habits.reorder': mutate((active: string[]) => rt().habits.reorder(active)),
    'habits.archive': mutate((name: string) => rt().habits.archive(name)),
    'habits.unarchive': mutate((name: string) => rt().habits.unarchive(name)),
    'habits.setTick': mutate((date: string, name: string, value: boolean) => rt().habits.setTick(date, name, value)),
    'habits.history': async (from: string, to: string) => rt().habits.history(from, to)
  }

  for (const channel of API_CHANNELS) handle(channel, handlers[channel])
}
