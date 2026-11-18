import { useState } from 'react'
import type { TaskItem, TaskView } from '../../../core/types'
import { api } from '../api'
import { useContainers } from '../components/containers'
import { TaskAdd } from '../components/TaskAdd'
import { TaskEditor } from '../components/TaskEditor'
import { TaskRow } from '../components/TaskRow'
import { useNav } from '../nav'
import { useVault } from '../useVault'

type Tab = 'today' | 'upcoming' | 'inbox' | 'grouped'
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'grouped', label: 'By project or area' }
]
const EMPTY: Record<Tab, string> = {
  today: 'Nothing due today.',
  upcoming: 'Nothing due in the next seven days.',
  inbox: 'Inbox is empty.',
  grouped: ''
}
const keyOf = (t: TaskItem): string => `${t.file}:${t.id ?? t.line}`

export function TasksScreen({ initialTab }: { initialTab?: Tab }): JSX.Element {
  const nav = useNav()
  const containers = useContainers()
  const [tab, setTab] = useState<Tab>(initialTab ?? 'today')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<TaskItem | null>(null)
  const view: TaskView = tab === 'grouped' ? { view: 'all' } : { view: tab }
  const tasks = useVault(() => api.tasks.list(view, showDone), [tab, showDone])
  const items = tasks.data ?? []
  const row = (t: TaskItem, showContainer: boolean): JSX.Element => (
    <TaskRow key={keyOf(t)} task={t} today={nav.today} showContainer={showContainer} onOpen={() => setEditing(t)} />
  )

  return (
    <>
      <header className="page-header">
        <h1>Tasks</h1>
      </header>
      <div className="page-body">
        <div className="page-scroll">
          <div className="column">
            <div className="tabs">
              {TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
                  {t.label}
                </button>
              ))}
              <span className="spacer" />
              <label>
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
              </label>
            </div>

            {tab !== 'grouped' && (
              <>
                <TaskAdd
                  key={tab}
                  defaultDue={tab === 'today' ? nav.today : undefined}
                  defaultContainer="Inbox"
                  pickContainer={tab !== 'inbox'}
                />
                <div style={{ marginTop: 10 }}>
                  {items.map((t) => row(t, tab !== 'inbox'))}
                  {tasks.data && items.length === 0 && <div className="empty">{EMPTY[tab]}</div>}
                </div>
              </>
            )}

            {tab === 'grouped' &&
              containers
                .filter((c) => !c.done || items.some((t) => t.container === c.rel))
                .map((c) => {
                  const mine = items.filter((t) => t.container === c.rel)
                  return (
                    <div key={c.rel} className="group">
                      <h3 onClick={() => c.kind !== 'inbox' && nav.openNote(`${c.rel}/${c.name}.md`)}>
                        {c.name}
                        <small>
                          {c.kind} · {mine.filter((t) => !t.done).length} open
                        </small>
                      </h3>
                      {mine.map((t) => row(t, false))}
                      <TaskAdd defaultContainer={c.rel} />
                    </div>
                  )
                })}
          </div>
        </div>
      </div>
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
