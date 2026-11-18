import { projectStatus } from '../../../core/projects'
import type { TreeNode } from '../../../core/types'
import { api } from '../api'
import { useVault } from '../useVault'

export interface Container {
  rel: string
  name: string
  kind: 'inbox' | 'area' | 'project'
  done: boolean
}

export function containersFromTree(tree: TreeNode[]): Container[] {
  const out: Container[] = [{ rel: 'Inbox', name: 'Inbox', kind: 'inbox', done: false }]
  for (const top of ['Areas', 'Projects'] as const) {
    const node = tree.find((n) => n.rel === top)
    for (const child of node?.children ?? []) {
      if (child.type !== 'folder') continue
      out.push({ rel: child.rel, name: child.name, kind: top === 'Areas' ? 'area' : 'project', done: projectStatus(child.meta?.status) === 'done' })
    }
  }
  return out
}

/** Everywhere a task can live: Inbox, then areas, then projects. */
export function useContainers(): Container[] {
  const { data } = useVault(() => api.notes.tree())
  return data ? containersFromTree(data) : [{ rel: 'Inbox', name: 'Inbox', kind: 'inbox', done: false }]
}
