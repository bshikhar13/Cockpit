export type Priority = 'high' | 'medium' | 'low'

export interface Task {
  /** null for hand-written lines that have no 🆔 yet */
  id: string | null
  title: string
  done: boolean
  /** YYYY-MM-DD */
  due?: string
  priority?: Priority
  /** rule text after 🔁, e.g. "every weekday" */
  repeat?: string
  /** YYYY-MM-DD after ✅ */
  completed?: string
  /** trailing text that was not understood, preserved verbatim */
  extra?: string
}

import type { Kind } from './para'
import type { ProjectStatus } from './projects'
export type { Kind }

export interface NoteRef {
  rel: string
  name: string
  kind: Kind
  container: string | null
}

export interface TaskItem extends Task {
  file: string
  /** 0-based line in the file */
  line: number
  container: string
  containerName: string
  containerKind: Kind
}

export interface SearchHit {
  rel: string
  name: string
  snippet: string
}

export interface TreeNode {
  rel: string
  name: string
  type: 'folder' | 'note'
  kind: Kind
  children?: TreeNode[]
  meta?: { status?: string; deadline?: string; area?: string }
}

import type { TaskRef } from './tasks/file'
export type { TaskPatch, TaskRef } from './tasks/file'
export type { HabitList } from './habits'

export type TaskView =
  | { view: 'today' }
  /** one day: open tasks due that day (plus overdue ones when it is today), then tasks finished that day */
  | { view: 'day'; date: string }
  | { view: 'upcoming' }
  | { view: 'inbox' }
  | { view: 'container'; container: string }
  | { view: 'all' }

export interface TaskInput {
  title: string
  /** e.g. 'Projects/Launch'; defaults to 'Inbox' */
  container?: string
  due?: string
  priority?: Priority
  repeat?: string
}

export interface TaskHandle {
  file: string
  ref: TaskRef
}

import type { HabitList } from './habits'
import type { TaskPatch } from './tasks/file'

export interface AppState {
  vaultPath: string | null
  vaultUsable: boolean
  rolloverHour: number
  today: string
  /** groups of note paths that share a name */
  duplicates: string[][]
  /** the notes folder is an encrypted one */
  encrypted: boolean
  /** encrypted and waiting for the passcode */
  locked: boolean
  /** notes that exist but could not be read */
  unreadable: string[]
}

export type ContainerKind = 'project' | 'area' | 'resource'
export interface ProjectMeta {
  status?: ProjectStatus
  deadline?: string | null
  area?: string | null
}

/** The one contract between the app's back end and its screens. */
export interface CockpitApi {
  app: {
    state(): Promise<AppState>
    /** native folder dialog; true when a folder was chosen and opened */
    chooseVault(): Promise<boolean>
    setRolloverHour(h: number): Promise<void>
    /** the window tells the back end that every open note has been saved, so it may close */
    flushed(): Promise<void>
    /** opens a locked folder with the passcode or the recovery key; rejects with 'Wrong passcode' */
    unlock(secret: string): Promise<void>
    lock(): Promise<void>
    /**
     * Asks for an empty folder, makes it an encrypted notes folder, optionally copies the current
     * notes into it, and switches to it. Resolves to the recovery key, or null if cancelled.
     */
    createEncrypted(passcode: string, copyCurrent: boolean): Promise<string | null>
    /** `current` may be the passcode or the recovery key */
    changePasscode(current: string, next: string): Promise<void>
    /** hides or shows the window's own buttons, for the distraction-free writing mode */
    setFocusMode(on: boolean): Promise<void>
  }
  notes: {
    tree(): Promise<TreeNode[]>
    all(): Promise<NoteRef[]>
    read(rel: string): Promise<{ text: string; hash: string }>
    save(rel: string, text: string, baseHash: string | null): Promise<{ hash: string; conflictCopy?: string }>
    create(folder: string | null, name: string): Promise<string>
    openOrCreateByName(name: string): Promise<string>
    rename(rel: string, newName: string): Promise<string>
    move(rel: string, toFolder: string): Promise<string>
    remove(rel: string): Promise<void>
    backlinks(name: string): Promise<NoteRef[]>
    search(q: string): Promise<SearchHit[]>
    importAttachment(bytes: Uint8Array, filename: string, forNoteRel: string): Promise<string>
  }
  para: {
    createContainer(kind: ContainerKind, name: string, opts?: { area?: string; deadline?: string }): Promise<string>
    setProjectMeta(rel: string, meta: ProjectMeta): Promise<void>
    archive(containerRel: string): Promise<string>
    unarchive(archivedRel: string): Promise<string>
  }
  diary: { open(date: string): Promise<string> }
  tasks: {
    list(view: TaskView, includeDone?: boolean): Promise<TaskItem[]>
    /** date -> number of open tasks due that day, for dates in the range that have any */
    dueDates(from: string, to: string): Promise<Record<string, number>>
    add(input: TaskInput): Promise<TaskItem>
    update(h: TaskHandle, patch: TaskPatch): Promise<void>
    complete(h: TaskHandle): Promise<void>
    uncomplete(h: TaskHandle): Promise<void>
    move(h: TaskHandle, toContainer: string): Promise<void>
    remove(h: TaskHandle): Promise<void>
  }
  habits: {
    list(): Promise<HabitList>
    add(name: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    reorder(active: string[]): Promise<void>
    archive(name: string): Promise<void>
    unarchive(name: string): Promise<void>
    setTick(date: string, name: string, value: boolean): Promise<void>
    history(from: string, to: string): Promise<Record<string, Record<string, boolean>>>
  }
  on(event: 'vault-changed', cb: (rels: string[]) => void): () => void
  on(event: 'day-changed', cb: (today: string) => void): () => void
  /** the back end asks the window to save everything before it closes */
  on(event: 'flush-request', cb: () => void): () => void
}

export const API_CHANNELS = [
  'app.state', 'app.chooseVault', 'app.setRolloverHour', 'app.flushed',
  'app.unlock', 'app.lock', 'app.createEncrypted', 'app.changePasscode', 'app.setFocusMode',
  'notes.tree', 'notes.all', 'notes.read', 'notes.save', 'notes.create', 'notes.openOrCreateByName',
  'notes.rename', 'notes.move', 'notes.remove', 'notes.backlinks', 'notes.search', 'notes.importAttachment',
  'para.createContainer', 'para.setProjectMeta', 'para.archive', 'para.unarchive',
  'diary.open',
  'tasks.list', 'tasks.dueDates', 'tasks.add', 'tasks.update', 'tasks.complete', 'tasks.uncomplete', 'tasks.move', 'tasks.remove',
  'habits.list', 'habits.add', 'habits.rename', 'habits.reorder', 'habits.archive', 'habits.unarchive',
  'habits.setTick', 'habits.history'
] as const
