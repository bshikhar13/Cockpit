import type { CompletionSource } from '@codemirror/autocomplete'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, Prec, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view'
import {
  addColumn, addRow, emptyTable, formatTable, headerRowCells, removeColumn, removeRow, splitRow, tableExit, tableInsertion,
  type Align, type TableData
} from './tableModel'

export interface TableRef extends TableData {
  from: number
  to: number
}

export function findTables(state: EditorState): TableRef[] {
  const out: TableRef[] = []
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  tree.iterate({
    enter(node) {
      if (node.name !== 'Table') return
      const lines = state.doc.sliceString(node.from, node.to).split('\n')
      if (lines.length < 2) return false
      const align: Align[] = splitRow(lines[1]).map((cell) => {
        const left = cell.startsWith(':')
        const right = cell.endsWith(':')
        return left && right ? 'center' : right ? 'right' : left ? 'left' : null
      })
      const rows = [lines[0], ...lines.slice(2)].map((line) => {
        const cells = splitRow(line).slice(0, align.length)
        while (cells.length < align.length) cells.push('')
        return cells
      })
      out.push({ from: node.from, to: node.to, rows, align })
      return false
    }
  })
  return out
}

interface CellPos {
  row: number
  col: number
}
/** Which cell to put the caret in once the table at this position has been redrawn. */
let pendingFocus: (CellPos & { from: number }) | null = null

/** The table each on-screen widget currently shows; kept current when a widget is updated in place. */
const shown = new WeakMap<HTMLElement, TableRef>()

const insertText = (state: EditorState, text: string) => state.toText(text.replace(/\n/g, state.lineBreak))

