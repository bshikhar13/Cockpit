import { useState } from 'react'
import { api, errorMessage } from '../api'
import { HabitGrid } from '../components/HabitGrid'
import { useNav } from '../nav'
import { useVault } from '../useVault'

export function HabitsScreen(): JSX.Element {
  const nav = useNav()
  const habits = useVault(() => api.habits.list())
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [error, setError] = useState('')
  const attempt = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      setError('')
      await fn()
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    }
  }
  const active = habits.data?.active ?? []
  const archived = habits.data?.archived ?? []

  const dropOn = (target: string): void => {
    if (!dragging || dragging === target) return
    const order = active.filter((h) => h !== dragging)
    order.splice(order.indexOf(target), 0, dragging)
    void attempt(() => api.habits.reorder(order))
    setDragging(null)
  }

  return (
    <>
      <header className="page-header">
        <h1>Habits</h1>
      </header>
      <div className="page-body">
        <div className="page-scroll">
          <div className="section-label">Tracking</div>
          <div className="habit-list">
            {active.map((name) => (
              <div
                key={name}
                className={`habit-item ${dragging === name ? 'dragging' : ''}`}
                draggable={editing?.name !== name}
                onDragStart={() => setDragging(name)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(name)}
                data-testid="habit-item"
              >
                <span className="grip">⠿</span>
                {editing?.name === name ? (
                  <form
                    style={{ flex: 1, display: 'flex' }}
                    onSubmit={(e) => {
                      e.preventDefault()
                      void attempt(() => api.habits.rename(name, editing.value)).then((ok) => ok && setEditing(null))
                    }}
                  >
                    <input
                      autoFocus
                      value={editing.value}
                      onChange={(e) => setEditing({ name, value: e.target.value })}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                    />
                  </form>
                ) : (
                  <>
                    <span className="habit-name">{name}</span>
                    <button onClick={() => setEditing({ name, value: name })}>Rename</button>
                    <button onClick={() => void attempt(() => api.habits.archive(name))}>Archive</button>
                  </>
                )}
              </div>
            ))}
            {habits.data && active.length === 0 && <div className="empty">Nothing tracked yet. Add your first habit below.</div>}
          </div>
          <form
            className="task-add"
            style={{ maxWidth: 360 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (adding.trim()) void attempt(() => api.habits.add(adding)).then((ok) => ok && setAdding(''))
            }}
          >
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a habit…" data-testid="habit-add" />
          </form>
          {error && <p className="error">{error}</p>}

          {active.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 28 }}>
                Last twelve weeks
              </div>
              <HabitGrid today={nav.today} />
            </>
          )}

          {archived.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 28 }}>
                Archived
              </div>
              <div className="habit-list">
                {archived.map((name) => (
                  <div key={name} className="habit-item">
                    <span className="habit-name muted">{name}</span>
                    <button onClick={() => void attempt(() => api.habits.unarchive(name))}>Unarchive</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
