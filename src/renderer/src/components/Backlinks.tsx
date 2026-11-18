import { api } from '../api'
import { useNav } from '../nav'
import { useVault } from '../useVault'

export function Backlinks({ name }: { name: string }): JSX.Element | null {
  const nav = useNav()
  const { data } = useVault(() => api.notes.backlinks(name), [name])
  if (!data?.length) return null
  return (
    <div className="backlinks" data-testid="backlinks">
      <div className="section-label">Linked from</div>
      {data.map((note) => (
        <a key={note.rel} onClick={() => nav.openNote(note.rel)}>
          {note.name}
          <span className="muted"> · {note.container?.split('/').pop() ?? (note.kind === 'diary' ? 'Diary' : '')}</span>
        </a>
      ))}
    </div>
  )
}
