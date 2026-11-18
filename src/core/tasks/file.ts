import type { Task } from '../types'
import { formatTaskLine, newTaskId, parseTaskLine } from './line'
import { nextOccurrence, parseRepeat } from './repeat'

/** line is 0-based */
export type TaskRef = { id: string } | { line: number }
export interface TaskAt {
  task: Task
  line: number
}
/** a key present with value undefined clears that field */
export type TaskPatch = Partial<Pick<Task, 'title' | 'due' | 'priority' | 'repeat'>>

interface Doc {
  lines: string[]
  eol: string
}

function open(text: string): Doc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { lines: text.split(eol), eol }
}

function close(doc: Doc): string {
  return doc.lines.join(doc.eol)
}

function locate(doc: Doc, ref: TaskRef): TaskAt {
  if ('id' in ref) {
    for (let i = 0; i < doc.lines.length; i++) {
      const task = parseTaskLine(doc.lines[i])
      if (task && task.id === ref.id) return { task, line: i }
    }
  } else {
    const task = ref.line >= 0 && ref.line < doc.lines.length ? parseTaskLine(doc.lines[ref.line]) : null
    if (task) return { task, line: ref.line }
  }
  throw new Error('task not found')
}

function withId(task: Task): Task {
  return task.id ? task : { ...task, id: newTaskId() }
}

function insertLine(doc: Doc, line: string): void {
  let last = -1
  doc.lines.forEach((l, i) => {
    if (parseTaskLine(l)) last = i
  })
  if (last >= 0) {
    doc.lines.splice(last + 1, 0, line)
    return
  }
  // no tasks yet: append at the end, keeping exactly one trailing newline
  if (doc.lines[doc.lines.length - 1] === '') doc.lines.splice(doc.lines.length - 1, 0, line)
  else doc.lines.push(line, '')
}

export function listTasks(text: string): TaskAt[] {
  const out: TaskAt[] = []
  open(text).lines.forEach((l, line) => {
    const task = parseTaskLine(l)
    if (task) out.push({ task, line })
  })
  return out
}

export function addTask(text: string, input: Omit<Task, 'id' | 'done'>): { text: string; task: Task } {
  const task: Task = { ...input, id: newTaskId(), done: false }
  const doc = open(text)
  insertLine(doc, formatTaskLine(task))
  return { text: close(doc), task }
}

export function insertTask(text: string, task: Task): string {
  const doc = open(text)
  insertLine(doc, formatTaskLine(withId(task)))
  return close(doc)
}

export function updateTask(text: string, ref: TaskRef, patch: TaskPatch): string {
  const doc = open(text)
  const at = locate(doc, ref)
  const task: Task = withId({ ...at.task })
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    const value = patch[key]
    if (value === undefined || value === '') {
      if (key !== 'title') delete task[key]
    } else (task as unknown as Record<string, unknown>)[key] = value
  }
  doc.lines[at.line] = formatTaskLine(task)
  return close(doc)
}

export function completeTask(text: string, ref: TaskRef, today: string): string {
  const doc = open(text)
  const at = locate(doc, ref)
  if (at.task.done) return text
  const task = withId({ ...at.task, done: true, completed: today })
  doc.lines[at.line] = formatTaskLine(task)
  const rule = task.repeat ? parseRepeat(task.repeat) : null
  if (rule) {
    const next: Task = {
      ...at.task,
      id: newTaskId(),
      done: false,
      due: nextOccurrence(rule, at.task.due ?? today, today)
    }
    delete next.completed
    doc.lines.splice(at.line + 1, 0, formatTaskLine(next))
  }
  return close(doc)
}

export function uncompleteTask(text: string, ref: TaskRef): string {
  const doc = open(text)
  const at = locate(doc, ref)
  const task = withId({ ...at.task, done: false })
  delete task.completed
  doc.lines[at.line] = formatTaskLine(task)
  return close(doc)
}

export function removeTask(text: string, ref: TaskRef): { text: string; removed: Task } {
  const doc = open(text)
  const at = locate(doc, ref)
  doc.lines.splice(at.line, 1)
  return { text: close(doc), removed: at.task }
}
