import { beforeEach, expect, test } from 'vitest'
import { HabitsService } from '../../src/main/services/habits'
import type { Vault } from '../../src/main/vault'
import { tempVault } from './helpers'

let v: Vault
let h: HabitsService
beforeEach(async () => {
  const t = await tempVault()
  v = t.v
  h = new HabitsService(v, t.ix)
  await h.add('Run')
  await h.add('Read')
})

test('add rejects empty names and duplicates in any case', async () => {
  await expect(h.add('run')).rejects.toThrow('already')
  await expect(h.add('  ')).rejects.toThrow()
  expect(await h.list()).toEqual({ active: ['Run', 'Read'], archived: [] })
})

test('ticking creates the diary file and never touches the body', async () => {
  await h.setTick('2026-11-11', 'Run', true)
  expect((await v.read('Diary/2026/2026-11-11.md')).text).toBe('---\ndate: 2026-11-11\nhabits:\n  Run: true\n---\n\n')
  await v.write('Diary/2026/2026-11-12.md', '---\ndate: 2026-11-12\n---\nMy words.\n')
  await h.setTick('2026-11-12', 'Read', true)
  expect((await v.read('Diary/2026/2026-11-12.md')).text).toBe('---\ndate: 2026-11-12\nhabits:\n  Read: true\n---\nMy words.\n')
  await h.setTick('2026-11-12', 'Read', false)
  expect((await v.read('Diary/2026/2026-11-12.md')).text).toBe('---\ndate: 2026-11-12\n---\nMy words.\n')
})

test('rename carries history across diary files', async () => {
  await h.setTick('2026-11-11', 'Run', true)
  await h.setTick('2026-11-10', 'Run', true)
  await h.rename('Run', 'Morning run')
  expect(h.history('2026-11-01', '2026-11-30')).toEqual({
    '2026-11-10': { 'Morning run': true },
    '2026-11-11': { 'Morning run': true }
  })
  expect((await h.list()).active).toEqual(['Morning run', 'Read'])
  await expect(h.rename('Read', 'morning run')).rejects.toThrow('already')
})

test('archive, unarchive, and reorder', async () => {
  await h.archive('Read')
  expect(await h.list()).toEqual({ active: ['Run'], archived: ['Read'] })
  await h.unarchive('Read')
  expect((await h.list()).active).toEqual(['Run', 'Read'])
  await h.reorder(['Read', 'Run'])
  expect((await h.list()).active).toEqual(['Read', 'Run'])
  await h.reorder(['Read'])
  expect((await h.list()).active).toEqual(['Read', 'Run'])
})
