import { expect, test } from 'vitest'
import { createState } from '../../src/renderer/src/editor/livePreview'
import { findTables } from '../../src/renderer/src/editor/tables'

test('finds a table with rows and alignment', () => {
  const t = createState('before\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\nafter\n')
  const tables = findTables(t)
  expect(tables).toHaveLength(1)
  expect(tables[0].rows).toEqual([['a', 'b'], ['1', '2']])
  expect(tables[0].align).toEqual(['left', 'right'])
  expect(t.sliceDoc(tables[0].from, tables[0].to)).toBe('| a | b |\n|:--|--:|\n| 1 | 2 |')
})

test('handles escaped pipes, centre alignment, and ragged rows', () => {
  const t = createState('| a \\| x | b |\n|:-:|---|\n| 1 |\n')
  expect(findTables(t)[0].rows).toEqual([['a | x', 'b'], ['1', '']])
  expect(findTables(t)[0].align).toEqual(['center', null])
})

test('a lone pipe line is not a table', () => {
  expect(findTables(createState('| not | a table\n'))).toEqual([])
})
