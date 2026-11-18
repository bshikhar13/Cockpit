import { expect, test } from 'vitest'
import { completionRange } from '../../src/renderer/src/editor/wikilinks'

test('finds the link being typed', () => {
  expect(completionRange('see [[Roh')).toEqual({ from: 6, query: 'Roh' })
  expect(completionRange('[[')).toEqual({ from: 2, query: '' })
  expect(completionRange('[[a]] and [[b c')).toEqual({ from: 12, query: 'b c' })
})

test('no completion outside an open link', () => {
  expect(completionRange('see [[Robin]] and')).toBeNull()
  expect(completionRange('plain')).toBeNull()
  expect(completionRange('[[a|b')).toBeNull()
})
