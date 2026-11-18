import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { api } from '../api'
import { useNav } from '../nav'
import { useVault } from '../useVault'
import { createState, livePreview } from './livePreview'
import { mediaExtension } from './media'
import { tableCompletion, tableExtension } from './tables'
import { transformDoc } from './transform'
import { useNoteFile } from './useNoteFile'
import { wikilinkExtension } from './wikilinks'

export interface EditorHandle {
  /** Applies an app-made change to the open text as a small edit, then saves. False if the editor is not ready. */
  transform(fn: (text: string) => string): Promise<boolean>
}

interface EditorProps {
  rel: string
  extensions?: Extension[]
  autoFocus?: boolean
  placeholder?: string
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref): JSX.Element {
  const file = useNoteFile(props.rel)
  const flush = useRef(file.flush)
  flush.current = file.flush
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChange = useRef(file.onChange)
  onChange.current = file.onChange
  const extensions = useRef(props.extensions ?? [])
  const nav = useNav()
  const openNote = useRef(nav.openNote)
  openNote.current = nav.openNote
  const notes = useVault(() => api.notes.all())
  const names = useRef<string[]>([])
  names.current = (notes.data ?? []).map((n) => n.name)

  // (re)build the editor whenever a fresh version of the file arrives from disk
  useEffect(() => {
    if (file.text === null || !host.current) return
    const previous = view.current
    if (previous && previous.state.sliceDoc() === file.text) return
    const keepCursor = previous ? previous.state.selection.main.head : null
    const hadFocus = previous?.hasFocus ?? false
    previous?.destroy()

    const state = createState(file.text, [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      placeholder(props.placeholder ?? 'Start writing…'),
      livePreview,
      tableExtension,
      mediaExtension(props.rel),
      wikilinkExtension({
        names: () => names.current,
        extraSources: [tableCompletion],
        open: (name) => void api.notes.openOrCreateByName(name).then((rel) => openNote.current(rel), () => undefined)
      }),
      ...extensions.current,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange.current(u.state.sliceDoc())
      })
    ])
    const v = new EditorView({ state, parent: host.current })
    const end = v.state.doc.length
    v.dispatch({ selection: { anchor: keepCursor === null ? end : Math.min(keepCursor, end) } })
    if (hadFocus || (previous === null && props.autoFocus)) v.focus()
    view.current = v
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.version])

  useEffect(
    () => () => {
      view.current?.destroy()
      view.current = null
    },
    []
  )

  useImperativeHandle(ref, () => ({
    async transform(fn) {
      const v = view.current
      if (!v) return false
      const spec = transformDoc(v.state, fn)
      if (spec) v.dispatch(spec)
      await flush.current()
      return true
    }
  }))

  return (
    <div className="editor-wrap">
      {file.error && <div className="banner">{file.error}</div>}
      {file.conflictCopy && (
        <div className="banner" data-testid="conflict-banner">
          <span>
            This note changed on disk while you were editing. The other version was saved as{' '}
            <b>{file.conflictCopy.split('/').pop()}</b>.
          </span>
          <button onClick={file.dismissConflict}>Dismiss</button>
        </div>
      )}
      <div className="editor" ref={host} data-testid="editor" 
        onClick={(e) => {
          // a click on the empty margin focuses the editor; a click inside it (a table cell, a link) is left alone
          if (e.target === e.currentTarget) view.current?.focus()
        }}
      />
    </div>
  )
})
