import { useEffect, useState } from 'react'
import { classify } from '../../../core/para'
import { projectStatus } from '../../../core/projects'
import type { AppState, ContainerKind, TreeNode } from '../../../core/types'
import { api, errorMessage } from '../api'
import { useNav } from '../nav'
import { useVault } from '../useVault'
import { ChangePasscodeDialog } from './EncryptDialog'
import { NameDialog } from './NameDialog'

type Dialog =
  | { type: 'container'; kind: ContainerKind }
  | { type: 'note'; folder: string | null }
  | { type: 'rename'; rel: string; name: string }
interface Menu {
  x: number
  y: number
  items: { label: string; run: () => void }[]
}

const KIND_LABEL: Record<ContainerKind, string> = { project: 'project', area: 'area', resource: 'resource topic' }
const ADDABLE: Record<string, ContainerKind> = { Projects: 'project', Areas: 'area', Resources: 'resource' }
const DRAG = 'application/x-cockpit-note'

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('expanded') ?? '["Inbox","Projects","Areas"]'))
  } catch {
    return new Set(['Inbox', 'Projects', 'Areas'])
  }
}

export function Sidebar({
  state,
  onStateChange,
  onEncrypt
}: {
  state: AppState
  onStateChange(): void
  onEncrypt(): void
}): JSX.Element {
  const nav = useNav()
  const tree = useVault(() => api.notes.tree())
  const inboxTasks = useVault(() => api.tasks.list({ view: 'inbox' }))
  const [expanded, setExpanded] = useState(loadExpanded)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [changingPasscode, setChangingPasscode] = useState(false)

  useEffect(() => {
    // which folders are open is remembered between launches, but not for an encrypted folder:
    // that would leave its folder names readable in the app's own data
    if (state.encrypted) localStorage.removeItem('expanded')
    else localStorage.setItem('expanded', JSON.stringify([...expanded]))
  }, [expanded, state.encrypted])
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const toggle = (rel: string): void =>
    setExpanded((old) => {
      const next = new Set(old)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  const attempt = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      setNotice('')
      await fn()
    } catch (e) {
      setNotice(errorMessage(e))
    }
  }

  const currentRel = nav.route.screen === 'note' ? nav.route.rel : null
  const currentFolder = currentRel ? classify(currentRel).container : null

  const noteMenu = (node: TreeNode, e: React.MouseEvent): void => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename', run: () => setDialog({ type: 'rename', rel: node.rel, name: node.name }) },
        {
          label: 'Delete',
          run: () => {
            if (!window.confirm(`Move "${node.name}" to the Trash?`)) return
            void attempt(async () => {
              await api.notes.remove(node.rel)
              if (currentRel === node.rel) nav.navigate({ screen: 'today' })
            })
          }
        }
      ]
    })
  }
  const containerMenu = (node: TreeNode, e: React.MouseEvent): void => {
    e.preventDefault()
    const archived = node.kind === 'archive'
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(archived
          ? []
          : [{ label: 'Rename', run: () => setDialog({ type: 'rename', rel: `${node.rel}/${node.name}.md`, name: node.name }) }]),
        {
          label: archived ? 'Unarchive' : 'Archive',
          run: () =>
            void attempt(async () => {
              const moved = archived ? await api.para.unarchive(node.rel) : await api.para.archive(node.rel)
              if (currentRel?.startsWith(node.rel + '/')) nav.openNote(`${moved}/${node.name}.md`)
            })
        }
      ]
    })
  }

  const dropProps = (folderRel: string, allowed: boolean) =>
    allowed
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (e.dataTransfer.types.includes(DRAG)) e.preventDefault()
          },
          onDrop: (e: React.DragEvent) => {
            const rel = e.dataTransfer.getData(DRAG)
            if (!rel) return
            e.preventDefault()
            void attempt(async () => {
              const moved = await api.notes.move(rel, folderRel)
              if (currentRel === rel) nav.openNote(moved)
            })
          }
        }
      : {}

  const renderNode = (node: TreeNode, depth: number, parent: TreeNode | null): JSX.Element | null => {
    if (node.type === 'note') {
      if (parent && parent.name === node.name && depth >= 2) return null // home note: opened by clicking its folder
      return (
        <div
          key={node.rel}
          className={`tree-row note ${currentRel === node.rel ? 'active' : ''}`}
          style={{ paddingLeft: 12 + depth * 14 }}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(DRAG, node.rel)}
          onClick={() => nav.openNote(node.rel)}
          onContextMenu={(e) => noteMenu(node, e)}
          title={node.name}
        >
          <span className="tree-name">{node.name}</span>
        </div>
      )
    }
    const isTop = depth === 0
    const isContainer = depth === 1 && node.kind !== 'inbox'
    const open = expanded.has(node.rel)
    const home = `${node.rel}/${node.name}.md`
    const children = (node.children ?? []).map((c) => renderNode(c, depth + 1, node)).filter(Boolean)
    const badge = node.rel === 'Inbox' ? (node.children?.length ?? 0) + (inboxTasks.data?.length ?? 0) : 0
    return (
      <div key={node.rel}>
        <div
          className={`tree-row folder ${isTop ? 'top' : ''} ${currentRel === home ? 'active' : ''} ${
            isContainer && node.kind === 'project' ? `status-${projectStatus(node.meta?.status)}` : ''
          }`}
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => {
            if (isContainer) {
              nav.openNote(home)
              if (!open) toggle(node.rel)
            } else toggle(node.rel)
          }}
          onContextMenu={isContainer ? (e) => containerMenu(node, e) : undefined}
          data-testid={`tree-${node.rel}`}
          {...dropProps(node.rel, node.kind !== 'archive' && (isContainer || node.rel === 'Inbox' || depth > 1))}
        >
          <span
            className={`chevron ${open ? 'open' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.rel)
            }}
          >
            ›
          </span>
          <span className="tree-name">{node.name}</span>
          {badge > 0 && <span className="badge">{badge}</span>}
          {isTop && ADDABLE[node.name] && (
            <button
              className="tree-add"
              title={`New ${KIND_LABEL[ADDABLE[node.name]]}`}
              data-testid={`add-${ADDABLE[node.name]}`}
              onClick={(e) => {
                e.stopPropagation()
                setDialog({ type: 'container', kind: ADDABLE[node.name] })
              }}
            >
              +
            </button>
          )}
        </div>
        {open && node.rel === 'Inbox' && (inboxTasks.data?.length ?? 0) > 0 && (
          // tasks with no project or area live in Inbox too; they are listed on the Tasks screen
          <div
            className={`tree-row note inbox-tasks ${nav.route.screen === 'tasks' && nav.route.tab === 'inbox' ? 'active' : ''}`}
            style={{ paddingLeft: 26 }}
            onClick={() => nav.navigate({ screen: 'tasks', tab: 'inbox' })}
            data-testid="inbox-tasks"
          >
            <span className="tree-name">
              {inboxTasks.data!.length} task{inboxTasks.data!.length > 1 ? 's' : ''}
            </span>
            <span className="tree-hint">☐</span>
          </div>
        )}
        {open && children}
        {open && isTop && children.length === 0 && !(node.rel === 'Inbox' && (inboxTasks.data?.length ?? 0) > 0) && (
          <div className="tree-empty" style={{ paddingLeft: 26 }}>
            Empty
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="drag-region" />
      <button className="search-button" onClick={nav.openPalette} data-testid="open-search">
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      <nav className="main-nav">
        {(['today', 'tasks', 'habits'] as const).map((screen) => (
          <button
            key={screen}
            className={nav.route.screen === screen ? 'active' : ''}
            onClick={() => nav.navigate({ screen })}
            data-testid={`nav-${screen}`}
          >
            <span>{screen[0].toUpperCase() + screen.slice(1)}</span>
            <kbd>⌘{({ today: 1, tasks: 2, habits: 3 } as const)[screen]}</kbd>
          </button>
        ))}
      </nav>
      <div className="tree">{tree.data?.map((n) => renderNode(n, 0, null))}</div>
      {notice && (
        <div className="sidebar-notice error" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}
      {state.unreadable.length > 0 && (
        <div className="sidebar-notice error" title={state.unreadable.join('\n')} data-testid="unreadable-notice">
          {state.unreadable.length} note{state.unreadable.length > 1 ? 's' : ''} could not be opened (damaged or not downloaded):{' '}
          {state.unreadable.map((rel) => classify(rel).name).join(', ')}
        </div>
      )}
      {state.duplicates.length > 0 && (
        <div className="sidebar-notice" title={state.duplicates.map((g) => g.join('\n')).join('\n\n')}>
          {state.duplicates.length} note name{state.duplicates.length > 1 ? 's are' : ' is'} used twice:{' '}
          {state.duplicates.map((g) => classify(g[0]).name).join(', ')}
        </div>
      )}
      <div className="sidebar-footer">
        <button onClick={() => setDialog({ type: 'note', folder: currentFolder })} data-testid="new-note">
          + New note
        </button>
        <button className="gear" title="Settings" onClick={() => setSettingsOpen((o) => !o)} data-testid="settings">
          ⚙
        </button>
      </div>
      {settingsOpen && (
        <div className="settings-panel">
          <label>
            Day ends at
            <select
              value={state.rolloverHour}
              onChange={(e) => void attempt(() => api.app.setRolloverHour(Number(e.target.value)).then(onStateChange))}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? 'midnight' : `${h}:00 am`}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-path" title={state.vaultPath ?? ''}>
            {state.vaultPath}
          </div>
          <button onClick={() => void attempt(() => api.app.chooseVault().then(onStateChange))}>Change notes folder</button>
          <div className="settings-divider" />
          {state.encrypted ? (
            <>
              <div className="settings-status" data-testid="encrypted-status">
                <span className="lamp on" /> Encrypted
              </div>
              <button onClick={() => void attempt(() => api.app.lock().then(onStateChange))} data-testid="lock-now">
                Lock now
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(false)
                  setChangingPasscode(true)
                }}
              >
                Change passcode…
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setSettingsOpen(false)
                onEncrypt()
              }}
              data-testid="encrypt-notes"
            >
              Encrypt my notes…
            </button>
          )}
        </div>
      )}
      {changingPasscode && <ChangePasscodeDialog onClose={() => setChangingPasscode(false)} />}

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          {menu.items.map((item) => (
            <button key={item.label} onClick={item.run}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      {dialog?.type === 'container' && (
        <NameDialog
          title={`New ${KIND_LABEL[dialog.kind]}`}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const rel = await api.para.createContainer(dialog.kind, name)
            setExpanded((old) => new Set(old).add(rel.split('/')[0]))
            nav.openNote(rel)
          }}
        />
      )}
      {dialog?.type === 'note' && (
        <NameDialog
          title={dialog.folder ? `New note in ${dialog.folder.split('/').pop()}` : 'New note in Inbox'}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => nav.openNote(await api.notes.create(dialog.folder, name))}
        />
      )}
      {dialog?.type === 'rename' && (
        <NameDialog
          title={`Rename "${dialog.name}"`}
          initial={dialog.name}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const moved = await api.notes.rename(dialog.rel, name)
            const oldFolder = classify(dialog.rel).isHomeNote ? classify(dialog.rel).container : null
            if (currentRel === dialog.rel) nav.openNote(moved)
            else if (oldFolder && currentRel?.startsWith(oldFolder + '/')) {
              nav.openNote(classify(moved).container + currentRel.slice(oldFolder.length))
            }
          }}
        />
      )}
    </aside>
  )
}
