import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { NoteSession } from './noteSession'

export interface NoteFile {
  /** the text as last read from disk; null until loaded */
  text: string | null
  /** increases each time `text` is replaced by a fresh read from disk */
  version: number
  onChange(text: string): void
  flush(): Promise<void>
  conflictCopy: string | null
  dismissConflict(): void
  error: string | null
}

/** React wrapper around a NoteSession: one per open note, saved on blur and when the screen closes. */
export function useNoteFile(rel: string): NoteFile {
  const [loaded, setLoaded] = useState<{ text: string | null; version: number }>({ text: null, version: 0 })
  const [conflictCopy, setConflictCopy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<NoteSession | null>(null)

  useEffect(() => {
    const s = new NoteSession(rel, api.notes, {
      onLoaded: (text) => setLoaded((old) => ({ text, version: old.version + 1 })),
      onConflict: setConflictCopy,
      onError: setError
    })
    session.current = s
    void s.load()
    const off = api.on('vault-changed', () => void s.load())
    const onBlur = (): void => void s.flush()
    window.addEventListener('blur', onBlur)
    return () => {
      off()
      window.removeEventListener('blur', onBlur)
      void s.dispose()
    }
  }, [rel])

  return {
    text: loaded.text,
    version: loaded.version,
    onChange: (text) => session.current?.change(text),
    flush: () => session.current?.flush() ?? Promise.resolve(),
    conflictCopy,
    dismissConflict: () => setConflictCopy(null),
    error
  }
}
