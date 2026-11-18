import MiniSearch from 'minisearch'
import { dateFromDiaryPath, readHabitTicks } from '../core/diary'
import { readFrontmatter, splitFrontmatter } from '../core/frontmatter'
import { extractWikilinks } from '../core/links'
import { classify, type PathInfo } from '../core/para'
import { listTasks, type TaskAt } from '../core/tasks/file'
import type { NoteRef, SearchHit, TaskItem, TreeNode } from '../core/types'
import type { Vault } from './vault'

interface FileRecord {
  rel: string
  info: PathInfo
  body: string
  links: string[]
  tasks: TaskAt[]
  date: string | null
  ticks: Record<string, boolean>
  meta: TreeNode['meta']
}

const TOP_FOLDERS = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archive']

/** Everything the app needs to know about the vault, derived from the files and rebuilt at launch. */
export class VaultIndex {
  private files = new Map<string, FileRecord>()
  private mini = new MiniSearch<{ id: string; name: string; body: string }>({
    fields: ['name', 'body'],
    storeFields: ['name']
  })

  /** notes that exist but could not be read (damaged, or still a cloud placeholder) */
  private bad = new Set<string>()

  static async build(vault: Vault): Promise<VaultIndex> {
    const index = new VaultIndex()
    for (const rel of await vault.listMarkdown()) {
      try {
        index.upsert(rel, (await vault.read(rel)).text)
      } catch {
        index.markUnreadable(rel) // kept on a list the owner is shown, never silently dropped
      }
    }
    return index
  }

  markUnreadable(rel: string): void {
    this.remove(rel)
    this.bad.add(rel)
  }

  unreadable(): string[] {
    return [...this.bad].sort()
  }

  private isNote(r: FileRecord): boolean {
    return r.rel.toLowerCase().endsWith('.md') && !r.rel.endsWith('/Tasks.md') && r.rel !== 'Tasks.md' && r.info.kind !== 'habits'
  }

  private ref(r: FileRecord): NoteRef {
    return { rel: r.rel, name: r.info.name, kind: r.info.kind, container: r.info.container }
  }

  upsert(rel: string, text: string): void {
    this.remove(rel)
    this.bad.delete(rel)
    const info = classify(rel)
    const fm = readFrontmatter(text)
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
    const record: FileRecord = {
      rel,
      info,
      body: splitFrontmatter(text).body,
      links: extractWikilinks(text).map((l) => l.target.toLowerCase()),
      tasks: info.isTasksFile ? listTasks(text) : [],
      date: dateFromDiaryPath(rel),
      ticks: info.kind === 'diary' ? readHabitTicks(text) : {},
      meta: info.isHomeNote
        ? { status: str(fm.status), deadline: str(fm.deadline), area: str(fm.area) }
        : undefined
    }
    this.files.set(rel, record)
    if (this.isNote(record)) this.mini.add({ id: rel, name: info.name, body: record.body })
  }

  remove(rel: string): void {
    this.bad.delete(rel)
    const old = this.files.get(rel)
    if (!old) return
    if (this.isNote(old)) this.mini.discard(rel)
    this.files.delete(rel)
  }

  has(rel: string): boolean {
    return this.files.has(rel)
  }

  /** rels of every indexed file at or under a folder */
  under(folder: string): string[] {
    return [...this.files.keys()].filter((r) => r.startsWith(folder + '/')).sort()
  }

  notes(): NoteRef[] {
    return [...this.files.values()].filter((r) => this.isNote(r)).map((r) => this.ref(r)).sort((a, b) => a.rel.localeCompare(b.rel))
  }

  private named(name: string): FileRecord[] {
    const wanted = name.trim().toLowerCase()
    return [...this.files.values()]
      .filter((r) => this.isNote(r) && r.info.name.toLowerCase() === wanted)
      .sort((a, b) => a.rel.length - b.rel.length || (a.rel < b.rel ? -1 : 1))
  }

  resolve(name: string): NoteRef | null {
    const found = this.named(name)[0]
    return found ? this.ref(found) : null
  }

