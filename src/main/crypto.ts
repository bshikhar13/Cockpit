import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scrypt } from 'crypto'

/**
 * Encryption for a notes folder.
 *
 * - A random 256-bit master key encrypts everything. It is never stored in the clear: the config
 *   file holds it wrapped (encrypted) once under a key derived from the passcode and once under a
 *   key derived from the recovery key. Changing the passcode re-wraps it; no file is re-encrypted.
 * - Passcode to key: scrypt, deliberately slow and memory-hungry, to make guessing expensive for
 *   anyone holding a copy of the folder.
 * - File contents: AES-256-GCM with a fresh random nonce per write. Tampering is detected.
 * - File and folder names: AES-256-GCM with a nonce computed from the name, so a name always
 *   scrambles to the same string (the app must be able to find a file by name).
 */

export const MIN_PASSCODE_LENGTH = 12
/** about half a second and 128 MB per attempt */
export const DEFAULT_KDF = { N: 131072, r: 8, p: 1 }
/** longest file or folder name, in UTF-8 bytes, that still fits a file system name once scrambled */
export const MAX_NAME_BYTES = 150

export interface KdfParams {
  N: number
  r: number
  p: number
}
interface Slot {
  salt: string
  nonce: string
  wrapped: string
}
export interface VaultConfig {
  format: 1
  kdf: { name: 'scrypt' } & KdfParams
  slots: { passcode: Slot; recovery: Slot }
}
export interface Keys {
  master: Buffer
  content: Buffer
  name: Buffer
  nameMac: Buffer
}

/** every encrypted file starts with these bytes */
export const FILE_MAGIC = Buffer.from('CKPT\x01')
const MAGIC = FILE_MAGIC
const NONCE = 12
const TAG = 16
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function derive(secret: string, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret.normalize('NFKC'), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

function seal(key: Buffer, nonce: Buffer, plain: Buffer, aad: string): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(aad))
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()])
}

/** null when the data was not sealed with this key, or has been altered */
function open(key: Buffer, nonce: Buffer, sealed: Buffer, aad: string): Buffer | null {
  if (sealed.length < TAG || nonce.length !== NONCE) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(Buffer.from(aad))
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG))
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()])
  } catch {
    return null
  }
}

function keysFrom(master: Buffer): Keys {
  const sub = (info: string): Buffer => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32))
  return { master, content: sub('cockpit content v1'), name: sub('cockpit name v1'), nameMac: sub('cockpit name nonce v1') }
}

async function wrap(master: Buffer, secret: string, slot: 'passcode' | 'recovery', kdf: KdfParams): Promise<Slot> {
  const salt = randomBytes(16)
  const nonce = randomBytes(NONCE)
  const kek = await derive(secret, salt, kdf)
  return {
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    wrapped: seal(kek, nonce, master, `cockpit slot v1 ${slot}`).toString('base64')
  }
}

async function unwrap(slot: Slot, secret: string, name: 'passcode' | 'recovery', kdf: KdfParams): Promise<Buffer | null> {
  const kek = await derive(secret, Buffer.from(slot.salt, 'base64'), kdf)
  return open(kek, Buffer.from(slot.nonce, 'base64'), Buffer.from(slot.wrapped, 'base64'), `cockpit slot v1 ${name}`)
}

function newRecoveryKey(): string {
  const bytes = randomBytes(20) // 160 bits
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += CROCKFORD[parseInt(bits.slice(i, i + 5), 2)]
  return out.match(/.{4}/g)!.join('-')
}

