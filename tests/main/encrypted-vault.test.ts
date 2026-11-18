import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, expect, test } from 'vitest'
import { createKeyring, type Keys } from '../../src/main/crypto'
import { NotesService } from '../../src/main/services/notes'
import { TasksService } from '../../src/main/services/tasks'
import { Vault } from '../../src/main/vault'
import { VaultIndex } from '../../src/main/vault-index'

const LIGHT = { N: 1024, r: 8, p: 1 }
let root: string
let keys: Keys
let v: Vault
beforeEach(async () => {
  root = join(mkdtempSync(join(tmpdir(), 'cockpit-enc-')), 'vault')
  mkdirSync(root)
  keys = (await createKeyring('correct horse battery', LIGHT)).keys
  v = new Vault(root, async () => undefined, keys)
  await v.ensureSkeleton()
})

/** every path and every file's bytes under the folder, as one haystack */
function everythingOnDisk(dir = root): string {
  let out = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    out += `\n${p}\n`
    out += entry.isDirectory() ? everythingOnDisk(p) : readFileSync(p).toString('latin1')
  }
  return out
}

test('reads back what was written, through the same interface as a plain folder', async () => {
  const hash = await v.write('Projects/Launch/Launch.md', '# Launch\n\nAsk Robin about tiering.\n')
  expect(await v.read('Projects/Launch/Launch.md')).toEqual({ text: '# Launch\n\nAsk Robin about tiering.\n', hash })
  expect(await v.exists('Projects/Launch/Launch.md')).toBe(true)
  expect(await v.exists('Projects/Launch/Nope.md')).toBe(false)
  expect(await v.listMarkdown()).toEqual(['Habits.md', 'Inbox/Tasks.md', 'Projects/Launch/Launch.md'])
  expect(await v.listDirs('Projects')).toEqual(['Launch'])
  expect(v.encrypted).toBe(true)
})

test('nothing readable reaches the disk: not contents, not file names, not folder names', async () => {
  await v.write('Projects/Client pilot/Pricing ideas.md', 'Something private about Robin Hale.\n')
  await v.write('Diary/2026/2026-11-12.md', '---\ndate: 2026-11-12\n---\nDear diary, zebracorn.\n')
  await v.writeAttachment(Buffer.from('PNGDATA-secret-pixels'), 'whiteboard photo.png')
  const disk = everythingOnDisk()
  for (const secret of [
    'Robin', 'private', 'zebracorn', 'Client', 'Pricing', 'Diary', '2026-11-12', 'Projects', 'Inbox', 'Tasks',
    'Habits', 'Attachments', 'whiteboard', 'secret-pixels', '.md', '.png'
  ]) {
    expect(disk.includes(secret), `"${secret}" is visible on disk`).toBe(false)
  }
})

test('create refuses to overwrite, save keeps both versions, move and remove work', async () => {
  await v.create('Inbox/A.md', 'one')
  await expect(v.create('Inbox/A.md', 'two')).rejects.toThrow('already exists')
  const base = (await v.read('Inbox/A.md')).hash
  await v.write('Inbox/A.md', 'changed elsewhere')
  const saved = await v.save('Inbox/A.md', 'mine', base)
  expect((await v.read('Inbox/A.md')).text).toBe('mine')
  expect((await v.read(saved.conflictCopy!)).text).toBe('changed elsewhere')
  await v.move('Inbox/A.md', 'Projects/P/A.md')
  expect(await v.exists('Inbox/A.md')).toBe(false)
  expect((await v.read('Projects/P/A.md')).text).toBe('mine')
  await expect(v.move('Projects/P/A.md', 'Inbox/Tasks.md')).rejects.toThrow()
  expect(() => v.abs('../outside.md')).toThrow('outside vault')
})

