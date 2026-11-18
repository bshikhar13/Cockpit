import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from 'vitest'
import { createState, detectLineSeparator } from '../../src/renderer/src/editor/livePreview'

const fixture = (name: string): string => readFileSync(join(__dirname, '../fixtures', name), 'utf8')

test.each(['sample.md', 'crlf.md'])('%s loads losslessly and an edit changes only what was edited', (name) => {
  const raw = fixture(name)
  const st = createState(raw)
  expect(st.sliceDoc()).toBe(raw)
  const edited = st.update({ changes: { from: 0, insert: 'X' } }).state
  expect(edited.sliceDoc()).toBe('X' + raw)
  const end = st.update({ changes: { from: st.doc.length, insert: '!' } }).state
  expect(end.sliceDoc()).toBe(raw + '!')
})

test('a new line typed into a CRLF file is a CRLF', () => {
  const st = createState('a\r\nb')
  const typed = st.update({ changes: { from: 1, insert: st.toText('\r\n') } }).state
  expect(typed.sliceDoc()).toBe('a\r\n\r\nb')
})

test('detects the line separator', () => {
  expect(detectLineSeparator('a\r\nb')).toBe('\r\n')
  expect(detectLineSeparator('a\nb')).toBe('\n')
  expect(detectLineSeparator('')).toBe('\n')
})