/** Forgiving of how a recovery key is typed: case, spaces, dashes, and the letters people confuse with digits. */
function normaliseRecovery(typed: string): string {
  return typed.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

function checkPasscode(passcode: string): void {
  if ([...passcode].length < MIN_PASSCODE_LENGTH) throw new Error(`A passcode needs at least ${MIN_PASSCODE_LENGTH} characters`)
}

/** Makes the keys for a new encrypted folder. The recovery key is returned once and stored nowhere. */
export async function createKeyring(
  passcode: string,
  kdf: KdfParams = DEFAULT_KDF
): Promise<{ config: VaultConfig; keys: Keys; recoveryKey: string }> {
  checkPasscode(passcode)
  const master = randomBytes(32)
  const recoveryKey = newRecoveryKey()
  const config: VaultConfig = {
    format: 1,
    kdf: { name: 'scrypt', ...kdf },
    slots: {
      passcode: await wrap(master, passcode, 'passcode', kdf),
      recovery: await wrap(master, normaliseRecovery(recoveryKey), 'recovery', kdf)
    }
  }
  return { config, keys: keysFrom(master), recoveryKey }
}

/** Accepts the passcode or the recovery key. Throws 'Wrong passcode' for anything else. */
export async function unlockKeyring(config: VaultConfig, secret: string): Promise<Keys> {
  if (config.format !== 1 || config.kdf?.name !== 'scrypt') throw new Error('This folder was encrypted by a newer version of Cockpit')
  const master =
    (secret ? await unwrap(config.slots.passcode, secret, 'passcode', config.kdf) : null) ??
    (normaliseRecovery(secret) ? await unwrap(config.slots.recovery, normaliseRecovery(secret), 'recovery', config.kdf) : null)
  if (!master) throw new Error('Wrong passcode')
  return keysFrom(master)
}

/** Returns a new config in which only the passcode slot differs. `current` may be the passcode or the recovery key. */
export async function changePasscode(config: VaultConfig, current: string, next: string): Promise<VaultConfig> {
  checkPasscode(next)
  const { master } = await unlockKeyring(config, current)
  return { ...config, slots: { ...config.slots, passcode: await wrap(master, next, 'passcode', config.kdf) } }
}

export function encryptBytes(keys: Keys, plain: Uint8Array): Buffer {
  const nonce = randomBytes(NONCE)
  return Buffer.concat([MAGIC, nonce, seal(keys.content, nonce, Buffer.from(plain), 'cockpit file v1')])
}

export function decryptBytes(keys: Keys, data: Uint8Array): Buffer {
  const buf = Buffer.from(data)
  const plain =
    buf.length >= MAGIC.length + NONCE + TAG && buf.subarray(0, MAGIC.length).equals(MAGIC)
      ? open(keys.content, buf.subarray(MAGIC.length, MAGIC.length + NONCE), buf.subarray(MAGIC.length + NONCE), 'cockpit file v1')
      : null
  if (!plain) throw new Error('This file cannot be decrypted. It is damaged, or was not written by Cockpit with this passcode.')
  return plain
}

export function encryptName(keys: Keys, name: string): string {
  const plain = Buffer.from(name, 'utf8')
  if (plain.length > MAX_NAME_BYTES) throw new Error('That name is too long for an encrypted notes folder')
  const nonce = createHmac('sha256', keys.nameMac).update(plain).digest().subarray(0, NONCE)
  return Buffer.concat([nonce, seal(keys.name, nonce, plain, 'cockpit name v1')]).toString('base64url')
}

/** a scrambled name carrying the " (1)" marker Google Drive adds to a conflicting duplicate */
export const DUPLICATE = /^(.*?)( \(\d+\))$/

/**
 * The real name behind a scrambled one, or null if this is not one of ours (a stray file, or one
 * from another passcode). Google Drive marks conflicting duplicates by appending " (1)"; that
 * marker is carried over to the real name so the duplicate shows up instead of vanishing.
 */
export function decryptName(keys: Keys, scrambled: string): string | null {
  const dup = DUPLICATE.exec(scrambled)
  const core = dup ? dup[1] : scrambled
  if (!/^[A-Za-z0-9_-]+$/.test(core)) return null
  const raw = Buffer.from(core, 'base64url')
  if (raw.length < NONCE + TAG) return null
  const plain = open(keys.name, raw.subarray(0, NONCE), raw.subarray(NONCE), 'cockpit name v1')
  if (!plain) return null
  const name = plain.toString('utf8')
  if (!dup) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}${dup[2]}${name.slice(dot)}` : `${name}${dup[2]}`
}
