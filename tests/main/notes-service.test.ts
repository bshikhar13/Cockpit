import { beforeEach, expect, test } from 'vitest'
import { readFrontmatter } from '../../src/core/frontmatter'
import { NotesService } from '../../src/main/services/notes'
import type { Vault } from '../../src/main/vault'
import type { VaultIndex } from '../../src/main/vault-index'
import { tempVault } from './helpers'

let v: Vault
let ix: VaultIndex
let s: NotesService
let trashed: string[]
beforeEach(async () => {
  ;({ v, ix, trashed } = await tempVault())
  s = new NotesService(v, ix)
})

test('creates notes in Inbox by default and refuses clashes and bad names', async () => {
  expect(await s.create(null, 'Idea')).toBe('Inbox/Idea.md')
  expect(ix.resolve('Idea')?.rel).toBe('Inbox/Idea.md')
  await expect(s.create(null, 'idea')).rejects.toThrow('already exists')
  await expect(s.create(null, 'a/b')).rejects.toThrow('cannot contain')
  await expect(s.create(null, '..')).rejects.toThrow()
  expect(await v.exists('Inbox/a')).toBe(false)
  expect((await v.listMarkdown()).filter((r) => r.startsWith('Inbox/'))).toEqual(['Inbox/Idea.md', 'Inbox/Tasks.md'])
})

test('creates a project with a home note, frontmatter, and a task file', async () => {
  expect(await s.createContainer('project', 'Launch', { area: 'Studio' })).toBe('Projects/Launch/Launch.md')
  expect(readFrontmatter((await v.read('Projects/Launch/Launch.md')).text)).toEqual({ status: 'active', area: 'Studio' })
  expect(await v.exists('Projects/Launch/Tasks.md')).toBe(true)
  expect(await s.createContainer('area', 'Job')).toBe('Areas/Job/Job.md')
  expect(await v.exists('Areas/Job/Tasks.md')).toBe(true)
  expect(await s.createContainer('resource', 'Pricing')).toBe('Resources/Pricing/Pricing.md')
  expect(await v.exists('Resources/Pricing/Tasks.md')).toBe(false)
  await expect(s.createContainer('area', 'launch')).rejects.toThrow('already exists')
})

test('a link to a missing note creates it in Inbox once', async () => {
  expect(await s.openOrCreateByName('Robin')).toBe('Inbox/Robin.md')
  expect(await s.openOrCreateByName('robin')).toBe('Inbox/Robin.md')
})

test('rename rewrites links everywhere, diary included, and nothing else', async () => {
  await s.create(null, 'Robin')
  await v.write('Diary/2026/2026-11-10.md', '---\ndate: 2026-11-10\n---\nTalked to [[Robin]] today.\n')
  ix.upsert('Diary/2026/2026-11-10.md', (await v.read('Diary/2026/2026-11-10.md')).text)
  expect(await s.rename('Inbox/Robin.md', 'Robin Hale')).toBe('Inbox/Robin Hale.md')
  expect((await v.read('Diary/2026/2026-11-10.md')).text).toBe(
    '---\ndate: 2026-11-10\n---\nTalked to [[Robin Hale]] today.\n'
  )
  expect(ix.backlinks('Robin Hale')).toHaveLength(1)
  expect(ix.resolve('Robin')).toBeNull()
  await s.create(null, 'Other')
  await expect(s.rename('Inbox/Other.md', 'robin hale')).rejects.toThrow('already exists')
  await expect(s.rename('Inbox/Other.md', 'x|y')).rejects.toThrow('cannot contain')
  expect(await v.exists('Inbox/Other.md')).toBe(true)
})

test('a note can be renamed to a different capitalisation of itself', async () => {
  await s.create(null, 'robin')
  expect(await s.rename('Inbox/robin.md', 'Robin')).toBe('Inbox/Robin.md')
  expect(ix.resolve('Robin')?.rel).toBe('Inbox/Robin.md')
})

