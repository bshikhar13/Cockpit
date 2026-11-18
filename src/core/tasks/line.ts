import { isDate } from '../day'
import type { Priority, Task } from '../types'

const DUE = '📅'
const DONE = '✅'
const REPEAT = '🔁'
const ID = '🆔'
const PRIORITY: Record<string, Priority> = { '⏫': 'high', '🔼': 'medium', '🔽': 'low' }
const PRIORITY_EMOJI: Record<Priority, string> = { high: '⏫', medium: '🔼', low: '🔽' }

const LINE = /^\s*[-*+] \[( |x|X)\] (.*)$/
const MARK = /(📅|✅|🔁|🆔|⏫|🔼|🔽)️?/gu

export function parseTaskLine(line: string): Task | null {
  const m = LINE.exec(line.replace(/\r$/, ''))
  if (!m) return null
  const rest = m[2]
  const marks = [...rest.matchAll(MARK)]
  const title = (marks.length ? rest.slice(0, marks[0].index) : rest).trim()
  if (!title) return null

  const task: Task = { id: null, title, done: m[1] !== ' ' }
  const extra: string[] = []
  marks.forEach((mark, i) => {
    const emoji = mark[1]
    const end = i + 1 < marks.length ? marks[i + 1].index : rest.length
    const value = rest.slice(mark.index! + mark[0].length, end).trim()
    const keep = (): void => void extra.push(value ? `${emoji} ${value}` : emoji)
    if (emoji === DUE) {
      if (isDate(value) && task.due === undefined) task.due = value
      else keep()
    } else if (emoji === DONE) {
      if (isDate(value) && task.completed === undefined) task.completed = value
      else keep()
    } else if (emoji === REPEAT) {
      if (value && task.repeat === undefined) task.repeat = value
      else keep()
    } else if (emoji === ID) {
      if (/^[A-Za-z0-9]+$/.test(value) && task.id === null) task.id = value
      else keep()
    } else if (task.priority === undefined) {
      task.priority = PRIORITY[emoji]
      if (value) extra.push(value)
    } else keep()
  })
  if (extra.length) task.extra = extra.join(' ')
  return task
}

export function formatTaskLine(task: Task): string {
  const parts = [`- [${task.done ? 'x' : ' '}] ${task.title}`]
  if (task.repeat) parts.push(`${REPEAT} ${task.repeat}`)
  if (task.due) parts.push(`${DUE} ${task.due}`)
  if (task.priority) parts.push(PRIORITY_EMOJI[task.priority])
  if (task.completed) parts.push(`${DONE} ${task.completed}`)
  if (task.extra) parts.push(task.extra)
  if (task.id) parts.push(`${ID} ${task.id}`)
  return parts.join(' ')
}

export function newTaskId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}
