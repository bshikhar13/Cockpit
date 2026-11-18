import { useState } from 'react'
import { classify } from '../../../core/para'
import { daysLeft, PROJECT_STATUSES, projectStatus, type ProjectStatus } from '../../../core/projects'
import type { TreeNode } from '../../../core/types'
import { api, errorMessage } from '../api'
import { Backlinks } from '../components/Backlinks'
import { TaskAdd } from '../components/TaskAdd'
import { TaskEditor } from '../components/TaskEditor'
import { TaskRow } from '../components/TaskRow'
import type { TaskItem } from '../../../core/types'
import { Editor } from '../editor/Editor'
import { useNav } from '../nav'
import { NameDialog } from '../shell/NameDialog'
import { useVault } from '../useVault'

function findNode(nodes: TreeNode[], rel: string): TreeNode | null {
  for (const n of nodes) {
    if (n.rel === rel) return n
    const inner = n.children ? findNode(n.children, rel) : null
    if (inner) return inner
  }
  return null
}

/** Folders a loose note can be moved into: Inbox and every project, area, and resource topic. */
function destinations(tree: TreeNode[]): { label: string; items: TreeNode[] }[] {
  const groups: { label: string; items: TreeNode[] }[] = []
  for (const top of tree) {
    if (top.rel === 'Inbox') groups.push({ label: '', items: [top] })
    else if (top.rel !== 'Archive') {
      const folders = (top.children ?? []).filter((c) => c.type === 'folder')
      if (folders.length) groups.push({ label: top.name, items: folders })
    }
  }
  return groups
}

export function NotePage({ rel }: { rel: string }): JSX.Element {
  const nav = useNav()
  const info = classify(rel)
  const isHome = info.isHomeNote && info.container !== null
  const archived = info.kind === 'archive'
  const hasTasks = isHome && (info.kind === 'project' || info.kind === 'area')
  const tree = useVault(() => api.notes.tree())
  const tasks = useVault(
    () => (hasTasks ? api.tasks.list({ view: 'container', container: info.container! }) : Promise.resolve([])),
    [rel]
  )
  const [renaming, setRenaming] = useState(false)
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState<TaskItem | null>(null)
  const [error, setError] = useState('')

  const folder = isHome && tree.data ? findNode(tree.data, info.container!) : null
  const siblings = (folder?.children ?? []).filter((c) => c.type === 'note' && c.rel !== rel)
  const status = projectStatus(folder?.meta?.status)
  const left = status === 'done' ? null : daysLeft(folder?.meta?.deadline, nav.today)
  const areas = tree.data?.find((n) => n.rel === 'Areas')?.children?.filter((c) => c.type === 'folder') ?? []
  const attempt = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      setError('')
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <>
      <header className="page-header">
        <h1 data-testid="note-title">{info.name}</h1>
        <button onClick={() => nav.setFocus(true)} title="Write with nothing else on screen (⌘⇧F)" data-testid="focus-button">
          Focus
        </button>
        {!archived && <button onClick={() => setRenaming(true)}>Rename</button>}
        {!isHome && (
          <span className="menu-wrap">
            <button onClick={() => setMoving((m) => !m)}>Move to…</button>
            {moving && tree.data && (
              <div className="menu" onMouseLeave={() => setMoving(false)}>
                {destinations(tree.data).map((group) => (
                  <div key={group.label} style={{ display: 'contents' }}>
                    {group.label && <div className="menu-label">{group.label}</div>}
                    {group.items.map((dest) => (
                      <button
                        key={dest.rel}
                        disabled={dest.rel === info.container}
                        onClick={() => {
                          setMoving(false)
                          void attempt(async () => nav.openNote(await api.notes.move(rel, dest.rel)))
                        }}
                      >
                        {dest.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </span>
        )}
        {isHome ? (
          <button
            onClick={() =>
              void attempt(async () => {
                const moved = archived ? await api.para.unarchive(info.container!) : await api.para.archive(info.container!)
                nav.openNote(`${moved}/${info.name}.md`)
              })
            }
          >
            {archived ? 'Unarchive' : 'Archive'}
          </button>
        ) : (
          <button
            className="danger"
            onClick={() => {
              if (!window.confirm(`Move "${info.name}" to the Trash?`)) return
              void attempt(async () => {
                await api.notes.remove(rel)
                nav.navigate({ screen: 'today' })
              })
            }}
          >
            Delete
          </button>
        )}
      </header>
      <div className="page-body">
        <div className="page-scroll">
          <div className="column">
            {error && <div className="banner error">{error}</div>}
            {isHome && info.kind === 'project' && (
              <div className="meta-row" data-testid="project-meta">
                <label>
                  Status
                  <select
                    value={status}
                    onChange={(e) => void attempt(() => api.para.setProjectMeta(rel, { status: e.target.value as ProjectStatus }))}
                    data-testid="project-status"
                  >
                    {PROJECT_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Deadline
                  <input
                    type="date"
                    value={folder?.meta?.deadline ?? ''}
                    onChange={(e) => void attempt(() => api.para.setProjectMeta(rel, { deadline: e.target.value || null }))}
                  />
                </label>
                {left && (
                  <span className={`days-left ${left.tone}`} data-testid="days-left">
                    {left.label}
                  </span>
                )}
                <label>
                  Area
                  <select
                    value={folder?.meta?.area ?? ''}
                    onChange={(e) => void attempt(() => api.para.setProjectMeta(rel, { area: e.target.value || null }))}
                  >
                    <option value="">None</option>
                    {areas.map((a) => (
                      <option key={a.rel} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                    {folder?.meta?.area && !areas.some((a) => a.name === folder.meta!.area) && (
                      <option value={folder.meta.area}>{folder.meta.area}</option>
                    )}
                  </select>
                </label>
              </div>
            )}
            <Editor key={rel} rel={rel} autoFocus />
            {info.kind !== 'diary' && <Backlinks name={info.name} />}
          </div>
        </div>
        {isHome && (
          <aside className="rail">
            {hasTasks && (
              <>
                <h4>Tasks</h4>
                {tasks.data?.length === 0 && <div className="empty">No open tasks.</div>}
                {tasks.data?.map((t) => (
                  <TaskRow key={`${t.file}:${t.id ?? t.line}`} task={t} today={nav.today} onOpen={() => setEditing(t)} />
                ))}
                <TaskAdd defaultContainer={info.container!} />
              </>
            )}
            <h4>Notes</h4>
            {siblings.length === 0 && <div className="empty">No other notes here yet.</div>}
            {siblings.map((n) => (
              <a key={n.rel} className="note-link" onClick={() => nav.openNote(n.rel)}>
                {n.name}
              </a>
            ))}
          </aside>
        )}
      </div>
      {renaming && (
        <NameDialog
          title={`Rename "${info.name}"`}
          initial={info.name}
          submitLabel="Rename"
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => nav.openNote(await api.notes.rename(rel, name))}
        />
      )}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