test('attachments are encrypted and come back byte for byte', async () => {
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
  const rel = await v.writeAttachment(bytes, 'clip.mp4')
  expect(rel).toBe('Attachments/clip.mp4')
  expect((await v.readBytes(rel)).equals(bytes)).toBe(true)
  expect(await v.writeAttachment(bytes, 'clip.mp4')).toBe('Attachments/clip 1.mp4')
  expect((await v.listAll()).filter((f) => f.startsWith('Attachments/'))).toEqual(['Attachments/clip 1.mp4', 'Attachments/clip.mp4'])
})

test('files that are not ours are left alone and ignored', async () => {
  writeFileSync(join(root, 'stray-plain-note.md'), 'I was dropped in by hand')
  writeFileSync(join(root, '.DS_Store'), 'x')
  expect(await v.listMarkdown()).toEqual(['Habits.md', 'Inbox/Tasks.md'])
  expect(readFileSync(join(root, 'stray-plain-note.md'), 'utf8')).toBe('I was dropped in by hand')
})

test('a damaged file is reported, not read as empty or garbage', async () => {
  await v.write('Inbox/A.md', 'intact')
  const file = v.abs('Inbox/A.md')
  const bytes = readFileSync(file)
  bytes[bytes.length - 3] ^= 0xff
  writeFileSync(file, bytes)
  await expect(v.read('Inbox/A.md')).rejects.toThrow('cannot be decrypted')
})

test('a physical path maps back to its real path, for the file watcher', async () => {
  await v.write('Projects/Launch/Launch.md', 'x')
  const physical = v.abs('Projects/Launch/Launch.md').slice(root.length + 1)
  expect(physical).not.toContain('Launch')
  expect(v.logical(physical)).toBe('Projects/Launch/Launch.md')
  expect(v.logical('stray-plain-note.md')).toBeNull()
  expect(v.logical('cockpit.vault.json')).toBeNull()
})

test('the index and the services run unchanged on top of an encrypted folder', async () => {
  const ix = await VaultIndex.build(v)
  const notes = new NotesService(v, ix)
  const tasks = new TasksService(v, ix, () => '2026-11-12')
  await notes.createContainer('project', 'Launch')
  await notes.create('Projects/Launch', 'Robin')
  await v.write('Projects/Launch/Launch.md', '---\nstatus: active\n---\nAsk [[Robin]].\n')
  ix.upsert('Projects/Launch/Launch.md', (await v.read('Projects/Launch/Launch.md')).text)
  await tasks.add({ title: 'Send deck', container: 'Projects/Launch', due: '2026-11-12' })
  expect(await notes.rename('Projects/Launch/Robin.md', 'Robin Hale')).toBe('Projects/Launch/Robin Hale.md')
  expect((await v.read('Projects/Launch/Launch.md')).text).toContain('[[Robin Hale]]')
  expect(await notes.archive('Projects/Launch')).toBe('Archive/Launch')
  expect(await notes.unarchive('Archive/Launch')).toBe('Projects/Launch')
  const rebuilt = await VaultIndex.build(v)
  expect(rebuilt.tasks().map((t) => t.title)).toEqual(['Send deck'])
  expect(rebuilt.search('tiering')).toEqual([])
  expect(rebuilt.search('Robin').map((h) => h.name)).toContain('Robin Hale')
  expect(everythingOnDisk().includes('Send deck')).toBe(false)
})

test('a plain folder still behaves exactly as before', async () => {
  const plainRoot = join(mkdtempSync(join(tmpdir(), 'cockpit-plain-')), 'vault')
  mkdirSync(plainRoot)
  const plain = new Vault(plainRoot)
  await plain.write('Inbox/A.md', 'readable')
  expect(readFileSync(join(plainRoot, 'Inbox/A.md'), 'utf8')).toBe('readable')
  expect(plain.encrypted).toBe(false)
  expect(plain.logical('Inbox/A.md')).toBe('Inbox/A.md')
  expect((await plain.readBytes('Inbox/A.md')).toString()).toBe('readable')
  expect(await plain.listAll()).toEqual(['Inbox/A.md'])
})
