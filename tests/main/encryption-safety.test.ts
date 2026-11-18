import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { beforeEach, expect, test } from 'vitest'
import { createEncryptedFolder, detectEncrypted, encryptInto, unlockFolder } from '../../src/main/encryption'
import { CONFIG_FILE, Vault } from '../../src/main/vault'
import { VaultIndex } from '../../src/main/vault-index'

const LIGHT = { N: 1024, r: 8, p: 1 }
const PASS = 'correct horse battery'
let tmp: string
let root: string
let backups: string
let plainRoot: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cockpit-encs-'))
  root = join(tmp, 'encrypted')
  backups = join(tmp, 'userdata')
  plainRoot = join(tmp, 'plain')
  for (const d of [root, backups, plainRoot]) mkdirSync(d)
})

test('a Google Drive duplicate of a note is listed, readable, indexed, and can be renamed', async () => {
  const { keys } = await createEncryptedFolder(root, PASS, backups, LIGHT)
  const v = new Vault(root, undefined, keys)
  await v.write('Inbox/Note.md', 'this Mac')
  const physical = v.abs('Inbox/Note.md')
  copyFileSync(physical, physical + ' (1)') // what Drive does when two Macs change the same file
  writeFileSync(physical + ' (1)', readFileSync(physical)) // same bytes is fine; it is the name that matters
  const other = new Vault(root, undefined, keys) // a fresh start, as at launch
  expect(await other.listMarkdown()).toEqual(['Inbox/Note (1).md', 'Inbox/Note.md'])
  expect((await other.read('Inbox/Note (1).md')).text).toBe('this Mac')
  const ix = await VaultIndex.build(other)
  expect(ix.notes().map((n) => n.rel)).toEqual(['Inbox/Note (1).md', 'Inbox/Note.md'])
  await other.move('Inbox/Note (1).md', 'Inbox/Note from other Mac.md')
  expect(await new Vault(root, undefined, keys).listMarkdown()).toEqual(['Inbox/Note from other Mac.md', 'Inbox/Note.md'])
})

test('a duplicated folder keeps every note inside it reachable', async () => {
  const { keys } = await createEncryptedFolder(root, PASS, backups, LIGHT)
  const v = new Vault(root, undefined, keys)
  await v.write('Projects/Launch/Launch.md', 'home')
  const folder = dirname(v.abs('Projects/Launch/Launch.md'))
  cpSync(folder, folder + ' (1)', { recursive: true })
  const other = new Vault(root, undefined, keys)
  expect(await other.listMarkdown()).toEqual(['Projects/Launch (1)/Launch.md', 'Projects/Launch/Launch.md'])
  expect((await other.read('Projects/Launch (1)/Launch.md')).text).toBe('home')
  expect(other.logical(other.abs('Projects/Launch (1)/Launch.md').slice(root.length + 1))).toBe('Projects/Launch (1)/Launch.md')
})

