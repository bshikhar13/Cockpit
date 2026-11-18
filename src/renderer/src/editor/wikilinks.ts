import {
  autocompletion, type CompletionContext, type CompletionResult, type CompletionSource
} from '@codemirror/autocomplete'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { extractWikilinks } from '../../../core/links'

/** If the cursor is inside an unfinished [[link, where the name starts and what has been typed. */
export function completionRange(textBeforeCursor: string): { from: number; query: string } | null {
  const m = /\[\[([^[\]|\n]*)$/.exec(textBeforeCursor)
  return m ? { from: m.index + 2, query: m[1] } : null
}

interface Options {
  names: () => string[]
  open: (name: string) => void
  /** other things the same suggestion list should offer */
  extraSources?: CompletionSource[]
}

class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly target: string,
    readonly missing: boolean,
    readonly open: (name: string) => void
  ) {
    super()
  }
  eq(other: LinkWidget): boolean {
    return other.label === this.label && other.target === this.target && other.missing === this.missing
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = `cm-wikilink${this.missing ? ' missing' : ''}`
    el.textContent = this.label
    el.title = this.missing ? `Create "${this.target}"` : this.target
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.open(this.target)
    })
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState, opts: Options): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const known = new Set(opts.names().map((n) => n.toLowerCase()))
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) active.add(n)
  }
  for (const link of extractWikilinks(state.doc.toString())) {
    if (active.has(state.doc.lineAt(link.from).number)) {
      ranges.push(Decoration.mark({ class: 'cm-wikilink' }).range(link.from, link.to))
    } else {
      const widget = new LinkWidget(link.alias ?? link.target, link.target, !known.has(link.target.toLowerCase()), opts.open)
      ranges.push(Decoration.replace({ widget }).range(link.from, link.to))
    }
  }
  return Decoration.set(ranges, true)
}

export function wikilinkExtension(opts: Options): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, opts),
    update(value, tr) {
      return tr.docChanged || tr.selection ? build(tr.state, opts) : value
    },
    provide: (f) => EditorView.decorations.from(f)
  })

  const complete = (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const range = completionRange(line.text.slice(0, ctx.pos - line.from))
    if (!range) return null
    const closed = ctx.state.doc.sliceString(ctx.pos, ctx.pos + 2) === ']]'
    return {
      from: line.from + range.from,
      options: opts.names().map((name) => ({ label: name, apply: closed ? name : `${name}]]` })),
      validFor: /^[^[\]|\n]*$/
    }
  }

  // Cmd+click follows a link that is showing as raw markdown
  const clicks = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      const link = extractWikilinks(view.state.doc.toString()).find((l) => pos >= l.from && pos <= l.to)
      if (!link) return false
      event.preventDefault()
      opts.open(link.target)
      return true
    }
  })

  return [field, autocompletion({ override: [complete, ...(opts.extraSources ?? [])], icons: false }), clicks]
}
