import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { splitFrontmatter } from '../../../core/frontmatter'

export function detectLineSeparator(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * An editor state whose document is the file's text, exactly. The file's own line separator is
 * kept, so saving writes back the same bytes apart from what the owner edits.
 */
export function createState(text: string, extensions: Extension[] = []): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [EditorState.lineSeparator.of(detectLineSeparator(text)), markdown({ base: markdownLanguage }), ...extensions]
  })
}

export interface HiddenRange {
  from: number
  to: number
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number
  ) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-task-check'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

const HEADING = /^(?:ATXHeading|SetextHeading)(\d)$/
const MARK_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-strong',
  Emphasis: 'cm-em',
  Strikethrough: 'cm-strike',
  InlineCode: 'cm-inline-code',
  Link: 'cm-link',
  Autolink: 'cm-link',
  URL: 'cm-url',
  HorizontalRule: 'cm-hr-line',
  ListMark: 'cm-bullet'
}

interface Analysis {
  hidden: HiddenRange[]
  decorations: Range<Decoration>[]
}

function analyse(state: EditorState): Analysis {
  const text = state.doc.toString()
  const doc = state.doc
  const hidden: HiddenRange[] = []
  const decorations: Range<Decoration>[] = []

  const activeLines = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) activeLines.add(n)
  }
  const inactive = (from: number, to = from): boolean => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) if (activeLines.has(n)) return false
    return true
  }
  const lineClass = (from: number, to: number, cls: string): void => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(Math.max(from, to - 1)).number; n++) {
      decorations.push(Decoration.line({ class: cls }).range(doc.line(n).from))
    }
  }

  // frontmatter: hidden as one block unless the cursor is inside it
  const fm = splitFrontmatter(text)
  let fmEnd = 0
  if (fm.yaml !== null) {
    fmEnd = text[fm.bodyOffset - 1] === '\n' ? fm.bodyOffset - 1 : fm.bodyOffset
    const cursorInside = state.selection.ranges.some((r) => r.from <= fmEnd)
    if (cursorInside) lineClass(0, fmEnd, 'cm-frontmatter')
    else hidden.push({ from: 0, to: fmEnd })
  }

  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state)
  tree.iterate({
    enter(node) {
      const name = node.name
      if (name === 'Document') return
      if (node.from < fm.bodyOffset) return false
      if (name === 'FencedCode' || name === 'CodeBlock') {
        lineClass(node.from, node.to, 'cm-codeblock')
        return false
      }
      const heading = HEADING.exec(name)
      if (heading) lineClass(node.from, node.to, `cm-h${heading[1]}`)
      if (name === 'Blockquote') lineClass(node.from, node.to, 'cm-quote')
      if (MARK_CLASS[name] && node.to > node.from) decorations.push(Decoration.mark({ class: MARK_CLASS[name] }).range(node.from, node.to))

      if (name === 'HeaderMark') {
        const parent = node.node.parent
        if (parent && parent.name.startsWith('ATXHeading') && node.from === parent.from && inactive(node.from)) {
          const to = text[node.to] === ' ' ? node.to + 1 : node.to
          hidden.push({ from: node.from, to })
        }
      } else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
        if (inactive(node.from)) hidden.push({ from: node.from, to: node.to })
      } else if (name === 'CodeMark') {
        if (node.node.parent?.name === 'InlineCode' && inactive(node.from)) hidden.push({ from: node.from, to: node.to })
      } else if (name === 'QuoteMark') {
        if (inactive(node.from)) hidden.push({ from: node.from, to: text[node.to] === ' ' ? node.to + 1 : node.to })
      } else if (name === 'Link') {
        const marks = node.node.getChildren('LinkMark')
        if (marks.length >= 2 && node.node.getChild('URL') && inactive(node.from, node.to)) {
          hidden.push({ from: marks[0].from, to: marks[0].to })
          hidden.push({ from: marks[1].from, to: node.to })
        }
      } else if (name === 'TaskMarker') {
        const line = doc.lineAt(node.from)
        const m = /^(\s*)(?:[-*+]|\d+[.)])\s+$/.exec(line.text.slice(0, node.from - line.from))
        if (m && inactive(node.from)) {
          const checked = text[node.from + 1] !== ' '
          decorations.push(
            Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(line.from + m[1].length, node.to)
          )
        }
      }
      return
    }
  })

  hidden.sort((a, b) => a.from - b.from)
  return { hidden, decorations }
}

/** Syntax that is hidden while the cursor is on another line. */
export function hiddenRanges(state: EditorState): HiddenRange[] {
  return analyse(state).hidden
}

function build(state: EditorState): DecorationSet {
  const { hidden, decorations } = analyse(state)
  const fmBlock = hidden.length && hidden[0].from === 0 && state.doc.sliceString(0, 3) === '---' ? hidden[0] : null
  for (const h of hidden) {
    if (h.to <= h.from) continue
    decorations.push(Decoration.replace(h === fmBlock ? { block: true } : {}).range(h.from, h.to))
  }
  return Decoration.set(decorations, true)
}

const field = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

export const livePreview: Extension = [field]
