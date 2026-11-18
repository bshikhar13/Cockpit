import { expect, test } from 'vitest'
import { createState } from '../../src/renderer/src/editor/livePreview'
import { findMedia, insertionFor } from '../../src/renderer/src/editor/media'

test('finds images and videos, ignoring code', () => {
  const s = createState('![a](../../Attachments/p.png)\ntext ![](clip.MOV) more\n`![](no.png)`\n![x](https://e.com/i.jpg)\n')
  expect(findMedia(s).map((m) => [m.path, m.type, m.alt])).toEqual([
    ['../../Attachments/p.png', 'image', 'a'],
    ['clip.MOV', 'video', ''],
    ['https://e.com/i.jpg', 'image', 'x']
  ])
  expect(findMedia(createState('![](my%20pic.png)'))[0].path).toBe('my%20pic.png')
  expect(findMedia(createState('```\n![](x.png)\n```\n'))).toEqual([])
})

test('media ranges cover exactly the markdown', () => {
  const s = createState('text ![](clip.webm) more')
  const m = findMedia(s)[0]
  expect(s.sliceDoc(m.from, m.to)).toBe('![](clip.webm)')
})

test('inserted media goes on its own line', () => {
  expect(insertionFor(createState(''), 0, '![](a.png)')).toEqual({ from: 0, insert: '![](a.png)\n' })
  const mid = createState('before after')
  expect(insertionFor(mid, 6, '![](a.png)')).toEqual({ from: 6, insert: '\n![](a.png)\n' })
  const end = createState('line\n')
  expect(insertionFor(end, 5, '![](a.png)')).toEqual({ from: 5, insert: '![](a.png)\n' })
})
