import { expect, test } from 'vitest'
import {
  changePasscode, createKeyring, decryptBytes, decryptName, encryptBytes, encryptName, MIN_PASSCODE_LENGTH, unlockKeyring
} from '../../src/main/crypto'

// the real cost setting takes about half a second per attempt by design; tests use a light one
const LIGHT = { N: 1024, r: 8, p: 1 }
const PASS = 'correct horse battery'

test('a passcode unlocks the keys it created, and only that passcode', async () => {
  const made = await createKeyring(PASS, LIGHT)
  const keys = await unlockKeyring(made.config, PASS)
  expect(Buffer.from(encryptName(keys, 'x')).equals(Buffer.from(encryptName(made.keys, 'x')))).toBe(true)
  await expect(unlockKeyring(made.config, 'correct horse batterx')).rejects.toThrow('Wrong passcode')
  await expect(unlockKeyring(made.config, '')).rejects.toThrow('Wrong passcode')
})

test('the recovery key also unlocks, however it is typed', async () => {
  const made = await createKeyring(PASS, LIGHT)
  expect(made.recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
  const a = await unlockKeyring(made.config, made.recoveryKey)
  const b = await unlockKeyring(made.config, ` ${made.recoveryKey.toLowerCase().replace(/-/g, ' ')} `)
  expect(decryptName(a, encryptName(made.keys, 'note'))).toBe('note')
  expect(decryptName(b, encryptName(made.keys, 'note'))).toBe('note')
})

test('nothing secret is stored in the config', async () => {
  const made = await createKeyring(PASS, LIGHT)
  const json = JSON.stringify(made.config)
  expect(json).not.toContain(PASS)
  expect(json).not.toContain(made.recoveryKey)
  expect(json).not.toContain(made.recoveryKey.replace(/-/g, ''))
  expect(made.config.format).toBe(1)
  expect(Object.keys(made.config.slots).sort()).toEqual(['passcode', 'recovery'])
})

test('short passcodes are refused', async () => {
  expect(MIN_PASSCODE_LENGTH).toBe(12)
  await expect(createKeyring('short', LIGHT)).rejects.toThrow('at least 12')
})

test('changing the passcode keeps the same keys; the old one stops working and the recovery key still works', async () => {
  const made = await createKeyring(PASS, LIGHT)
  const next = await changePasscode(made.config, PASS, 'a brand new passcode')
  await expect(unlockKeyring(next, PASS)).rejects.toThrow('Wrong passcode')
  const keys = await unlockKeyring(next, 'a brand new passcode')
  expect(decryptName(keys, encryptName(made.keys, 'note'))).toBe('note')
  expect(decryptName(await unlockKeyring(next, made.recoveryKey), encryptName(made.keys, 'note'))).toBe('note')
  await expect(changePasscode(made.config, 'not the passcode', 'a brand new passcode')).rejects.toThrow('Wrong passcode')
  await expect(changePasscode(made.config, PASS, 'short')).rejects.toThrow('at least 12')
})

test('contents round trip, look nothing like the original, and differ every time', async () => {
  const { keys } = await createKeyring(PASS, LIGHT)
  const plain = Buffer.from('# Diary\n\nSomething private about Robin.\n'.repeat(20))
  const one = encryptBytes(keys, plain)
  const two = encryptBytes(keys, plain)
  expect(decryptBytes(keys, one).equals(plain)).toBe(true)
  expect(one.equals(two)).toBe(false)
  expect(one.includes(Buffer.from('Robin'))).toBe(false)
  expect(decryptBytes(keys, encryptBytes(keys, Buffer.alloc(0))).length).toBe(0)
})

test('tampered or foreign contents are refused, never returned as garbage', async () => {
  const { keys } = await createKeyring(PASS, LIGHT)
  const other = (await createKeyring('another passcode entirely', LIGHT)).keys
  const sealed = encryptBytes(keys, Buffer.from('private'))
  const flipped = Buffer.from(sealed)
  flipped[flipped.length - 1] ^= 1
  expect(() => decryptBytes(keys, flipped)).toThrow('cannot be decrypted')
  expect(() => decryptBytes(other, sealed)).toThrow('cannot be decrypted')
  expect(() => decryptBytes(keys, Buffer.from('just a plain file'))).toThrow('cannot be decrypted')
  expect(() => decryptBytes(keys, sealed.subarray(0, 10))).toThrow('cannot be decrypted')
})

test('names are scrambled the same way each time, safely for a file system, and come back exactly', async () => {
  const { keys } = await createKeyring(PASS, LIGHT)
  for (const name of ['Tasks.md', 'Client pilot', 'Café ☕ notes.md', '2026-11-12.md', 'a'.repeat(150)]) {
    const scrambled = encryptName(keys, name)
    expect(scrambled).toBe(encryptName(keys, name))
    expect(scrambled).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(scrambled.length).toBeLessThanOrEqual(255)
    expect(scrambled).not.toContain(name.slice(0, 4))
    expect(decryptName(keys, scrambled)).toBe(name)
  }
  expect(encryptName(keys, 'A')).not.toBe(encryptName(keys, 'B'))
  expect(() => encryptName(keys, 'é'.repeat(100))).toThrow('too long')
})

test('names that are not ours are recognised as such; a Drive duplicate keeps its marker', async () => {
  const { keys } = await createKeyring(PASS, LIGHT)
  const other = (await createKeyring('another passcode entirely', LIGHT)).keys
  expect(decryptName(keys, '.DS_Store')).toBeNull()
  expect(decryptName(keys, 'plain-file.md')).toBeNull()
  expect(decryptName(keys, encryptName(other, 'note.md'))).toBeNull()
  expect(decryptName(keys, encryptName(keys, 'note.md') + ' (1)')).toBe('note (1).md')
  expect(decryptName(keys, encryptName(keys, 'Folder') + ' (2)')).toBe('Folder (2)')
})
