import { expect, test } from 'vitest'
import { createState } from '../../src/renderer/src/editor/livePreview'
import {
  addColumn, addRow, emptyTable, formatTable, headerRowCells, removeColumn, removeRow, setCell, tableInsertion, type TableData
} from '../../src/renderer/src/editor/tableModel'
import { findTables } from '../../src/renderer/src/editor/tables'

const t: TableData = { rows: [['Plan', 'Price'], ['Basic', '10'], ['Pro', '30']], align: ['left', 'right'] }

test('formats a table with padded columns and alignment markers', () => {
  expect(formatTable(t)).toBe('| Plan  | Price |\n| :---- | ----: |\n| Basic |    10 |\n| Pro   |    30 |')
  expect(formatTable({ rows: [['a', 'b']], align: [null, 'center'] })).toBe('| a   |  b  |\n| --- | :-: |')
})

test('what is written is read back the same, including pipes and line breaks in cells', () => {
  const tricky: TableData = { rows: [['a | b', 'x'], ['two\nlines', '']], align: [null, null] }
  const parsed = findTables(createState(formatTable(tricky) + '\n'))[0]
  expect(parsed.rows).toEqual([['a | b', 'x'], ['two lines', '']])
  const again = findTables(createState(formatTable(t) + '\n'))[0]
  expect({ rows: again.rows, align: again.align }).toEqual(t)
})

test('a new table is empty, three columns by two rows, and is a valid table', () => {
  const fresh = emptyTable(3, 2)
  expect(fresh.rows).toEqual([['', '', ''], ['', '', '']])
  expect(findTables(createState(formatTable(fresh) + '\n'))).toHaveLength(1)
})

test('rows and columns can be added and removed without touching other cells', () => {
  expect(addRow(t, 1).rows).toEqual([['Plan', 'Price'], ['Basic', '10'], ['', ''], ['Pro', '30']])
  expect(addColumn(t, 0)).toEqual({ rows: [['Plan', '', 'Price'], ['Basic', '', '10'], ['Pro', '', '30']], align: ['left', null, 'right'] })
  expect(removeRow(t, 1).rows).toEqual([['Plan', 'Price'], ['Pro', '30']])
  expect(removeColumn(t, 0)).toEqual({ rows: [['Price'], ['10'], ['30']], align: ['right'] })
  expect(setCell(t, 2, 1, '35').rows[2]).toEqual(['Pro', '35'])
  expect(t.rows[2]).toEqual(['Pro', '30'])
})

test('the header row and the last column cannot be removed', () => {
  expect(removeRow(t, 0)).toBe(t)
  expect(removeColumn({ rows: [['a'], ['1']], align: [null] }, 0).rows).toEqual([['a'], ['1']])
})

test('a new table goes on its own lines, with blank lines separating it from text', () => {
  const md = '| a |\n| --- |'
  expect(tableInsertion(createState(''), 0, md)).toEqual({ from: 0, to: 0, insert: md + '\n' })
  expect(tableInsertion(createState('some text'), 4, md)).toEqual({ from: 9, to: 9, insert: '\n\n' + md + '\n' })
  expect(tableInsertion(createState('above\n\nbelow'), 6, md)).toEqual({ from: 6, to: 6, insert: '\n' + md + '\n' })
  expect(tableInsertion(createState('above\n\nbelow'), 3, md)).toEqual({ from: 5, to: 5, insert: '\n\n' + md + '\n' })
})

test('a typed header row is recognised so Enter can finish the table', () => {
  expect(headerRowCells('| Name | Price |')).toEqual(['Name', 'Price'])
  expect(headerRowCells('| Name | Price')).toEqual(['Name', 'Price'])
  expect(headerRowCells('| Only |')).toBeNull()
  expect(headerRowCells('not | a table')).toBeNull()
  expect(headerRowCells('| --- | --- |')).toBeNull()
})

import { tableExit } from '../../src/renderer/src/editor/tableModel'

test('leaving a table always lands on a line separated from it by a blank line', () => {
  const md = '| a |\n| --- |\n| 1 |'
  const land = (doc: string): string => {
    const state = createState(doc)
    const exit = tableExit(state, md.length)
    const next = state.update({ changes: exit.changes, selection: { anchor: exit.anchor } }).state
    const typed = next.update({ changes: { from: next.selection.main.head, insert: 'X' } }).state
    return typed.sliceDoc()
  }
  expect(land(md)).toBe(md + '\n\nX')
  expect(land(md + '\n')).toBe(md + '\n\nX')
  expect(land(md + '\n\n')).toBe(md + '\n\nX')
  expect(land(md + '\n\nnext')).toBe(md + '\n\nXnext')
  expect(land(md + '\nglued')).toBe(md + '\n\nXglued')
  for (const doc of [md, md + '\n', md + '\n\nnext', md + '\nglued']) {
    expect(findTables(createState(land(doc)))[0].rows).toEqual([['a'], ['1']])
  }
})
