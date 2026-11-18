import { expect, test } from 'vitest'
import { setHabitTick } from '../../src/core/diary'
import { createState } from '../../src/renderer/src/editor/livePreview'
import { minimalChange, transformDoc } from '../../src/renderer/src/editor/transform'

test('minimal change covers only the differing middle', () => {
  expect(minimalChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' })
  expect(minimalChange('abc', 'abc')).toBeNull()
  expect(minimalChange('abc', 'abcd')).toEqual({ from: 3, to: 3, insert: 'd' })
  expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' })
})

test('ticking a habit through the editor changes the frontmatter and leaves unsaved typing alone', () => {
  const state = createState('---\ndate: 2026-11-11\n---\n\nUnsaved words the owner just typed.')
  const tr = transformDoc(state, (text) => setHabitTick(text, 'Run', true))!
  expect(state.update(tr).state.sliceDoc()).toBe(
    '---\ndate: 2026-11-11\nhabits:\n  Run: true\n---\n\nUnsaved words the owner just typed.'
  )
})

test('a CRLF document stays CRLF after a transform', () => {
  const state = createState('---\r\ndate: 2026-11-11\r\n---\r\nBody\r\n')
  const next = state.update(transformDoc(state, (text) => setHabitTick(text, 'Run', true))!).state
  expect(next.sliceDoc()).toBe('---\r\ndate: 2026-11-11\r\nhabits:\r\n  Run: true\r\n---\r\nBody\r\n')
})

test('a transform that changes nothing produces no transaction', () => {
  const state = createState('plain')
  expect(transformDoc(state, (t) => t)).toBeNull()
})
