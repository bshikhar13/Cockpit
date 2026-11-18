import { posix } from 'path'
import { readFrontmatter, updateFrontmatter } from '../../core/frontmatter'
import { rewriteWikilinks } from '../../core/links'
import { classify, KIND_FOLDER, validateName } from '../../core/para'
import type { ProjectStatus } from '../../core/projects'
import type { Vault } from '../vault'
import type { VaultIndex } from '../vault-index'

export class NotesService {
  constructor(
    private vault: Vault,
    private index: VaultIndex
  ) {}

  private checkName(name: string, exceptRel?: string): string {
    const clean = name.trim()
    const problem = validateName(clean)
    if (problem) throw new Error(problem)
    const clash = this.index.resolve(clean)
    if (clash && clash.rel !== exceptRel) throw new Error(`A note named "${clash.name}" already exists`)
    return clean
  }

  private async reindex(rel: string): Promise<void> {
    this.index.upsert(rel, (await this.vault.read(rel)).text)
  }

  /** After a folder moved on disk: forget the old paths and index the new ones. */
  private async reindexFolder(from: string, to: string): Promise<void> {
    for (const rel of this.index.under(from)) this.index.remove(rel)
    for (const rel of await this.vault.listMarkdown()) if (rel.startsWith(to + '/')) await this.reindex(rel)
  }

  private async writeAndIndex(rel: string, text: string): Promise<void> {
    await this.vault.write(rel, text)
    this.index.upsert(rel, text)
  }

  async create(folder: string | null, name: string): Promise<string> {
    const clean = this.checkName(name)
    const rel = `${folder ?? 'Inbox'}/${clean}.md`
    // the index can lag behind the disk; the file system has the last word on whether this is new
    await this.vault.create(rel, '').catch((e: Error) => {
      throw e.message.endsWith('already exists') ? new Error(`A note named "${clean}" already exists`) : e
    })
    this.index.upsert(rel, '')
    return rel
  }

  async openOrCreateByName(name: string): Promise<string> {
    return this.index.resolve(name)?.rel ?? this.create(null, name)
  }

  async rename(rel: string, newName: string): Promise<string> {
    const info = classify(rel)
    if (info.kind === 'diary') throw new Error('Diary pages are named by their date and cannot be renamed')
    if (rel.endsWith('/Tasks.md') || info.kind === 'habits') throw new Error('This file cannot be renamed')
    const clean = this.checkName(newName, rel)
    const oldName = info.name
    if (clean === oldName) return rel

    let newRel: string
    if (info.isHomeNote && info.container) {
      const parent = info.container.split('/')[0]
      const newFolder = `${parent}/${clean}`
      await this.vault.move(info.container, newFolder)
      await this.vault.move(`${newFolder}/${oldName}.md`, `${newFolder}/${clean}.md`)
      await this.reindexFolder(info.container, newFolder)
      newRel = `${newFolder}/${clean}.md`
      if (info.kind === 'area') await this.renameAreaReferences(oldName, clean)
    } else {
      newRel = `${posix.dirname(rel)}/${clean}.md`
      await this.vault.move(rel, newRel)
      this.index.remove(rel)
      await this.reindex(newRel)
    }

    for (const linker of this.index.linkers(oldName)) {
      const { text } = await this.vault.read(linker)
      const rewritten = rewriteWikilinks(text, oldName, clean)
      if (rewritten !== text) await this.writeAndIndex(linker, rewritten)
    }
    return newRel
  }

  private async renameAreaReferences(oldName: string, newName: string): Promise<void> {
    for (const note of this.index.notes()) {
      if (note.kind !== 'project' && note.kind !== 'archive') continue
      if (!classify(note.rel).isHomeNote) continue
      const { text } = await this.vault.read(note.rel)
      const fm = readFrontmatter(text)
      if (typeof fm.area === 'string' && fm.area.toLowerCase() === oldName.toLowerCase()) {
        await this.writeAndIndex(note.rel, updateFrontmatter(text, { area: newName }))
      }
    }
  }