  duplicates(): string[][] {
    const groups = new Map<string, string[]>()
    for (const r of this.files.values()) {
      if (!this.isNote(r)) continue
      const key = r.info.name.toLowerCase()
      groups.set(key, [...(groups.get(key) ?? []), r.rel])
    }
    return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }

  linkers(name: string): string[] {
    const wanted = name.trim().toLowerCase()
    return [...this.files.values()].filter((r) => r.links.includes(wanted)).map((r) => r.rel).sort()
  }

  backlinks(name: string): NoteRef[] {
    const wanted = name.trim().toLowerCase()
    return [...this.files.values()]
      .filter((r) => this.isNote(r) && r.links.includes(wanted) && r.info.name.toLowerCase() !== wanted)
      .map((r) => this.ref(r))
      .sort((a, b) => a.rel.localeCompare(b.rel))
  }

  tasks(): TaskItem[] {
    const out: TaskItem[] = []
    for (const r of [...this.files.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
      if (!r.info.isTasksFile || !r.info.container) continue
      for (const { task, line } of r.tasks) {
        out.push({
          ...task,
          file: r.rel,
          line,
          container: r.info.container,
          containerName: r.info.container.split('/').pop()!,
          containerKind: r.info.kind
        })
      }
    }
    return out
  }

  habitTicks(from: string, to: string): Record<string, Record<string, boolean>> {
    const out: Record<string, Record<string, boolean>> = {}
    for (const r of this.files.values()) {
      if (r.date && r.date >= from && r.date <= to && Object.keys(r.ticks).length) out[r.date] = { ...r.ticks }
    }
    return out
  }

  diaryFiles(): string[] {
    return [...this.files.values()].filter((r) => r.date).map((r) => r.rel).sort()
  }

  search(query: string, limit = 20): SearchHit[] {
    const q = query.trim()
    if (!q) return []
    const results = this.mini.search(q, { prefix: true, boost: { name: 3 }, combineWith: 'AND' })
    return results.slice(0, limit).map((res) => {
      const r = this.files.get(res.id as string)!
      return { rel: r.rel, name: r.info.name, snippet: snippet(r.body, q) }
    })
  }

  tree(): TreeNode[] {
    const kinds = { Inbox: 'inbox', Projects: 'project', Areas: 'area', Resources: 'resource', Archive: 'archive' } as const
    return TOP_FOLDERS.map((top) => {
      const root: TreeNode = { rel: top, name: top, type: 'folder', kind: kinds[top as keyof typeof kinds], children: [] }
      for (const r of [...this.files.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
        if (!this.isNote(r) || !r.rel.startsWith(top + '/')) continue
        const parts = r.rel.split('/')
        let node = root
        for (let i = 1; i < parts.length - 1; i++) {
          const rel = parts.slice(0, i + 1).join('/')
          let child = node.children!.find((c) => c.type === 'folder' && c.rel === rel)
          if (!child) {
            child = { rel, name: parts[i], type: 'folder', kind: root.kind, children: [] }
            node.children!.push(child)
          }
          node = child
        }
        if (r.info.isHomeNote && r.meta) node.meta = r.meta
        const note: TreeNode = { rel: r.rel, name: r.info.name, type: 'note', kind: r.info.kind }
        if (r.info.isHomeNote) node.children!.unshift(note)
        else node.children!.push(note)
      }
      sortTree(root)
      return root
    })
  }
}

function sortTree(node: TreeNode): void {
  if (!node.children) return
  const home = node.children.find((c) => c.type === 'note' && c.name === node.name)
  const rest = node.children.filter((c) => c !== home)
  rest.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1))
  node.children = home ? [home, ...rest] : rest
  node.children.forEach(sortTree)
}

function snippet(body: string, query: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  const term = query.split(/\s+/)[0].toLowerCase()
  const at = flat.toLowerCase().indexOf(term)
  if (at < 0) return flat.slice(0, 120)
  const start = Math.max(0, at - 40)
  return (start > 0 ? '…' : '') + flat.slice(start, at + 80) + (at + 80 < flat.length ? '…' : '')
}