function focusCell(wrap: HTMLElement, pos: CellPos): void {
  const cell = wrap.querySelector<HTMLElement>(`[data-row="${pos.row}"][data-col="${pos.col}"]`)
  if (!cell) return
  cell.focus()
  const range = document.createRange()
  range.selectNodeContents(cell)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * A table shown as a table and edited as one: click a cell and type. Every change is written back
 * to the note as ordinary markdown, so the file never holds anything but a plain markdown table.
 */
class TableWidget extends WidgetType {
  constructor(readonly table: TableRef) {
    super()
  }
  eq(other: TableWidget): boolean {
    return JSON.stringify([other.table.rows, other.table.align]) === JSON.stringify([this.table.rows, this.table.align])
  }
  ignoreEvent(): boolean {
    return true // the editor leaves clicks and keys inside the table to the table
  }

  /**
   * When only cell text changed, the table on screen is patched instead of rebuilt, so the cell
   * being typed in or clicked on keeps the cursor. A change of shape (a row or column added or
   * removed) rebuilds it.
   */
  updateDOM(dom: HTMLElement): boolean {
    const tableEl = dom.querySelector('table')
    const before = shown.get(dom)
    if (!tableEl || !before) return false
    const sameShape =
      tableEl.rows.length === this.table.rows.length &&
      before.align.length === this.table.align.length &&
      before.align.every((a, i) => a === this.table.align[i])
    if (!sameShape) return false
    this.table.rows.forEach((row, r) =>
      row.forEach((text, c) => {
        const cell = tableEl.rows[r].cells[c]
        const current = cell.textContent ?? ''
        // the cell holding the cursor is left alone unless its text really differs
        if (cell === document.activeElement ? current.trim() !== text : current !== text) cell.textContent = text
      })
    )
    shown.set(dom, this.table)
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-widget'
    const tableEl = document.createElement('table')
    this.table.rows.forEach((row, r) => {
      const tr = document.createElement('tr')
      row.forEach((text, c) => {
        const cell = document.createElement(r === 0 ? 'th' : 'td')
        cell.contentEditable = 'true'
        cell.spellcheck = false
        cell.dataset.row = String(r)
        cell.dataset.col = String(c)
        cell.textContent = text
        const a = this.table.align[c]
        if (a) cell.style.textAlign = a
        tr.appendChild(cell)
      })
      tableEl.appendChild(tr)
    })
    wrap.appendChild(tableEl)
    shown.set(wrap, this.table)
    const live = (): TableRef => shown.get(wrap) ?? this.table

    let active: CellPos = { row: 0, col: 0 }
    let busy = false
    const current = (): TableRef | null => {
      if (!wrap.isConnected) return null
      let pos: number
      try {
        pos = view.posAtDOM(wrap)
      } catch {
        return null // the editor has already let go of this table
      }
      return findTables(view.state).find((t) => pos >= t.from && pos <= t.to) ?? null
    }
    /** the table as it stands on screen, including what has just been typed */
    const read = (): TableData => ({
      rows: [...tableEl.rows].map((tr) => [...tr.cells].map((cell) => cell.textContent ?? '')),
      align: live().align
    })
    /** writes the table back to the note; `focus` is where the caret goes afterwards */
    const apply = (data: TableData, focus: CellPos | null): void => {
      if (busy) return // this table is already being redrawn; its old cells firing blur must not write again
      const cur = current()
      if (!cur) return
      const markdown = formatTable(data)
      if (markdown === view.state.doc.sliceString(cur.from, cur.to)) {
        if (focus) focusCell(wrap, focus)
        return
      }
      busy = true
      pendingFocus = focus ? { ...focus, from: cur.from } : null
      try {
        view.dispatch({ changes: { from: cur.from, to: cur.to, insert: insertText(view.state, markdown) } })
      } finally {
        busy = false
      }
      if (wrap.isConnected) {
        // patched in place: this is still the table on screen, so move the cursor now
        pendingFocus = null
        if (focus) focusCell(wrap, focus)
      }
    }
    const lastRow = (): number => tableEl.rows.length - 1
    const lastCol = (): number => live().align.length - 1

    wrap.addEventListener('focusin', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-row]')
      if (cell) active = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) }
    })
    wrap.addEventListener('focusout', (e) => {
      // Save what was typed. The cursor is not moved here: if the owner clicked another cell, the
      // browser is already putting it exactly where they clicked.
      apply(read(), null)
    })
    wrap.addEventListener('keydown', (e) => {
      if (!(e.target as HTMLElement).closest('[data-row]')) return
      const { row, col } = active
      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          if (col > 0) apply(read(), { row, col: col - 1 })
          else if (row > 0) apply(read(), { row: row - 1, col: lastCol() })
        } else if (col < lastCol()) apply(read(), { row, col: col + 1 })
        else if (row < lastRow()) apply(read(), { row: row + 1, col: 0 })
        else apply(addRow(read(), row), { row: row + 1, col: 0 })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (row < lastRow()) apply(read(), { row: row + 1, col })
        else apply(addRow(read(), row), { row: row + 1, col })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        const from = current()?.from
        apply(read(), null)
        const cur = findTables(view.state).find((t) => t.from === from)
        view.focus()
        if (cur) {
          const exit = tableExit(view.state, cur.to)
          view.dispatch({
            changes: exit.changes.map((c) => ({ ...c, insert: insertText(view.state, c.insert) })),
            selection: { anchor: exit.anchor }
          })
        }
      }
    })
    wrap.addEventListener('paste', (e) => {
      // plain text only, on one line: a cell cannot hold formatting or line breaks
      e.preventDefault()
      const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*\r?\n\s*/g, ' ')
      document.execCommand('insertText', false, text)
    })

    const tools = document.createElement('div')
    tools.className = 'cm-table-tools'
    const tool = (label: string, title: string, run: () => void): void => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.title = title
      button.addEventListener('mousedown', (e) => e.preventDefault()) // keep the caret in its cell
      button.addEventListener('click', run)
      tools.appendChild(button)
    }
    tool('+ Row', 'Add a row below', () => apply(addRow(read(), active.row), { row: active.row + 1, col: active.col }))
    tool('+ Column', 'Add a column to the right', () => apply(addColumn(read(), active.col), { row: active.row, col: active.col + 1 }))
    tool('− Row', 'Remove this row', () => {
      if (active.row > 0) apply(removeRow(read(), active.row), { row: Math.min(active.row, lastRow() - 1), col: active.col })
    })
    tool('− Column', 'Remove this column', () => {
      if (lastCol() > 0) apply(removeColumn(read(), active.col), { row: active.row, col: Math.max(0, Math.min(active.col, lastCol() - 1)) })
    })
    tool('Edit as text', 'Show the markdown', () => {
      apply(read(), null)
      const cur = current() ?? findTables(view.state).find((t) => t.from === live().from)
      if (!cur) return
      view.focus()
      view.dispatch({ selection: { anchor: cur.from } })
    })
    wrap.appendChild(tools)

    const wanted = pendingFocus
    if (wanted && wanted.from === this.table.from) {
      pendingFocus = null
      requestAnimationFrame(() => focusCell(wrap, wanted))
    }
    return wrap
  }
}