  async move(rel: string, toFolder: string): Promise<string> {
    const info = classify(rel)
    if (rel.endsWith('/Tasks.md') || info.isHomeNote || info.kind === 'diary' || info.kind === 'habits') {
      throw new Error('This file cannot be moved')
    }
    const newRel = `${toFolder}/${posix.basename(rel)}`
    if (newRel === rel) return rel
    await this.vault.move(rel, newRel)
    this.index.remove(rel)
    await this.reindex(newRel)
    return newRel
  }

  async remove(rel: string): Promise<void> {
    const info = classify(rel)
    if (rel.endsWith('/Tasks.md') || info.kind === 'habits') throw new Error('This file cannot be deleted')
    if (info.isHomeNote) throw new Error('Archive the whole folder instead of deleting its home note')
    await this.vault.remove(rel)
    this.index.remove(rel)
  }

  async createContainer(
    kind: 'project' | 'area' | 'resource',
    name: string,
    opts: { area?: string; deadline?: string } = {}
  ): Promise<string> {
    const clean = this.checkName(name)
    const folder = `${KIND_FOLDER[kind]}/${clean}`
    const home = `${folder}/${clean}.md`
    const meta: Record<string, unknown> = { status: 'active' }
    if (opts.deadline) meta.deadline = opts.deadline
    if (opts.area) meta.area = opts.area
    // A folder of this name may already exist (made in Finder or another editor). Adopt it:
    // add only what is missing, and never overwrite a file that is there.
    await this.vault.createIfAbsent(home, kind === 'project' ? updateFrontmatter('', meta) : '')
    if (kind !== 'resource') await this.vault.createIfAbsent(`${folder}/Tasks.md`, '')
    await this.reindexFolder(folder, folder)
    return home
  }

  async setProjectMeta(
    rel: string,
    meta: { status?: ProjectStatus; deadline?: string | null; area?: string | null }
  ): Promise<void> {
    const { text } = await this.vault.read(rel)
    const next = updateFrontmatter(text, meta)
    if (next !== text) await this.writeAndIndex(rel, next)
  }

  async archive(containerRel: string): Promise<string> {
    const [parent, name] = containerRel.split('/')
    if (!name || !['Projects', 'Areas', 'Resources'].includes(parent)) throw new Error('Only projects, areas, and resource topics can be archived')
    const target = `Archive/${name}`
    if (await this.vault.exists(target)) throw new Error(`"${name}" already exists in Archive`)
    const home = `${containerRel}/${name}.md`
    if (await this.vault.exists(home)) {
      const { text } = await this.vault.read(home)
      await this.vault.write(home, updateFrontmatter(text, { archivedFrom: parent }))
    }
    await this.vault.move(containerRel, target)
    await this.reindexFolder(containerRel, target)
    return target
  }

  async unarchive(archivedRel: string): Promise<string> {
    const [top, name] = archivedRel.split('/')
    if (top !== 'Archive' || !name) throw new Error('Not an archived folder')
    const home = `${archivedRel}/${name}.md`
    let parent = 'Projects'
    if (await this.vault.exists(home)) {
      const { text } = await this.vault.read(home)
      const from = readFrontmatter(text).archivedFrom
      if (typeof from === 'string' && ['Projects', 'Areas', 'Resources'].includes(from)) parent = from
      await this.vault.write(home, updateFrontmatter(text, { archivedFrom: null }))
    }
    const target = `${parent}/${name}`
    await this.vault.move(archivedRel, target)
    await this.reindexFolder(archivedRel, target)
    return target
  }

  /** Stores the file under Attachments/ and returns the markdown that embeds it from the given note. */
  async importAttachment(bytes: Uint8Array, filename: string, forNoteRel: string): Promise<string> {
    const rel = await this.vault.writeAttachment(bytes, filename)
    const path = posix.relative(posix.dirname(forNoteRel), rel)
    return `![](${path.split('/').map((seg) => (seg === '..' ? seg : encodeURIComponent(seg))).join('/')})`
  }
}

