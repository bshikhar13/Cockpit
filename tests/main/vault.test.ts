import { existsSync, mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, expect, test } from 'vitest'
import { loadSettings, saveSettings } from '../../src/main/settings'
import { Vault } from '../../src/main/vault'

let tmp: string
let v: Vault
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cockpit-'))
  mkdirSync(join(tmp, 'vault'))
  v = new Vault(join(tmp, 'vault'))
})

test('a missing vault folder is reported and never created', async () => {
  expect(await Vault.isUsable(join(tmp, 'missing'))).toBe(false)
  expect(existsSync(join(tmp, 'missing'))).toBe(false)
})

test('skeleton is created once and never overwrites', async () => {
  await v.ensureSkeleton()
  expect(await Vault.isUsable(join(tmp, 'vault'))).toBe(true)
  expect(await v.exists('Inbox/Tasks.md')).toBe(true)
  expect(await v.exists('Projects')).toBe(true)
  await v.write('Habits.md', '# Habits\n\n- Run\n')
  await v.ensureSkeleton()
  expect((await v.read('Habits.md')).text).toBe('# Habits\n\n- Run\n')
})

test('paths outside the vault are refused', () => {
  expect(() => v.abs('../etc/passwd')).toThrow('outside vault')
  expect(() => v.abs('/etc/passwd')).toThrow('outside vault')
})

test('save with a current base hash writes without a conflict copy', async () => {
  const h1 = await v.write('Inbox/A.md', 'one')
  const res = await v.save('Inbox/A.md', 'two', h1)
  expect(res.conflictCopy).toBeUndefined()
  expect((await v.read('Inbox/A.md')).hash).toBe(res.hash)
})

test('save over a file that changed on disk keeps both versions', async () => {
  const h1 = await v.write('Inbox/A.md', 'one')
  await v.write('Inbox/A.md', 'changed on disk')
  const res = await v.save('Inbox/A.md', 'mine', h1)
  expect((await v.read('Inbox/A.md')).text).toBe('mine')
  expect((await v.read(res.conflictCopy!)).text).toBe('changed on disk')
  expect(res.conflictCopy).toMatch(/^Inbox\/A \(conflict \d{4}-\d{2}-\d{2} \d{6}\)\.md$/)
})

test('save of a new file needs no base hash', async () => {
  expect((await v.save('Inbox/New.md', 'x', null)).conflictCopy).toBeUndefined()
})

test('attachments get unique names', async () => {
  expect(await v.writeAttachment(new Uint8Array([1]), 'p.png')).toBe('Attachments/p.png')
  expect(await v.writeAttachment(new Uint8Array([2]), 'p.png')).toBe('Attachments/p 1.png')
  expect(await v.writeAttachment(new Uint8Array([3]), '../evil.png')).toBe('Attachments/evil.png')
})

test('move refuses to overwrite; list finds markdown only', async () => {
  await v.ensureSkeleton()
  await v.write('Inbox/A.md', 'a')
  await v.write('Inbox/.hidden.md', 'h')
  await expect(v.move('Inbox/A.md', 'Inbox/Tasks.md')).rejects.toThrow()
  await v.move('Inbox/A.md', 'Projects/P/A.md')
  const all = await v.listMarkdown()
  expect(all).toEqual(expect.arrayContaining(['Projects/P/A.md', 'Inbox/Tasks.md', 'Habits.md']))
  expect(all).not.toContain('Inbox/.hidden.md')
  expect(all).not.toContain('Inbox/A.md')
})

test('remove sends the file to the injected trash', async () => {
  const trashed: string[] = []
  const tv = new Vault(join(tmp, 'vault'), async (p) => void trashed.push(p))
  await tv.write('Inbox/A.md', 'a')
  await tv.remove('Inbox/A.md')
  expect(trashed).toEqual([join(tmp, 'vault', 'Inbox', 'A.md')])
})

test('settings default and round trip', () => {
  expect(loadSettings(tmp)).toEqual({ vaultPath: null, rolloverHour: 4, encrypted: false })
  saveSettings(tmp, { vaultPath: '/x', rolloverHour: 3, encrypted: true })
  expect(loadSettings(tmp)).toEqual({ vaultPath: '/x', rolloverHour: 3, encrypted: true })
})
