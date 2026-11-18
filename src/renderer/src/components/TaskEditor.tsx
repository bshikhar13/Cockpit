import { useState } from 'react'
import { REPEAT_PRESETS } from '../../../core/tasks/repeat'
import type { Priority, TaskItem, TaskPatch } from '../../../core/types'
import { api, errorMessage } from '../api'
import { useContainers } from './containers'
import { handleOf } from './TaskRow'

export function TaskEditor({ task, onClose }: { task: TaskItem; onClose: () => void }): JSX.Element {
  const containers = useContainers()
  const [title, setTitle] = useState(task.title)
  const [due, setDue] = useState(task.due ?? '')
  const [priority, setPriority] = useState<Priority | ''>(task.priority ?? '')
  const [repeat, setRepeat] = useState(task.repeat ?? '')
  const [container, setContainer] = useState(task.container)
  const [error, setError] = useState('')
  const custom = repeat !== '' && !REPEAT_PRESETS.includes(repeat.toLowerCase())
  const [customOpen, setCustomOpen] = useState(custom)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      const patch: TaskPatch = {}
      if (title.trim() !== task.title) patch.title = title.trim()
      if (due !== (task.due ?? '')) patch.due = due || undefined
      if (priority !== (task.priority ?? '')) patch.priority = priority || undefined
      if (repeat.trim() !== (task.repeat ?? '')) patch.repeat = repeat.trim() || undefined
      const handle = handleOf(task)
      if (Object.keys(patch).length) await api.tasks.update(handle, patch)
      if (container !== task.container) await api.tasks.move(handle, container)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const remove = async (): Promise<void> => {
    try {
      await api.tasks.remove(handleOf(task))
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="dialog task-editor" onMouseDown={(e) => e.stopPropagation()} onSubmit={save} data-testid="task-editor">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <label>
          Due
          <span className="row">
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            {due && (
              <button type="button" onClick={() => setDue('')}>
                Clear
              </button>
            )}
          </span>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | '')}>
            <option value="">None</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Repeat
          <span className="row">
            <select
              value={customOpen ? 'custom' : repeat.toLowerCase()}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setCustomOpen(true)
                  setRepeat(repeat || 'every 2 days')
                } else {
                  setCustomOpen(false)
                  setRepeat(e.target.value)
                }
              }}
            >
              <option value="">Never</option>
              {REPEAT_PRESETS.map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {customOpen && <input value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="every 3 days" />}
          </span>
        </label>
        <label>
          In
          <select value={container} onChange={(e) => setContainer(e.target.value)}>
            {containers
              .filter((c) => !c.done || c.rel === task.container)
              .map((c) => (
                <option key={c.rel} value={c.rel}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="danger" onClick={remove} style={{ marginRight: 'auto' }}>
            Delete
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
