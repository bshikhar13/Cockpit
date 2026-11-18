import { beforeEach, expect, test } from 'vitest'
import type { VaultIndex } from '../../src/main/vault-index'
import { tempVault } from './helpers'

let ix: VaultIndex
beforeEach(async () => {
  ;({ ix } = await tempVault({
    'Projects/Launch/Launch.md': '---\nstatus: active\narea: Studio\n---\nAsk [[Robin]] about tiering.\n',
    'Projects/Launch/Tasks.md': '- [ ] Deck 📅 2026-11-12 🆔 aaaaaa\n- [ ] Pricing 🆔 bbbbbb\n',
    'Areas/Job/Job.md': 'Day job notes about quarterly planning.\n',
    'Areas/Job/Tasks.md': '- [ ] Review PRs 🆔 cccccc\n',
    'Inbox/Robin.md': 'Met at the conference.\n',
    'Archive/Old/Old.md': 'old\n',
    'Archive/Old/Tasks.md': '- [ ] Dead task 🆔 dddddd\n',
    'Diary/2026/2026-11-10.md': '---\ndate: 2026-11-10\nhabits:\n  Run: true\n---\nWorked on [[Launch]].\n'
  }))
})

test('lists notes without task files or the habits file', () => {
  expect(ix.notes().map((n) => n.name).sort()).toEqual(['2026-11-10', 'Job', 'Launch', 'Old', 'Robin'])
})

test('resolves names case-insensitively and finds backlinks', () => {
  expect(ix.resolve('robin')?.rel).toBe('Inbox/Robin.md')
  expect(ix.resolve('nobody')).toBeNull()
  expect(ix.backlinks('Robin').map((n) => n.rel)).toEqual(['Projects/Launch/Launch.md'])
  expect(ix.backlinks('Launch').map((n) => n.rel)).toEqual(['Diary/2026/2026-11-10.md'])
  expect(ix.linkers('launch')).toEqual(['Diary/2026/2026-11-10.md'])
})

test('lists tasks with their container, excluding archived ones', () => {
  expect(ix.tasks()).toHaveLength(3)
  expect(ix.tasks().find((t) => t.id === 'aaaaaa')).toMatchObject({
    container: 'Projects/Launch', containerName: 'Launch', containerKind: 'project',
    file: 'Projects/Launch/Tasks.md', line: 0, due: '2026-11-12'
  })
  expect(ix.tasks().find((t) => t.id === 'dddddd')).toBeUndefined()
})

test('reads habit ticks from diary files in a date range', () => {
  expect(ix.habitTicks('2026-11-01', '2026-11-30')).toEqual({ '2026-11-10': { Run: true } })
  expect(ix.habitTicks('2026-12-01', '2026-12-31')).toEqual({})
  expect(ix.diaryFiles()).toEqual(['Diary/2026/2026-11-10.md'])
})

test('searches titles by prefix and bodies by word', () => {
  expect(ix.search('rob')[0].rel).toBe('Inbox/Robin.md')
  const hit = ix.search('quarterly')[0]
  expect(hit.rel).toBe('Areas/Job/Job.md')
  expect(hit.snippet).toContain('quarterly')
  expect(ix.search('')).toEqual([])
})

test('builds the sidebar tree', () => {
  const tree = ix.tree()
  expect(tree.map((n) => n.name)).toEqual(['Inbox', 'Projects', 'Areas', 'Resources', 'Archive'])
  const launch = tree[1].children![0]
  expect(launch).toMatchObject({ name: 'Launch', type: 'folder', rel: 'Projects/Launch' })
  expect(launch.meta).toMatchObject({ status: 'active', area: 'Studio' })
  expect(launch.children!.map((c) => c.name)).toEqual(['Launch'])
  expect(tree[0].children!.map((c) => c.name)).toEqual(['Robin'])
})

test('reports name clashes and survives removal and updates', () => {
  ix.upsert('Inbox/Robin (1).md', 'dup')
  ix.upsert('Resources/People/robin.md', 'dup2')
  expect(ix.duplicates()).toEqual([['Inbox/Robin.md', 'Resources/People/robin.md']])
  expect(ix.resolve('Robin')?.rel).toBe('Inbox/Robin.md')
  ix.remove('Inbox/Robin.md')
  expect(ix.resolve('Robin')?.rel).toBe('Resources/People/robin.md')
  expect(ix.duplicates()).toEqual([])
  ix.upsert('Projects/Launch/Tasks.md', '')
  expect(ix.tasks()).toHaveLength(1)
  expect(ix.search('conference')).toEqual([])
})
