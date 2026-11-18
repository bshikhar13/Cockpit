export type Kind =
  | 'diary' | 'project' | 'area' | 'resource' | 'archive' | 'inbox' | 'attachment' | 'habits' | 'other'

export interface PathInfo {
  kind: Kind
  /** e.g. 'Projects/Launch'; null when the file is not inside a container */
  container: string | null
  isTasksFile: boolean
  isHomeNote: boolean
  /** filename without .md */
  name: string
}

export const SKELETON = ['Diary', 'Projects', 'Areas', 'Resources', 'Archive', 'Attachments', 'Inbox']

const TOP: Record<string, Kind> = {
  Diary: 'diary', Projects: 'project', Areas: 'area', Resources: 'resource',
  Archive: 'archive', Inbox: 'inbox', Attachments: 'attachment'
}

export const KIND_FOLDER: Record<'project' | 'area' | 'resource', string> = {
  project: 'Projects', area: 'Areas', resource: 'Resources'
}

export function classify(rel: string): PathInfo {
  const parts = rel.split('/')
  const base = parts[parts.length - 1]
  const name = base.replace(/\.md$/i, '')
  let kind: Kind = parts.length === 1 ? (rel === 'Habits.md' ? 'habits' : 'other') : (TOP[parts[0]] ?? 'other')
  if (parts.length === 1 && TOP[parts[0]]) kind = TOP[parts[0]]
  let container: string | null = null
  if (kind === 'inbox') container = 'Inbox'
  else if (['project', 'area', 'resource', 'archive'].includes(kind) && parts.length >= 3) {
    container = `${parts[0]}/${parts[1]}`
  }
  const isTasksFile = base === 'Tasks.md' && container !== null && kind !== 'archive'
  const isHomeNote = container !== null && kind !== 'inbox' && parts.length === 3 && name === parts[1]
  return { kind, container, isTasksFile, isHomeNote, name }
}

/** null when the name is usable, otherwise the message to show the owner */
export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Name cannot be empty'
  if (/[/\\:[\]|#^]/.test(n)) return 'Name cannot contain / \\ : [ ] | # ^'
  if (n.startsWith('.')) return 'Name cannot start with a dot'
  if (n.toLowerCase() === 'tasks') return '"Tasks" is reserved for task lists'
  if (n.length > 120) return 'Name is too long'
  return null
}
