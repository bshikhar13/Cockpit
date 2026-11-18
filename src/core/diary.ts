import { isDate } from './day'
import { editFrontmatter, readFrontmatter } from './frontmatter'

export function diaryPath(date: string): string {
  return `Diary/${date.slice(0, 4)}/${date}.md`
}

export function dateFromDiaryPath(rel: string): string | null {
  const m = /^Diary\/\d{4}\/(\d{4}-\d{2}-\d{2})\.md$/.exec(rel)
  return m && isDate(m[1]) ? m[1] : null
}

export function newDiaryText(date: string): string {
  return `---\ndate: ${date}\n---\n\n`
}

/** habit name -> true, for every habit ticked in this diary file */
export function readHabitTicks(text: string): Record<string, boolean> {
  const habits = readFrontmatter(text).habits
  const out: Record<string, boolean> = {}
  if (habits && typeof habits === 'object' && !Array.isArray(habits)) {
    for (const [name, value] of Object.entries(habits)) if (value === true) out[name] = true
  }
  return out
}

export function setHabitTick(text: string, habit: string, value: boolean): string {
  return editFrontmatter(text, (doc) => {
    const has = doc.hasIn(['habits', habit])
    if (value) {
      if (doc.getIn(['habits', habit]) === true) return false
      doc.setIn(['habits', habit], true)
      return true
    }
    if (!has) return false
    doc.deleteIn(['habits', habit])
    const map = doc.get('habits') as { items?: unknown[] } | undefined
    if (!map?.items?.length) doc.delete('habits')
    return true
  })
}

export function renameHabitTick(text: string, from: string, to: string): string {
  return editFrontmatter(text, (doc) => {
    if (!doc.hasIn(['habits', from])) return false
    const value = doc.getIn(['habits', from])
    doc.deleteIn(['habits', from])
    doc.setIn(['habits', to], value)
    return true
  })
}
