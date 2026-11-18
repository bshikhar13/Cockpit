import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, expect, test } from 'vitest'
import {
  changeFolderPasscode, copyVault, createEncryptedFolder, isEncrypted, unlockFolder
} from '../../src/main/encryption'
import { CONFIG_FILE, Vault } from '../../src/main/vault'

const LIGHT = { N: 1024, r: 8, p: 1 }
const PASS = 'correct horse battery'
let tmp: string
let root: string
let backups: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cockpit-encf-'))
  root = join(tmp, 'encrypted')
  backups = join(tmp, 'userdata')
  mkdirSync(root)
  mkdirSync(backups)
})

test('a new encrypted folder can be unlocked with the passcode or the recovery key, and with nothing else', async () => {
  expect(await isEncrypted(root)).toBe(false)
  const made = await createEncryptedFolder(root, PASS, backups, LIGHT)
  expect(await isEncrypted(root)).toBe(true)
  const v = new Vault(root, undefined, made.keys)
  await v.write('Inbox/A.md', 'private')
  for (const secret of [PASS, made.recoveryKey]) {
    const again = new Vault(root, undefined, await unlockFolder(root, secret, backups))
    expect((await again.read('Inbox/A.md')).text).toBe('private')
  }
  await expect(unlockFolder(root, 'wrong passcode here', backups)).rejects.toThrow('Wrong passcode')
})

test('only an empty folder can be made into an encrypted one', async () => {
  writeFileSync(join(root, 'existing.md'), 'already here')
  await expect(createEncryptedFolder(root, PASS, backups, LIGHT)).rejects.toThrow('empty')
  expect(readdirSync(root)).toEqual(['existing.md'])
  rmSync(join(root, 'existing.md'))
  writeFileSync(join(root, '.DS_Store'), 'x') // Finder litter does not count
  await createEncryptedFolder(root, PASS, backups, LIGHT)
  await expect(createEncryptedFolder(root, PASS, backups, LIGHT)).rejects.toThrow()
})

test('the passcode can be changed without touching any note', async () => {
  const made = await createEncryptedFolder(root, PASS, backups, LIGHT)
  const v = new Vault(root, undefined, made.keys)
  await v.write('Inbox/A.md', 'private')
  const before = readFileSync(v.abs('Inbox/A.md'))
  await changeFolderPasscode(root, PASS, 'a brand new passcode', backups)
  expect(readFileSync(v.abs('Inbox/A.md')).equals(before)).toBe(true)
  await expect(unlockFolder(root, PASS, backups)).rejects.toThrow('Wrong passcode')
  const again = new Vault(root, undefined, await unlockFolder(root, 'a brand new passcode', backups))
  expect((await again.read('Inbox/A.md')).text).toBe('private')
  await unlockFolder(root, made.recoveryKey, backups)
})

test('if the settings file goes missing from the folder, the kept copy restores it', async () => {
  const made = await createEncryptedFolder(root, PASS, backups, LIGHT)
  const v = new Vault(root, undefined, made.keys)
  await v.write('Inbox/A.md', 'private')
  rmSync(join(root, CONFIG_FILE))
  const keys = await unlockFolder(root, PASS, backups)
  expect(existsSync(join(root, CONFIG_FILE))).toBe(true)
  expect((await new Vault(root, undefined, keys).read('Inbox/A.md')).text).toBe('private')
})

test('with no settings file anywhere, unlocking fails clearly; a damaged one is not trusted', async () => {
  await createEncryptedFolder(root, PASS, backups, LIGHT)
  rmSync(join(root, CONFIG_FILE))
  await expect(unlockFolder(root, PASS, join(tmp, 'other-machine'))).rejects.toThrow('settings file is missing')
  writeFileSync(join(root, CONFIG_FILE), '{ not json')
  await expect(unlockFolder(root, PASS, join(tmp, 'other-machine'))).rejects.toThrow('damaged')
})

test('copying plain notes into an encrypted folder brings everything across, verified', async () => {
  const plainRoot = join(tmp, 'plain')
  mkdirSync(plainRoot)
  const plain = new Vault(plainRoot)
  await plain.ensureSkeleton()
  await plain.write('Diary/2026/2026-11-12.md', '---\ndate: 2026-11-12\nhabits:\n  Run: true\n---\nDear diary.\r\nWindows line.\r\n')
  await plain.write('Projects/Launch/Tasks.md', '- [ ] Send deck 📅 2026-11-12 🆔 aaaaaa\n')
  await plain.writeAttachment(Buffer.from([0, 255, 1, 254]), 'pic.png')
  writeFileSync(join(plainRoot, 'Resources', 'loose.txt'), 'not markdown, still mine')

  const made = await createEncryptedFolder(root, PASS, backups, LIGHT)
  const enc = new Vault(root, undefined, made.keys)
  const copied = await copyVault(plain, enc)
  expect(copied).toBe((await plain.listAll()).length)
  expect(await enc.listAll()).toEqual(await plain.listAll())
  for (const rel of await plain.listAll()) {
    expect((await enc.readBytes(rel)).equals(await plain.readBytes(rel)), rel).toBe(true)
  }
  // the original is untouched
  expect(readFileSync(join(plainRoot, 'Projects/Launch/Tasks.md'), 'utf8')).toContain('Send deck')
})

test('a copy that cannot be verified stops with an error', async () => {
  const plainRoot = join(tmp, 'plain')
  mkdirSync(plainRoot)
  const plain = new Vault(plainRoot)
  await plain.write('Inbox/A.md', 'one')
  const made = await createEncryptedFolder(root, PASS, backups, LIGHT)
  const enc = new Vault(root, undefined, made.keys)
  const broken = Object.create(enc) as Vault
  broken.readBytes = async () => Buffer.from('not what was written')
  await expect(copyVault(plain, broken)).rejects.toThrow('could not be verified')
})
