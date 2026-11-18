import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, open, readdir, readFile, realpath, rename, rm, writeFile } from 'fs/promises'
import { join, sep } from 'path'
import {
  changePasscode, createKeyring, decryptName, FILE_MAGIC, type KdfParams, type Keys, MAX_NAME_BYTES, unlockKeyring,
  type VaultConfig
} from './crypto'
import { CONFIG_FILE, Vault } from './vault'

/**
 * The settings file holds the wrapped keys. Without it the passcode is useless and the notes
 * cannot be opened, so a copy is kept outside the notes folder (in the app's own data folder),
 * named after the folder it belongs to, and used if the original disappears or is damaged.
 * It holds no secret.
 */
function backupPath(backupDir: string, root: string): string {
  return join(backupDir, `vault-config-${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`)
}

async function writeConfig(root: string, config: VaultConfig, backupDir: string, flag: 'w' | 'wx' = 'w'): Promise<void> {
  const text = JSON.stringify(config, null, 2)
  if (flag === 'wx') await writeFile(join(root, CONFIG_FILE), text, { flag: 'wx' })
  else {
    // replace in one step, so a crash can never leave a half-written settings file
    await writeFile(join(root, CONFIG_FILE + '.tmp'), text)
    await rename(join(root, CONFIG_FILE + '.tmp'), join(root, CONFIG_FILE))
  }
  await mkdir(backupDir, { recursive: true })
  await writeFile(backupPath(backupDir, root), text)
}

function parse(text: string): VaultConfig {
  try {
    const config = JSON.parse(text) as VaultConfig
    if (!config.slots?.passcode?.wrapped || !config.slots?.recovery?.wrapped || !config.kdf) throw new Error('incomplete')
    return config
  } catch {
    throw new Error('The encryption settings file in this folder is damaged')
  }
}

export async function isEncrypted(root: string): Promise<boolean> {
  return existsSync(join(root, CONFIG_FILE))
}

/** True if any file near the top of the folder was written by Cockpit's encryption. */
async function hasEncryptedFiles(root: string): Promise<boolean> {
  let looked = 0
  const scan = async (dir: string, depth: number): Promise<boolean> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || looked > 200) continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < 3 && (await scan(p, depth + 1))) return true
      } else {
        looked++
        const handle = await open(p, 'r').catch(() => null)
        if (!handle) continue
        const head = Buffer.alloc(FILE_MAGIC.length)
        await handle.read(head, 0, head.length, 0).catch(() => undefined)
        await handle.close()
        if (head.equals(FILE_MAGIC)) return true
      }
    }
    return false
  }
  return scan(root, 0)
}

/**
 * Whether a folder must be treated as encrypted. The settings file says so; if that is missing,
 * the copy kept for this folder says so; failing both, the files themselves do. A folder that is
 * encrypted must never be opened as a plain one: the app would write readable files into it.
 */
export async function detectEncrypted(root: string, backupDir: string): Promise<boolean> {
  return (await isEncrypted(root)) || existsSync(backupPath(backupDir, root)) || (await hasEncryptedFiles(root))
}

/** Do these keys belong to this folder? True if the folder is empty or any top-level name decrypts with them. */
async function keysFit(root: string, keys: Keys): Promise<boolean> {
  const names = (await readdir(root)).filter((n) => !n.startsWith('.') && !n.startsWith(CONFIG_FILE))
  return names.length === 0 || names.some((n) => decryptName(keys, n) !== null)
}

/**
 * Finds the settings that open this folder with this secret. The file in the folder is tried
 * first; if it is missing, damaged, or belongs to some other folder, the kept copy is tried.
 * A missing or damaged file in the folder is then replaced with the copy that worked.
 */
async function resolve(root: string, secret: string, backupDir: string): Promise<{ config: VaultConfig; keys: Keys }> {
  const inFolder = join(root, CONFIG_FILE)
  const kept = backupPath(backupDir, root)
  const folderText = existsSync(inFolder) ? await readFile(inFolder, 'utf8') : null
  const keptText = existsSync(kept) ? await readFile(kept, 'utf8') : null
  if (folderText === null && keptText === null) {
    throw new Error('The encryption settings file is missing from this folder, so it cannot be unlocked')
  }
  const tryParse = (text: string | null): VaultConfig | null => {
    try {
      return text === null ? null : parse(text)
    } catch {
      return null
    }
  }
  const folderConfig = tryParse(folderText)
  const keptConfig = keptText !== null && keptText !== folderText ? tryParse(keptText) : null
  if (!folderConfig && !keptConfig) throw new Error('The encryption settings file in this folder is damaged')

  for (const [config, source] of [[folderConfig, 'folder'], [keptConfig, 'kept']] as const) {
    if (!config) continue
    let keys: Keys
    try {
      keys = await unlockKeyring(config, secret)
    } catch (e) {
      if (e instanceof Error && e.message === 'Wrong passcode') continue
      throw e
    }
    if (!(await keysFit(root, keys))) continue // the right secret, but for some other folder's settings
    const text = JSON.stringify(config, null, 2)
    await mkdir(backupDir, { recursive: true })
    if (source === 'folder') await writeFile(kept, text)
    else if (!folderConfig) {
      if (folderText !== null) await rename(inFolder, `${inFolder}.damaged`)
      await writeFile(inFolder, text, { flag: 'wx' })
    }
    return { config, keys }
  }
  throw new Error('Wrong passcode')
}

