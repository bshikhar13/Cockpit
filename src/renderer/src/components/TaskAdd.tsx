import { useState } from 'react'
import { addDays } from '../../../core/day'
import type { Priority } from '../../../core/types'
import { api, errorMessage } from '../api'
import { useNav } from '../nav'
import { useContainers } from './containers'

/** Reads a trailing "today"/"tomorrow" and "!high"/"!medium"/"!low" off the end of what was typed. */
export function parseQuickAdd(input: string, today: string): { title: string; due?: string; priority?: Priority } {
  const words = input.trim().split(/\s+/)
  const out: { title: string; due?: string; priority?: Priority } = { title: '' }
  while (words.length > 1) {
    const last = words[words.length - 1].toLowerCase()
    if (out.due === undefined && (last === 'today' || last === 'tomorrow')) out.due = last === 'today' ? today : addDays(today, 1)
    else if (out.priority === undefined && /^!(high|medium|low)$/.test(last)) out.priority = last.slice(1) as Priority
    else break
    words.pop()
  }
  out.title = words.join(' ')
  return out
}

export function TaskAdd(props: { defaultContainer?: string; defaultDue?: string; pickContainer?: boolean }): JSX.Element {
  const nav = useNav()
  const containers = useContainers()
  const [text, setText] = useState('')
  const [container, setContainer] = useState(props.defaultContainer ?? 'Inbox')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const parsed = parseQuickAdd(text, nav.today)
    if (!parsed.title) return
    try {
      await api.tasks.add({
        title: parsed.title,
        container: props.pickContainer ? container : (props.defaultContainer ?? 'Inbox'),
        due: parsed.due ?? props.defaultDue,
        priority: parsed.priority
      })
      setText('')
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="task-add">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task…" data-testid="task-add" />
        {props.pickContainer && (
          <select value={container} onChange={(e) => setContainer(e.target.value)} title="Project or area">
            {containers.filter((c) => !c.done).map((c) => (
              <option key={c.rel} value={c.rel}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
