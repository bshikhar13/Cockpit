import { expect, test } from 'vitest'
import type { NoteRef, SearchHit } from '../../src/core/types'
import { mergeResults } from '../../src/renderer/src/shell/CommandPalette'

const notes = [
  { rel: 'Inbox/Throw.md', name: 'Throw' },
  { rel: 'Areas/Job/Job.md', name: 'Job' },
  { rel: 'Inbox/Robin.md', name: 'Robin' }
] as NoteRef[]
const hits: SearchHit[] = [
  { rel: 'Areas/Job/Job.md', name: 'Job', snippet: '...asked Robin about...' },
  { rel: 'Inbox/Robin.md', name: 'Robin', snippet: 'x' }
]

test('title prefix matches first, then other title matches, then text matches, without repeats', () => {
  expect(mergeResults('ro', notes, hits).map((r) => r.rel)).toEqual(['Inbox/Robin.md', 'Inbox/Throw.md', 'Areas/Job/Job.md'])
  expect(mergeResults('ro', notes, hits)[2].snippet).toBe('...asked Robin about...')
})

test('empty or unmatched queries give nothing', () => {
  expect(mergeResults('', notes, [])).toEqual([])
  expect(mergeResults('zzz', notes, [])).toEqual([])
})

test('results are capped at twenty', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ rel: `Inbox/N${i}.md`, name: `N${i}` })) as NoteRef[]
  expect(mergeResults('n', many, [])).toHaveLength(20)
})
