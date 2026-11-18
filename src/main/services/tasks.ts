import { addDays } from '../../core/day'
import {
  addTask, completeTask, insertTask, removeTask, uncompleteTask, updateTask, type TaskPatch
} from '../../core/tasks/file'
import { parseRepeat } from '../../core/tasks/repeat'
import type { Priority, TaskHandle, TaskInput, TaskItem, TaskView } from '../../core/types'
import type { Vault } from '../vault'
import type { VaultIndex } from '../vault-index'

const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
const rank = (t: TaskItem): number => (t.priority ? RANK[t.priority] : 3)

export class TasksService {
  constructor(
    private vault: Vault,
    private index: VaultIndex,
    private today: () => string
  ) {}

  private async readFile(file: string): Promise<string> {
    return (await this.vault.exists(file)) ? (await this.vault.read(file)).text : ''
  }

  private async writeFile(file: string, text: string): Promise<void> {
    await this.vault.write(file, text)
    this.index.upsert(file, text)
  }

  private checkRepeat(repeat: string | undefined): void {
    if (repeat && !parseRepeat(repeat)) throw new Error('Unknown repeat rule')
  }

  list(view: TaskView, includeDone = false): TaskItem[] {
    const today = this.today()
    if (view.view === 'day') return this.day(view.date)
    let items = this.index.tasks().filter((t) => includeDone || !t.done)
    if (view.view === 'today') {
      items = items.filter((t) => t.due !== undefined && t.due <= today)
      items.sort((a, b) => {
        const overdueA = a.due! < today
        const overdueB = b.due! < today
        if (overdueA !== overdueB) return overdueA ? -1 : 1
        if (overdueA && a.due !== b.due) return a.due! < b.due! ? -1 : 1
        return rank(a) - rank(b) || a.title.localeCompare(b.title)
      })
    } else if (view.view === 'upcoming') {
      const until = addDays(today, 7)
      items = items.filter((t) => t.due !== undefined && t.due > today && t.due <= until)
      items.sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : rank(a) - rank(b) || a.title.localeCompare(b.title)))
    } else if (view.view === 'inbox') {
      items = items.filter((t) => t.container === 'Inbox')
    } else if (view.view === 'container') {
      items = items.filter((t) => t.container === view.container)
    }
    return items
  }

  /** What belongs to one day: open tasks due then (and, for today, anything overdue), followed by tasks finished that day. */
  private day(date: string): TaskItem[] {
    const today = this.today()
    const all = this.index.tasks()
    const open = all.filter((t) => !t.done && t.due !== undefined && (t.due === date || (date === today && t.due < today)))
    open.sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : rank(a) - rank(b) || a.title.localeCompare(b.title)))
    const finished = all.filter((t) => t.done && t.completed === date).sort((a, b) => a.title.localeCompare(b.title))
    return [...open, ...finished]
  }

  /** date -> number of open tasks due that day, for the days in the range that have any */
  dueDates(from: string, to: string): Record<string, number> {
    const out: Record<string, number> = {}
    for (const t of this.index.tasks()) {
      if (!t.done && t.due !== undefined && t.due >= from && t.due <= to) out[t.due] = (out[t.due] ?? 0) + 1
    }
    return out
  }

  async add(input: TaskInput): Promise<TaskItem> {
    const title = input.title.trim()
    if (!title) throw new Error('A task needs a title')
    this.checkRepeat(input.repeat)
    const container = input.container ?? 'Inbox'
    const file = `${container}/Tasks.md`
    const due = input.due ?? (input.repeat ? this.today() : undefined)
    const { text, task } = addTask(await this.readFile(file), {
      title,
      ...(due ? { due } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.repeat ? { repeat: input.repeat } : {})
    })
    await this.writeFile(file, text)
    return this.index.tasks().find((t) => t.file === file && t.id === task.id)!
  }

  async update(h: TaskHandle, patch: TaskPatch): Promise<void> {
    const p: TaskPatch = { ...patch }
    if (p.title !== undefined && !p.title.trim()) throw new Error('A task needs a title')
    if (p.repeat) {
      this.checkRepeat(p.repeat)
      const current = this.index.tasks().find((t) => t.file === h.file && ('id' in h.ref ? t.id === h.ref.id : t.line === h.ref.line))
      const dueAfter = 'due' in p ? p.due : current?.due
      if (!dueAfter) p.due = this.today()
    }
    await this.writeFile(h.file, updateTask(await this.readFile(h.file), h.ref, p))
  }

  async complete(h: TaskHandle): Promise<void> {
    await this.writeFile(h.file, completeTask(await this.readFile(h.file), h.ref, this.today()))
  }

  async uncomplete(h: TaskHandle): Promise<void> {
    await this.writeFile(h.file, uncompleteTask(await this.readFile(h.file), h.ref))
  }

  async move(h: TaskHandle, toContainer: string): Promise<void> {
    const target = `${toContainer}/Tasks.md`
    if (target === h.file) return
    const { text, removed } = removeTask(await this.readFile(h.file), h.ref)
    await this.writeFile(target, insertTask(await this.readFile(target), removed))
    await this.writeFile(h.file, text)
  }

  async remove(h: TaskHandle): Promise<void> {
    await this.writeFile(h.file, removeTask(await this.readFile(h.file), h.ref).text)
  }
}
