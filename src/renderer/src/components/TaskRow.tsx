import { daysBetween } from '../../../core/day'
import type { TaskHandle, TaskItem } from '../../../core/types'
import { api } from '../api'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function dueLabel(due: string | undefined, today: string): string {
  if (!due) return ''
  const diff = daysBetween(today, due)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${-diff} days overdue`
  const [y, m, d] = due.split('-').map(Number)
  return `${d} ${MONTHS[m - 1].slice(0, 3)}${y === Number(today.slice(0, 4)) ? '' : ` ${y}`}`
}

export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS[m - 1]}`
}

export function handleOf(task: TaskItem): TaskHandle {
  return { file: task.file, ref: task.id ? { id: task.id } : { line: task.line } }
}

const PRIORITY_MARK = { high: '!!!', medium: '!!', low: '!' } as const

export function TaskRow(props: { task: TaskItem; today: string; showContainer?: boolean; onOpen?: () => void }): JSX.Element {
  const { task, today } = props
  const overdue = !task.done && task.due !== undefined && task.due < today
  const toggle = (): void => void (task.done ? api.tasks.uncomplete(handleOf(task)) : api.tasks.complete(handleOf(task)))
  return (
    <div className={`task-row ${task.done ? 'done' : ''} ${props.onOpen ? 'clickable' : ''}`} data-testid="task-row">
      <input type="checkbox" checked={task.done} onChange={toggle} aria-label={`Complete ${task.title}`} />
      <div className="task-main" onClick={props.onOpen}>
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {task.priority && <span className={`prio ${task.priority}`} title={`${task.priority} priority`}>{PRIORITY_MARK[task.priority]}</span>}
          {task.due && <span className={`due ${overdue ? 'overdue' : ''}`}>{dueLabel(task.due, today)}</span>}
          {task.repeat && <span title={task.repeat}>↻ {task.repeat.replace(/^every /i, '')}</span>}
          {props.showContainer && <span className="tag">{task.containerName}</span>}
          {task.id === null && <span title="Written by hand in the file">✎</span>}
        </div>
      </div>
    </div>
  )
}
