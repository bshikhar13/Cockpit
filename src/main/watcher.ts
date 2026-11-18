import chokidar from 'chokidar'
import { relative, sep } from 'path'
import type { Vault } from './vault'
import type { VaultIndex } from './vault-index'

/** Keeps the index in step with changes made outside the app (Google Drive, another editor). */
export function watchVault(vault: Vault, index: VaultIndex, onChange: (rels: string[]) => void): () => void {
  const pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null

  const flush = (): void => {
    timer = null
    const rels = [...pending]
    pending.clear()
    if (rels.length) onChange(rels)
  }
  const queue = (rel: string): void => {
    pending.add(rel)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 150)
  }
  /** the real path for a path on disk; null for files that are not this vault's (strays, the config file) */
  const toRel = (abs: string): string | null => vault.logical(relative(vault.root, abs).split(sep).join('/'))

  const watcher = chokidar.watch(vault.root, {
    ignored: (p: string) => /(^|[/\\])\../.test(relative(vault.root, p)),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  })
  const changed = async (abs: string): Promise<void> => {
    const rel = toRel(abs)
    if (rel === null) return
    if (rel.toLowerCase().endsWith('.md')) {
      try {
        index.upsert(rel, (await vault.read(rel)).text)
      } catch {
        index.markUnreadable(rel)
      }
    }
    queue(rel)
  }
  watcher.on('add', changed)
  watcher.on('change', changed)
  watcher.on('unlink', (abs) => {
    const rel = toRel(abs)
    if (rel === null) return
    index.remove(rel)
    queue(rel)
  })
  const dirChanged = (abs: string): void => {
    const rel = toRel(abs)
    if (rel !== null) queue(rel)
  }
  watcher.on('addDir', dirChanged)
  watcher.on('unlinkDir', dirChanged)

  return () => {
    if (timer) clearTimeout(timer)
    void watcher.close()
  }
}