test('renaming a home note renames its folder and follows area references', async () => {
  await s.createContainer('area', 'Studio')
  await s.createContainer('project', 'Launch', { area: 'Studio' })
  await s.create('Projects/Launch', 'Launch notes')
  expect(await s.rename('Projects/Launch/Launch.md', 'Launch v2')).toBe('Projects/Launch v2/Launch v2.md')
  expect(await v.exists('Projects/Launch v2/Tasks.md')).toBe(true)
  expect(ix.resolve('Launch notes')?.rel).toBe('Projects/Launch v2/Launch notes.md')
  expect(await v.exists('Projects/Launch')).toBe(false)
  await s.rename('Areas/Studio/Studio.md', 'Alpha')
  expect(readFrontmatter((await v.read('Projects/Launch v2/Launch v2.md')).text).area).toBe('Alpha')
})

test('diary pages and task files cannot be renamed or moved', async () => {
  await v.write('Diary/2026/2026-11-10.md', 'x')
  ix.upsert('Diary/2026/2026-11-10.md', 'x')
  await expect(s.rename('Diary/2026/2026-11-10.md', 'Nope')).rejects.toThrow()
  await expect(s.rename('Inbox/Tasks.md', 'Nope')).rejects.toThrow()
  await expect(s.move('Inbox/Tasks.md', 'Projects')).rejects.toThrow()
})

test('archive hides tasks and unarchive restores the original place', async () => {
  await s.createContainer('project', 'Launch')
  await v.write('Projects/Launch/Tasks.md', '- [ ] Deck 🆔 aaaaaa\n')
  ix.upsert('Projects/Launch/Tasks.md', '- [ ] Deck 🆔 aaaaaa\n')
  expect(ix.tasks()).toHaveLength(1)
  expect(await s.archive('Projects/Launch')).toBe('Archive/Launch')
  expect(ix.tasks()).toEqual([])
  expect(ix.resolve('Launch')?.rel).toBe('Archive/Launch/Launch.md')
  expect(await s.unarchive('Archive/Launch')).toBe('Projects/Launch')
  expect(ix.tasks()).toHaveLength(1)
  expect(readFrontmatter((await v.read('Projects/Launch/Launch.md')).text)).toEqual({ status: 'active' })
  await s.createContainer('area', 'Job')
  await s.archive('Areas/Job')
  expect(await s.unarchive('Archive/Job')).toBe('Areas/Job')
})

test('moves a note between folders', async () => {
  await s.create(null, 'Idea')
  await s.createContainer('project', 'Launch')
  expect(await s.move('Inbox/Idea.md', 'Projects/Launch')).toBe('Projects/Launch/Idea.md')
  expect(ix.resolve('Idea')?.rel).toBe('Projects/Launch/Idea.md')
})

test('project meta can be set and cleared', async () => {
  const rel = await s.createContainer('project', 'Launch')
  await s.setProjectMeta(rel, { status: 'done', deadline: '2026-12-01', area: 'Job' })
  expect(readFrontmatter((await v.read(rel)).text)).toEqual({ status: 'done', deadline: '2026-12-01', area: 'Job' })
  await s.setProjectMeta(rel, { deadline: null })
  expect(readFrontmatter((await v.read(rel)).text)).toEqual({ status: 'done', area: 'Job' })
})

test('attachments are linked relative to the note, with spaces encoded', async () => {
  expect(await s.importAttachment(new Uint8Array([1]), 'my pic.png', 'Diary/2026/2026-11-10.md')).toBe(
    '![](../../Attachments/my%20pic.png)'
  )
  expect(await s.importAttachment(new Uint8Array([1]), 'a.mp4', 'Inbox/Idea.md')).toBe('![](../Attachments/a.mp4)')
})

test('remove sends a note to the trash and drops it from the index', async () => {
  await s.create(null, 'Idea')
  await s.remove('Inbox/Idea.md')
  expect(trashed).toHaveLength(1)
  expect(ix.resolve('Idea')).toBeNull()
})