/** Turns an existing, empty folder into an encrypted notes folder. The recovery key is returned once. */
export async function createEncryptedFolder(
  root: string,
  passcode: string,
  backupDir: string,
  kdf?: KdfParams
): Promise<{ keys: Keys; recoveryKey: string }> {
  const contents = (await readdir(root)).filter((name) => !name.startsWith('.') && name !== 'Icon\r')
  if (contents.length) throw new Error('Choose an empty folder for your encrypted notes')
  const { config, keys, recoveryKey } = await createKeyring(passcode, kdf)
  await writeConfig(root, config, backupDir, 'wx')
  return { keys, recoveryKey }
}

/** `secret` is the passcode or the recovery key. Throws 'Wrong passcode' otherwise. */
export async function unlockFolder(root: string, secret: string, backupDir: string): Promise<Keys> {
  return (await resolve(root, secret, backupDir)).keys
}

export async function changeFolderPasscode(root: string, current: string, next: string, backupDir: string): Promise<void> {
  const { config } = await resolve(root, current, backupDir)
  await writeConfig(root, await changePasscode(config, current, next), backupDir)
}

/**
 * Copies every file from one vault into another (plain into encrypted, typically). Each file is
 * read back from the destination and compared before the next one, so a finished copy is a
 * verified one. The source is never changed. Returns the number of files copied.
 */
export async function copyVault(from: Vault, to: Vault): Promise<number> {
  const files = await from.listAll()
  for (const rel of files) {
    const bytes = await from.readBytes(rel)
    await to.writeBytes(rel, bytes)
    if (!(await to.readBytes(rel)).equals(bytes)) throw new Error(`"${rel}" could not be verified after copying. Nothing was removed from the original folder.`)
  }
  return files.length
}

const within = (inner: string, outer: string): boolean => inner === outer || inner.startsWith(outer + sep)

/**
 * Sets up `destRoot` as an encrypted notes folder and, if a source is given, copies those notes
 * into it. Everything that can be checked is checked before anything is created; if the copy
 * then fails, the destination is emptied again so the same folder can be used for another try.
 * The source is never changed.
 */
export async function encryptInto(
  source: Vault | null,
  destRoot: string,
  passcode: string,
  backupDir: string,
  kdf?: KdfParams
): Promise<{ keys: Keys; recoveryKey: string }> {
  if (!(await Vault.isUsable(destRoot))) throw new Error('That folder is not available')
  if (source) {
    const [from, to] = await Promise.all([realpath(source.root), realpath(destRoot)])
    if (within(from, to) || within(to, from)) {
      throw new Error('Choose a separate folder for the encrypted notes, not one inside your current notes folder')
    }
    const tooLong = (await source.listAll()).filter((rel) => rel.split('/').some((s) => Buffer.byteLength(s, 'utf8') > MAX_NAME_BYTES))
    if (tooLong.length) {
      const shown = tooLong.slice(0, 5).map((rel) => `"${rel}"`).join(', ')
      throw new Error(
        `${tooLong.length === 1 ? 'One name is' : `${tooLong.length} names are`} too long for an encrypted folder. Shorten ${tooLong.length === 1 ? 'it' : 'them'} and try again: ${shown}${tooLong.length > 5 ? ', …' : ''}`
      )
    }
  }
  const made = await createEncryptedFolder(destRoot, passcode, backupDir, kdf) // refuses a folder that is not empty
  if (source) {
    try {
      await copyVault(source, new Vault(destRoot, undefined, made.keys))
    } catch (e) {
      // The folder was empty before this call, so everything in it now was put there by this call.
      for (const name of await readdir(destRoot)) if (!name.startsWith('.')) await rm(join(destRoot, name), { recursive: true, force: true })
      await rm(backupPath(backupDir, destRoot), { force: true })
      throw e
    }
  }
  return made
}
