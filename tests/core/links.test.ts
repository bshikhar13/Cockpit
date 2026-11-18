import { expect, test } from 'vitest'
import { extractWikilinks, rewriteWikilinks } from '../../src/core/links'

const t = 'See [[Pricing notes]] and [[Robin|him]].\n`[[not a link]]`\n```\n[[nor this]]\n```\n'

test('extracts links with aliases, ignoring code', () => {
  const links = extractWikilinks(t)
  expect(links.map((l) => [l.target, l.alias])).toEqual([['Pricing notes', undefined], ['Robin', 'him']])
  expect(t.slice(links[0].from, links[0].to)).toBe('[[Pricing notes]]')
})

test('rewrite changes only the target, case-insensitively', () => {
  expect(rewriteWikilinks(t, 'robin', 'Robin Hale')).toBe(
    'See [[Pricing notes]] and [[Robin Hale|him]].\n`[[not a link]]`\n```\n[[nor this]]\n```\n'
  )
  expect(rewriteWikilinks(t, 'not a link', 'X')).toBe(t)
  expect(rewriteWikilinks('no links\r\nhere', 'A', 'B')).toBe('no links\r\nhere')
  expect(rewriteWikilinks('[[A]] [[a]] [[AB]]', 'A', 'Z')).toBe('[[Z]] [[Z]] [[AB]]')
})
