import { useEffect, useRef, useState } from 'react'
import type { NoteRef, SearchHit } from '../../../core/types'
import { api } from '../api'
import { useNav } from '../nav'

export interface PaletteResult {
  rel: string
  name: string
  snippet?: string
}

/** Title matches first (prefix before substring), then full-text hits; no repeats; at most 20. */
export function mergeResults(query: string, notes: NoteRef[], hits: SearchHit[]): PaletteResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: PaletteResult[] = []
  const seen = new Set<string>()
  const add = (r: PaletteResult): void => {
    if (!seen.has(r.rel)) {
      seen.add(r.rel)
      out.push(r)
    }
  }
  const byName = [...notes].sort((a, b) => a.name.localeCompare(b.name))
  byName.filter((n) => n.name.toLowerCase().startsWith(q)).forEach((n) => add({ rel: n.rel, name: n.name }))
  byName.filter((n) => n.name.toLowerCase().includes(q)).forEach((n) => add({ rel: n.rel, name: n.name }))
  hits.forEach((h) => add({ rel: h.rel, name: h.name, snippet: h.snippet }))
  return out.slice(0, 20)
}

const recent: string[] = []
/** Remembers the notes opened this session, newest first, for the empty palette. */
export function noteOpened(rel: string): void {
  const at = recent.indexOf(rel)
  if (at >= 0) recent.splice(at, 1)
  recent.unshift(rel)
  recent.length = Math.min(recent.length, 8)
}

const where = (rel: string): string => rel.split('/').slice(0, -1).join(' / ')

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const nav = useNav()
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<NoteRef[]>([])
  const [results, setResults] = useState<PaletteResult[]>([])
  const [selected, setSelected] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    void api.notes.all().then(setNotes, () => undefined)
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      const byRel = new Map(notes.map((n) => [n.rel, n]))
      setResults(recent.filter((r) => byRel.has(r)).map((r) => ({ rel: r, name: byRel.get(r)!.name })))
      return
    }
    const ticket = ++latest.current
    void api.notes.search(q).then(
      (hits) => ticket === latest.current && setResults(mergeResults(q, notes, hits)),
      () => undefined
    )
  }, [query, notes, open])

  useEffect(() => setSelected(0), [results])
  if (!open) return null

  const choose = (r: PaletteResult | undefined): void => {
    if (!r) return
    nav.openNote(r.rel)
    onClose()
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[selected])
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} data-testid="palette">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Search notes…" />
        <div className="palette-results">
          {results.map((r, i) => (
            <div
              key={r.rel}
              className={`palette-item ${i === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(r)}
            >
              <div>
                {r.name}
                <span className="path">{where(r.rel)}</span>
              </div>
              {r.snippet && <div className="snippet">{r.snippet}</div>}
            </div>
          ))}
          {results.length === 0 && (
            <div className="palette-empty">{query.trim() ? 'No notes match.' : 'Type to search titles and text.'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