function build(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const table of findTables(state)) {
    // with the text cursor inside it, a table shows as markdown; otherwise as an editable table
    const touched = state.selection.ranges.some((r) => r.from <= table.to && r.to >= table.from)
    if (!touched) ranges.push(Decoration.replace({ widget: new TableWidget(table), block: true }).range(table.from, table.to))
  }
  return Decoration.set(ranges, true)
}

const field = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** Inserts an empty three-column table at the cursor and puts the caret in its first cell. */
export function insertTable(view: EditorView): boolean {
  const markdown = formatTable(emptyTable(3, 2))
  const change = tableInsertion(view.state, view.state.selection.main.head, markdown)
  const start = change.from + (change.insert.length - change.insert.trimStart().length)
  pendingFocus = { from: start, row: 0, col: 0 }
  view.dispatch({
    changes: { ...change, insert: insertText(view.state, change.insert) },
    selection: { anchor: change.from + change.insert.length }
  })
  return true
}

/** Enter at the end of a typed header row ("| Name | Price |") finishes the table and moves into it. */
function finishHeaderRow(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  if (sel.head !== line.to) return false
  const cells = headerRowCells(line.text)
  if (!cells) return false
  if (findTables(state).some((t) => line.from >= t.from && line.from <= t.to)) return false
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text.trim() : ''
  if (previous.startsWith('|')) return false
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text.trim() : null
  const markdown = formatTable({ rows: [cells, cells.map(() => '')], align: cells.map(() => null) })
  const lead = previous ? '\n' : ''
  const insert = `${lead}${markdown}${next === '' ? '' : '\n'}`
  pendingFocus = { from: line.from + lead.length, row: 1, col: 0 }
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: insertText(state, insert) },
    selection: { anchor: line.from + lead.length + markdown.length + 1 }
  })
  return true
}

/** Typing /table at the start of a line offers to insert a table. */
export const tableCompletion: CompletionSource = (ctx) => {
  const line = ctx.state.doc.lineAt(ctx.pos)
  const m = /^\s*\/(\w*)$/.exec(line.text.slice(0, ctx.pos - line.from))
  if (!m) return null
  return {
    from: ctx.pos - m[1].length - 1,
    options: [
      {
        label: '/table',
        detail: 'Insert a table',
        apply: (view, _completion, from, to) => {
          view.dispatch({ changes: { from, to, insert: '' } })
          insertTable(view)
        }
      }
    ],
    validFor: /^\/\w*$/
  }
}

/** Tables render as tables you can type into, and are quick to create. */
export const tableExtension: Extension = [
  field,
  Prec.high(
    keymap.of([
      { key: 'Mod-Alt-t', run: insertTable },
      { key: 'Enter', run: finishHeaderRow }
    ])
  )
]
