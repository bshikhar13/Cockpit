import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { attachmentUrl } from '../../../core/attachments'
import { api } from '../api'

export interface MediaRef {
  from: number
  to: number
  path: string
  alt: string
  type: 'image' | 'video'
}

const IMAGE = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)$/
const VIDEO_EXT = /\.(mp4|mov|webm)$/i

export function findMedia(state: EditorState): MediaRef[] {
  const out: MediaRef[] = []
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  tree.iterate({
    enter(node) {
      if (node.name !== 'Image') return
      const m = IMAGE.exec(state.doc.sliceString(node.from, node.to))
      if (m) {
        const path = m[2]
        out.push({ from: node.from, to: node.to, path, alt: m[1], type: VIDEO_EXT.test(path.split(/[?#]/)[0]) ? 'video' : 'image' })
      }
      return false
    }
  })
  return out
}

/** Where and what to insert so the media markdown sits on its own line. */
export function insertionFor(state: EditorState, pos: number, markdown: string): { from: number; insert: string } {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from).trim() !== ''
  return { from: pos, insert: `${before ? '\n' : ''}${markdown}\n` }
}

class MediaWidget extends WidgetType {
  constructor(
    readonly url: string | null,
    readonly type: 'image' | 'video',
    readonly alt: string,
    readonly path: string
  ) {
    super()
  }
  eq(other: MediaWidget): boolean {
    return other.url === this.url && other.type === this.type && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-media'
    const broken = (): void => {
      wrap.innerHTML = ''
      const note = document.createElement('span')
      note.className = 'broken'
      note.textContent = `Can't show ${this.path}`
      wrap.appendChild(note)
    }
    if (!this.url) broken()
    else if (this.type === 'video') {
      const video = document.createElement('video')
      video.controls = true
      video.preload = 'metadata'
      video.src = this.url
      video.onerror = broken
      wrap.appendChild(video)
    } else {
      const img = document.createElement('img')
      img.src = this.url
      img.alt = this.alt
      img.onerror = broken
      wrap.appendChild(img)
    }
    return wrap
  }
  ignoreEvent(): boolean {
    return this.type === 'video'
  }
}

function build(state: EditorState, noteRel: string): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) active.add(n)
  }
  for (const m of findMedia(state)) {
    const widget = new MediaWidget(attachmentUrl(noteRel, m.path), m.type, m.alt, m.path)
    const line = state.doc.lineAt(m.from)
    if (active.has(line.number)) {
      // cursor on the line: show the markdown, and the media underneath it
      ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to))
    } else {
      ranges.push(Decoration.replace({ widget }).range(m.from, m.to))
    }
  }
  return Decoration.set(ranges, true)
}

const MEDIA_TYPE = /^(image|video)\//

async function importFiles(view: EditorView, files: File[], pos: number, noteRel: string): Promise<void> {
  let at = pos
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : `.${file.type.split('/')[1] ?? 'png'}`
    const generic = !file.name || /^image\.\w+$/i.test(file.name)
    const d = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
    const name = generic ? `Pasted ${stamp}${ext}` : file.name
    const markdown = await api.notes.importAttachment(bytes, name, noteRel)
    const change = insertionFor(view.state, Math.min(at, view.state.doc.length), markdown)
    view.dispatch({ changes: change, selection: { anchor: change.from + change.insert.length } })
    at = change.from + change.insert.length
  }
}

/** Renders images and video in place, and stores pasted or dropped files in Attachments/. */
export function mediaExtension(noteRel: string): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, noteRel),
    update(value, tr) {
      if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state, noteRel)
      return value
    },
    provide: (f) => EditorView.decorations.from(f)
  })
  const handlers = EditorView.domEventHandlers({
    paste(event, view) {
      const files = [...(event.clipboardData?.files ?? [])].filter((f) => MEDIA_TYPE.test(f.type))
      if (!files.length) return false
      event.preventDefault()
      void importFiles(view, files, view.state.selection.main.head, noteRel)
      return true
    },
    drop(event, view) {
      const files = [...(event.dataTransfer?.files ?? [])].filter((f) => MEDIA_TYPE.test(f.type))
      if (!files.length) return false
      event.preventDefault()
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
      void importFiles(view, files, pos, noteRel)
      return true
    }
  })
  return [field, handlers]
}
