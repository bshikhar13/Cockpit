import type { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { createState, hiddenRanges } from '../../src/renderer/src/editor/livePreview'

const doc = '---\ndate: 2026-11-11\n---\n# Title\n\nSome **bold** and *em* and `code` and [link](https://e.com).\n'
const at = (pos: number): EditorState => createState(doc).update({ selection: { anchor: pos } }).state
const hidden = (s: EditorState): string[] => hiddenRanges(s).map((r) => s.sliceDoc(r.from, r.to))

test('with the cursor elsewhere, frontmatter and syntax marks are hidden', () => {
  const h = hidden(at(doc.length))
  expect(h).toContain('---\ndate: 2026-11-11\n---')
  expect(h).toContain('# ')
  expect(h.filter((x) => x === '**')).toHaveLength(2)
  expect(h.filter((x) => x === '*')).toHaveLength(2)
  expect(h.filter((x) => x === '`')).toHaveLength(2)
  expect(h).toContain('[')
  expect(h).toContain('](https://e.com)')
})

test('marks on the cursor line are shown', () => {
  const h = hidden(at(doc.indexOf('bold')))
  expect(h).not.toContain('**')
  expect(h).not.toContain('`')
  expect(h).toContain('# ')
})

test('the heading mark shows when the cursor is on the heading', () => {
  expect(hidden(at(doc.indexOf('Title')))).not.toContain('# ')
  expect(hidden(at(doc.indexOf('Title'))).filter((x) => x === '**')).toHaveLength(2)
})

test('frontmatter shows when the cursor is inside it', () => {
  expect(hidden(at(5))).not.toContain('---\ndate: 2026-11-11\n---')
})

test('nothing inside frontmatter or code is treated as markdown', () => {
  const s = createState('---\ntitle: "**x**"\n---\n```\n**y**\n```\nend\n').update({ selection: { anchor: 40 } }).state
  expect(hidden(s)).toEqual(['---\ntitle: "**x**"\n---'])
})

test('ranges are sorted and never overlap', () => {
  const r = hiddenRanges(at(doc.length))
  for (let i = 1; i < r.length; i++) expect(r[i].from).toBeGreaterThanOrEqual(r[i - 1].to)
})
