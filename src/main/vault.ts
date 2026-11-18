import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { SKELETON } from '../core/para'
import { decryptBytes, decryptName, DUPLICATE, encryptBytes, encryptName, type Keys } from './crypto'

const sha1 = (data: string | Uint8Array): string => createHash('sha1').update(data).digest('hex')
const pad = (n: number): string => String(n).padStart(2, '0')

/** The one unencrypted file in an encrypted folder: how to turn the passcode back into the keys. */
export const CONFIG_FILE = 'cockpit.vault.json'

/**
 * All file access goes through here, and is confined to the vault root.
 *
 * Callers always use real paths ("Projects/Launch/Launch.md") and real text. When the vault has
 * keys, every file's contents and every file and folder name are encrypted on their way to disk
 * and decrypted on the way back, so nothing above this class knows or cares.
 */
export class Vault {
  readonly root: string
  /**
   * Real path of an entry -> its name on disk, for entries whose disk name cannot be worked out
   * from the real name: the duplicates Google Drive makes when two Macs change the same file.
   * Filled in whenever a folder is listed, so such an entry can be read, renamed, or removed.
   */
  private aliases = new Map<string, string>()

  constructor(
    root: string,
    private trash: (absPath: string) => Promise<void> = async () => {
      throw new Error('no trash available')
    },
    private keys: Keys | null = null
  ) {
    this.root = resolve(root)
  }

  get encrypted(): boolean {
    return this.keys !== null
  }

  static async isUsable(root: string): Promise<boolean> {
    try {
      return (await stat(root)).isDirectory()
    } catch {
      return false
    }
  }

  /** Where a real path lives on disk. Refuses anything outside the vault. */
  abs(rel: string): string {
    if (isAbsolute(rel)) throw new Error('outside vault')
    const p = resolve(this.root, rel)
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error('outside vault')
    if (!this.keys) return p
    const keys = this.keys
    const segments = relative(this.root, p).split(sep).filter(Boolean)
    let prefix = ''
    return join(
      this.root,
      ...segments.map((s) => {
        prefix = prefix ? `${prefix}/${s}` : s
        return this.aliases.get(prefix) ?? encryptName(keys, s)
      })
    )
  }

  private forget(rel: string): void {
    for (const key of [...this.aliases.keys()]) if (key === rel || key.startsWith(rel + '/')) this.aliases.delete(key)
  }

  /** The real path behind a path as it appears on disk, or null if it is not one of this vault's files. */
  logical(physicalRel: string): string | null {
    const segments = physicalRel.split(/[\\/]/).filter(Boolean)
    if (!this.keys) return segments.join('/')
    if (physicalRel === CONFIG_FILE) return null
    const out: string[] = []
    for (const s of segments) {
      const name = decryptName(this.keys, s)
      if (name === null) return null
      out.push(name)
      if (DUPLICATE.test(s)) this.aliases.set(out.join('/'), s)
    }
    return out.join('/')
  }

  private seal(data: Uint8Array): Uint8Array {
    return this.keys ? encryptBytes(this.keys, data) : data
  }

  /** Throws if the notes folder itself has gone (Drive stopped, folder renamed). Nothing here ever recreates it. */
  private async assertRoot(): Promise<void> {
    if (!(await Vault.isUsable(this.root))) throw new Error('The notes folder is not available')
  }

  async ensureSkeleton(): Promise<void> {
    await this.assertRoot()
    for (const dir of SKELETON) await mkdir(this.abs(dir), { recursive: true })
    await this.createIfAbsent('Inbox/Tasks.md', '')
    await this.createIfAbsent('Habits.md', '# Habits\n')
  }

