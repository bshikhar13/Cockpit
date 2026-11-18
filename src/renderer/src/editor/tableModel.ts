import type { EditorState } from '@codemirror/state'

export type Align = 'left' | 'center' | 'right' | null
export interface TableData {
  /** rows[0] is the header */
  rows: string[][]
  align: Align[]
}

/** Splits one markdown table line into trimmed cells, honouring escaped pipes. */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  const trimmed = line.trim()
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
    } else if (ch === '|') {
      cells.push(current.trim())
      current = ''
    } else current += ch
  }
  cells.push(current.trim())
  if (trimmed.startsWith('|')) cells.shift()
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop()
  return cells
}

const escapeCell = (cell: string): string => cell.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()

function pad(text: string, width: number, align: Align): string {
  const space = width - text.length
  if (align === 'right') return ' '.repeat(space) + text
  if (align === 'center') return ' '.repeat(Math.floor(space / 2)) + text + ' '.repeat(Math.ceil(space / 2))
  return text + ' '.repeat(space)
}

function delimiter(width: number, align: Align): string {
  if (align === 'left') return ':' + '-'.repeat(width - 1)
  if (align === 'right') return '-'.repeat(width - 1) + ':'
  if (align === 'center') return ':' + '-'.repeat(width - 2) + ':'
  return '-'.repeat(width)
}

/** The table as markdown, columns padded so it also reads well as plain text. No trailing newline. */
export function formatTable(table: TableData): string {
  const rows = table.rows.map((row) => table.align.map((_, c) => escapeCell(row[c] ?? '')))
  const widths = table.align.map((_, c) => Math.max(3, ...rows.map((row) => row[c].length)))
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  return [
    line(rows[0].map((cell, c) => pad(cell, widths[c], table.align[c]))),
    line(widths.map((w, c) => delimiter(w, table.align[c]))),
    ...rows.slice(1).map((row) => line(row.map((cell, c) => pad(cell, widths[c], table.align[c]))))
  ].join('\n')
}

export function emptyTable(columns: number, rows: number): TableData {
  return {
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')),
    align: Array.from({ length: columns }, () => null)
  }
}

export function setCell(table: TableData, row: number, col: number, value: string): TableData {
  return { ...table, rows: table.rows.map((r, i) => (i === row ? r.map((cell, c) => (c === col ? value : cell)) : r)) }
}

/** Adds an empty row below the given row. */
export function addRow(table: TableData, after: number): TableData {
  const rows = [...table.rows]
  rows.splice(after + 1, 0, table.align.map(() => ''))
  return { ...table, rows }
}

/** Adds an empty column to the right of the given column. */
export function addColumn(table: TableData, after: number): TableData {
  const insert = <T,>(list: T[], value: T): T[] => [...list.slice(0, after + 1), value, ...list.slice(after + 1)]
  return { rows: table.rows.map((row) => insert(row, '')), align: insert(table.align, null) }
}

/** The header row stays: a markdown table cannot exist without one. */
export function removeRow(table: TableData, row: number): TableData {
  if (row <= 0 || row >= table.rows.length) return table
  return { ...table, rows: table.rows.filter((_, i) => i !== row) }
}

export function removeColumn(table: TableData, col: number): TableData {
  if (table.align.length <= 1 || col < 0 || col >= table.align.length) return table
  return { rows: table.rows.map((row) => row.filter((_, c) => c !== col)), align: table.align.filter((_, c) => c !== col) }
}

/** Where to put a new table so it stands on its own lines, separated from surrounding text by blank lines. */
export function tableInsertion(state: EditorState, pos: number, markdown: string): { from: number; to: number; insert: string } {
  const line = state.doc.lineAt(pos)
  if (line.text.trim() === '') {
    const previous = line.number > 1 ? state.doc.line(line.number - 1).text.trim() : ''
    return { from: line.from, to: line.from, insert: `${previous ? '\n' : ''}${markdown}\n` }
  }
  return { from: line.to, to: line.to, insert: `\n\n${markdown}\n` }
}

/** If the line is a typed header row such as "| Name | Price |", its cells; otherwise null. */
export function headerRowCells(line: string): string[] | null {
  if (!line.trim().startsWith('|')) return null
  const cells = splitRow(line)
  if (cells.length < 2 || cells.every((c) => c === '')) return null
  if (cells.every((c) => /^:?-+:?$/.test(c))) return null
  return cells
}

/**
 * Where the text cursor should go when leaving a table that ends at `tableTo`, and what to insert
 * so that there is a blank line in between. Text typed on the line directly under a table would
 * otherwise become part of it.
 */
export function tableExit(state: EditorState, tableTo: number): { changes: { from: number; insert: string }[]; anchor: number } {
  const doc = state.doc
  const last = doc.lineAt(tableTo)
  if (last.number === doc.lines) return { changes: [{ from: tableTo, insert: '\n\n' }], anchor: tableTo + 2 }
  const below = doc.line(last.number + 1)
  if (below.text.trim() !== '') return { changes: [{ from: tableTo, insert: '\n' }], anchor: below.from + 1 }
  if (below.number === doc.lines) return { changes: [{ from: below.to, insert: '\n' }], anchor: below.to + 1 }
  return { changes: [], anchor: doc.line(below.number + 1).from }
}