test('a damaged settings file in the folder does not lock the owner out when the kept copy is good', async () => {
  const { keys } = await createEncryptedFolder(root, PASS, backups, LIGHT)
  await new Vault(root, undefined, keys).write('Inbox/A.md', 'private')
  writeFileSync(join(root, CONFIG_FILE), '') // half-synced
  const again = await unlockFolder(root, PASS, backups)
  expect((await new Vault(root, undefined, again).read('Inbox/A.md')).text).toBe('private')
  expect(JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8')).format).toBe(1) // put back
  await expect(unlockFolder(root, 'wrong passcode here', backups)).rejects.toThrow('Wrong passcode')
})

test('a settings file from some other folder does not lock the owner out either, and is not trusted', async () => {
  const { keys } = await createEncryptedFolder(root, PASS, backups, LIGHT)
  await new Vault(root, undefined, keys).write('Inbox/A.md', 'private')
  const foreignRoot = join(tmp, 'foreign')
  mkdirSync(foreignRoot)
  await createEncryptedFolder(foreignRoot, 'a different passcode!', join(tmp, 'foreign-data'), LIGHT)
  copyFileSync(join(foreignRoot, CONFIG_FILE), join(root, CONFIG_FILE))
  const again = await unlockFolder(root, PASS, backups)
  expect((await new Vault(root, undefined, again).read('Inbox/A.md')).text).toBe('private')
  // the foreign passcode opens the foreign keys, which cannot read this folder: refused
  await expect(unlockFolder(root, 'a different passcode!', backups)).rejects.toThrow('Wrong passcode')
})

test('an encrypted folder is recognised as one even when its settings file is gone', async () => {
  expect(await detectEncrypted(plainRoot, backups)).toBe(false)
  writeFileSync(join(plainRoot, 'note.md'), 'plain')
  expect(await detectEncrypted(plainRoot, backups)).toBe(false)

  const { keys } = await createEncryptedFolder(root, PASS, backups, LIGHT)
  await new Vault(root, undefined, keys).ensureSkeleton()
  expect(await detectEncrypted(root, backups)).toBe(true)
  rmSync(join(root, CONFIG_FILE))
  expect(await detectEncrypted(root, backups)).toBe(true) // the kept copy says so
  expect(await detectEncrypted(root, join(tmp, 'another-mac'))).toBe(true) // and so do the files themselves
})

test('encrypting copies everything into the new folder and returns the keys and recovery key', async () => {
  const plain = new Vault(plainRoot)
  await plain.ensureSkeleton()
  await plain.write('Projects/Launch/Launch.md', 'home')
  const made = await encryptInto(plain, root, PASS, backups, LIGHT)
  expect(made.recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  const enc = new Vault(root, undefined, made.keys)
  expect(await enc.listAll()).toEqual(await plain.listAll())
  expect((await enc.read('Projects/Launch/Launch.md')).text).toBe('home')
  const fresh = await encryptInto(null, join(tmp, 'fresh-empty'), PASS, backups, LIGHT).catch((e) => e)
  expect(String(fresh)).toContain('not available') // the folder must already exist
})

test('the new folder cannot be inside the current notes, nor the other way round', async () => {
  const plain = new Vault(plainRoot)
  await plain.write('Inbox/A.md', 'one')
  const inside = join(plainRoot, 'Encrypted')
  mkdirSync(inside)
  await expect(encryptInto(plain, inside, PASS, backups, LIGHT)).rejects.toThrow('separate')
  expect(readdirSync(inside)).toEqual([])
  const nestedSource = new Vault(join(root, 'notes'))
  mkdirSync(join(root, 'notes'))
  await expect(encryptInto(nestedSource, root, PASS, backups, LIGHT)).rejects.toThrow()
  await expect(encryptInto(plain, plainRoot, PASS, backups, LIGHT)).rejects.toThrow('separate')
})

test('a name too long to encrypt is found before anything is created, and named', async () => {
  const plain = new Vault(plainRoot)
  const long = 'न'.repeat(60) // 180 bytes: fine in a plain folder, too long once scrambled
  await plain.write(`Inbox/${long}.md`, 'x')
  await plain.write('Inbox/Fine.md', 'y')
  const err = await encryptInto(plain, root, PASS, backups, LIGHT).catch((e: Error) => e.message)
  expect(err).toContain('too long')
  expect(err).toContain(long.slice(0, 10))
  expect(readdirSync(root)).toEqual([]) // not even the settings file
})

test('a copy that fails part-way leaves the new folder empty, so it can be tried again', async () => {
  const plain = new Vault(plainRoot)
  await plain.write('Inbox/A.md', 'one')
  await plain.write('Inbox/B.md', 'two')
  const flaky = Object.create(plain) as Vault
  flaky.readBytes = async (rel: string) => {
    if (rel === 'Inbox/B.md') throw new Error('disk hiccup')
    return plain.readBytes(rel)
  }
  await expect(encryptInto(flaky, root, PASS, backups, LIGHT)).rejects.toThrow('disk hiccup')
  expect(readdirSync(root)).toEqual([])
  const made = await encryptInto(plain, root, PASS, backups, LIGHT)
  expect(await new Vault(root, undefined, made.keys).listAll()).toEqual(['Inbox/A.md', 'Inbox/B.md'])
})

test('a note that cannot be decrypted is reported, not silently missing', async () => {
  const { keys } = await createEncryptedFolder(root, PASS, backups, LIGHT)
  const v = new Vault(root, undefined, keys)
  await v.write('Inbox/Good.md', 'fine')
  await v.write('Inbox/Hurt.md', 'will be damaged')
  const file = v.abs('Inbox/Hurt.md')
  writeFileSync(file, readFileSync(file).subarray(0, 12))
  const ix = await VaultIndex.build(v)
  expect(ix.notes().map((n) => n.name)).toEqual(['Good'])
  expect(ix.unreadable()).toEqual(['Inbox/Hurt.md'])
  ix.upsert('Inbox/Hurt.md', 'repaired')
  expect(ix.unreadable()).toEqual([])
})