  /** True or false only when that is known. An error other than "not there" is thrown, never read as absent. */
  async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.abs(rel))
      return true
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      throw e
    }
  }

  async readBytes(rel: string): Promise<Buffer> {
    const data = await readFile(this.abs(rel))
    return this.keys ? decryptBytes(this.keys, data) : data
  }

  async read(rel: string): Promise<{ text: string; hash: string }> {
    const text = (await this.readBytes(rel)).toString('utf8')
    return { text, hash: sha1(text) }
  }

  async writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
    await this.assertRoot()
    const p = this.abs(rel)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, this.seal(bytes))
  }

  async write(rel: string, text: string): Promise<string> {
    await this.writeBytes(rel, Buffer.from(text, 'utf8'))
    return sha1(text)
  }

  /** Creates a new file. Fails with "already exists" instead of overwriting, whatever the index believes. */
  async create(rel: string, text: string): Promise<string> {
    await this.assertRoot()
    const p = this.abs(rel)
    await mkdir(dirname(p), { recursive: true })
    try {
      await writeFile(p, this.seal(Buffer.from(text, 'utf8')), { flag: 'wx' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`"${basename(rel)}" already exists`)
      throw e
    }
    return sha1(text)
  }

  /** Creates the file unless something is already there. Returns whether it was created. */
  async createIfAbsent(rel: string, text: string): Promise<boolean> {
    if (await this.exists(rel)) return false
    try {
      await this.create(rel, text)
      return true
    } catch (e) {
      if (e instanceof Error && e.message.endsWith('already exists')) return false
      throw e
    }
  }

  /**
   * Writes the owner's text. If the file on disk is not the version the owner started from,
   * the disk version is first kept beside it as a conflict copy. Nothing is silently discarded.
   */
  async save(rel: string, text: string, baseHash: string | null): Promise<{ hash: string; conflictCopy?: string }> {
    let conflictCopy: string | undefined
    if (await this.exists(rel)) {
      const disk = await this.read(rel)
      if (disk.hash !== baseHash && disk.text !== text) {
        const d = new Date()
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
        const ext = extname(rel)
        conflictCopy = `${rel.slice(0, rel.length - ext.length)} (conflict ${stamp})${ext}`
        await this.write(conflictCopy, disk.text)
      }
    }
    return { hash: await this.write(rel, text), conflictCopy }
  }

  /** Real names of the entries in a folder on disk. Hidden files and files that are not this vault's are skipped. */
  private async entries(physicalDir: string, prefix: string): Promise<{ name: string; physical: string; dir: boolean }[]> {
    const out: { name: string; physical: string; dir: boolean }[] = []
    const listed = (await readdir(physicalDir, { withFileTypes: true })).filter(
      (e) => !e.name.startsWith('.') && !(prefix === '' && e.name.startsWith(CONFIG_FILE))
    )
    // ordinary entries first, so a Drive duplicate can be given a name that does not clash with one
    const duplicate = (name: string): boolean => this.keys !== null && DUPLICATE.test(name)
    for (const entry of [...listed.filter((e) => !duplicate(e.name)), ...listed.filter((e) => duplicate(e.name))]) {
      const decoded = this.keys ? decryptName(this.keys, entry.name) : entry.name
      if (decoded === null || decoded.startsWith('.')) continue
      let name: string = decoded
      if (duplicate(entry.name)) {
        const taken = (candidate: string): boolean => out.some((o) => o.name === candidate)
        while (taken(name)) {
          const dot: number = name.lastIndexOf('.')
          name = dot > 0 ? `${name.slice(0, dot)} (Drive copy)${name.slice(dot)}` : `${name} (Drive copy)`
        }
        this.aliases.set(prefix ? `${prefix}/${name}` : name, entry.name)
      }
      out.push({ name, physical: join(physicalDir, entry.name), dir: entry.isDirectory() })
    }
    return out
  }

  /** Every file in the vault, as real relative paths. */
  async listAll(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await this.entries(dir, prefix)) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.dir) await walk(entry.physical, rel)
        else out.push(rel)
      }
    }
    await walk(this.root, '')
    return out.sort()
  }

  async listMarkdown(): Promise<string[]> {
    return (await this.listAll()).filter((rel) => rel.toLowerCase().endsWith('.md'))
  }

  async listDirs(rel: string): Promise<string[]> {
    try {
      return (await this.entries(this.abs(rel), rel)).filter((e) => e.dir).map((e) => e.name).sort()
    } catch {
      return []
    }
  }

  async move(from: string, to: string): Promise<void> {
    await this.assertRoot()
    const sameIgnoringCase = from.toLowerCase() === to.toLowerCase()
    if (!sameIgnoringCase && (await this.exists(to))) throw new Error(`"${basename(to)}" already exists there`)
    await mkdir(dirname(this.abs(to)), { recursive: true })
    await rename(this.abs(from), this.abs(to))
    this.forget(from)
  }

  async remove(rel: string): Promise<void> {
    await this.trash(this.abs(rel))
    this.forget(rel)
  }

  async writeAttachment(bytes: Uint8Array, filename: string): Promise<string> {
    await this.assertRoot()
    const clean = basename(filename.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '') || 'file'
    const ext = extname(clean)
    const stem = clean.slice(0, clean.length - ext.length)
    let rel = `Attachments/${clean}`
    for (let i = 1; await this.exists(rel); i++) rel = `Attachments/${stem} ${i}${ext}`
    await this.writeBytes(rel, bytes)
    return rel
  }
}
