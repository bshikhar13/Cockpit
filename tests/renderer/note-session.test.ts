import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { flushAll, NoteSession, type NoteIo } from '../../src/renderer/src/editor/noteSession'
import { withFlush } from '../../src/renderer/src/flushGuard'

interface Fake extends NoteIo {
  disk: string
  saves: { text: string; baseHash: string | null }[]
  failNext: number
}
const hashOf = (t: string): string => `h:${t}`
function fakeIo(initial: string): Fake {
  const io: Fake = {
    disk: initial,
    saves: [],
    failNext: 0,
    async read() {
      return { text: io.disk, hash: hashOf(io.disk) }
    },
    async save(_rel, text, baseHash) {
      if (io.failNext > 0) {
        io.failNext--
        throw new Error('disk unavailable')
      }
      io.saves.push({ text, baseHash })
      const conflictCopy = baseHash !== hashOf(io.disk) ? 'Note (conflict).md' : undefined
      io.disk = text
      return { hash: hashOf(text), conflictCopy }
    }
  }
  return io
}
function start(initial = 'hello') {
  const io = fakeIo(initial)
  const seen = { loaded: [] as string[], conflicts: [] as string[], errors: [] as (string | null)[] }
  const session = new NoteSession('Inbox/Note.md', io, {
    onLoaded: (t) => seen.loaded.push(t),
    onConflict: (c) => seen.conflicts.push(c),
    onError: (e) => seen.errors.push(e)
  })
  return { io, seen, session }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('saves once, shortly after the owner stops typing, against the version they started from', async () => {
  const { io, session } = start()
  await session.load()
  session.change('hello w')
  await vi.advanceTimersByTimeAsync(300)
  session.change('hello world')
  await vi.advanceTimersByTimeAsync(599)
  expect(io.saves).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(io.saves).toEqual([{ text: 'hello world', baseHash: 'h:hello' }])
  expect(session.dirty).toBe(false)
})

test('never writes when the text is what is already on disk', async () => {
  const { io, session } = start()
  await session.load()
  session.change('hello!')
  session.change('hello')
  await vi.advanceTimersByTimeAsync(5000)
  await session.flush()
  expect(io.saves).toEqual([])
})

test('flush saves straight away', async () => {
  const { io, session } = start()
  await session.load()
  session.change('now')
  await session.flush()
  expect(io.disk).toBe('now')
})

test('a failed save is reported, retried, and then cleared', async () => {
  const { io, seen, session } = start()
  await session.load()
  io.failNext = 2
  session.change('keep me')
  await vi.advanceTimersByTimeAsync(600)
  expect(io.disk).toBe('hello')
  expect(session.dirty).toBe(true)
  expect(seen.errors.at(-1)).toMatch(/Could not save/)
  await vi.advanceTimersByTimeAsync(3000)
  await vi.advanceTimersByTimeAsync(3000)
  expect(io.disk).toBe('keep me')
  expect(seen.errors.at(-1)).toBeNull()
})

test('a change on disk is picked up when there are no unsaved edits', async () => {
  const { io, seen, session } = start()
  await session.load()
  io.disk = 'changed elsewhere'
  await session.load()
  expect(seen.loaded).toEqual(['hello', 'changed elsewhere'])
})

test('a change on disk during unsaved edits keeps the owner text and reports the conflict copy', async () => {
  const { io, seen, session } = start()
  await session.load()
  session.change('mine')
  io.disk = 'changed elsewhere'
  await session.load()
  expect(seen.loaded).toEqual(['hello'])
  await session.flush()
  expect(io.disk).toBe('mine')
  expect(seen.conflicts).toEqual(['Note (conflict).md'])
})

test('flushAll saves every open note, including one whose screen has just closed', async () => {
  const a = start('a')
  const b = start('b')
  await a.session.load()
  await b.session.load()
  a.session.change('a2')
  b.session.change('b2')
  void b.session.dispose()
  await flushAll()
  expect([a.io.disk, b.io.disk]).toEqual(['a2', 'b2'])
  await a.session.dispose()
})

test('structural operations save open notes first', async () => {
  const order: string[] = []
  const api = {
    notes: { rename: async () => void order.push('rename'), read: async () => void order.push('read') },
    para: { archive: async () => void order.push('archive') }
  }
  const guarded = withFlush(api, async () => void order.push('flush'), ['notes.rename', 'para.archive'])
  await guarded.notes.rename()
  await guarded.notes.read()
  await guarded.para.archive()
  expect(order).toEqual(['flush', 'rename', 'read', 'flush', 'archive'])
})
