export interface HabitList {
  active: string[]
  archived: string[]
}

type Section = 'active' | 'archived' | 'other'
interface Item {
  line: number
  name: string
  section: Section
}

const BULLET = /^[-*+]\s+(.+?)\s*$/
const ARCHIVED_HEADING = /^##\s+archived\b/i
const HEADING = /^#{1,6}\s/

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Habits are the top-level bullets before any second-level heading (active) and under a heading
 * that starts "## Archived". Indented bullets, prose, and other sections are the owner's own
 * notes: they are never read as habits and never changed.
 */
function scan(lines: string[]): Item[] {
  const items: Item[] = []
  let section: Section = 'active'
  lines.forEach((line, i) => {
    if (ARCHIVED_HEADING.test(line)) section = 'archived'
    else if (/^##\s/.test(line)) section = 'other'
    const m = BULLET.exec(line)
    if (m && section !== 'other') items.push({ line: i, name: m[1], section })
  })
  return items
}

export function parseHabits(text: string): HabitList {
  const items = scan(text.split(/\r?\n/))
  return {
    active: items.filter((i) => i.section === 'active').map((i) => i.name),
    archived: items.filter((i) => i.section === 'archived').map((i) => i.name)
  }
}

function edit(text: string, fn: (lines: string[], items: Item[]) => void): string {
  const eol = eolOf(text)
  const lines = text.split(eol)
  fn(lines, scan(lines))
  return lines.join(eol)
}

/** Index after which to insert a new item of a section: its last item, counting that item's indented children. */
function endOf(lines: string[], item: Item): number {
  let end = item.line
  while (end + 1 < lines.length && /^\s+\S/.test(lines[end + 1])) end++
  return end
}

function insertInto(lines: string[], items: Item[], section: 'active' | 'archived', name: string): void {
  const mine = items.filter((i) => i.section === section)
  if (mine.length) {
    lines.splice(endOf(lines, mine[mine.length - 1]) + 1, 0, `- ${name}`)
    return
  }
  if (section === 'archived') {
    const heading = lines.findIndex((l) => ARCHIVED_HEADING.test(l))
    if (heading >= 0) {
      const blank = lines[heading + 1] === '' ? 1 : 0
      lines.splice(heading + 1 + blank, 0, `- ${name}`)
      return
    }
    // no archived section yet: add one at the end of the file
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push('', '## Archived', '', `- ${name}`, '')
    return
  }
  // first active habit: under the title if there is one, before any other section
  const firstSection = lines.findIndex((l) => /^##\s/.test(l))
  const title = lines.findIndex((l) => HEADING.test(l) && !/^##/.test(l))
  if (title >= 0 && (firstSection < 0 || title < firstSection)) {
    const next = lines[title + 1]
    if (next === undefined) lines.push('', `- ${name}`, '')
    else if (next === '' && title + 2 >= lines.length) lines.splice(title + 1, 0, '', `- ${name}`)
    else lines.splice(title + 1, 0, '', `- ${name}`)
  } else lines.splice(firstSection >= 0 ? firstSection : 0, 0, `- ${name}`, ...(firstSection >= 0 ? [''] : []))
}

function find(items: Item[], name: string, section?: Section): Item | undefined {
  return items.find((i) => i.name === name && (!section || i.section === section))
}

export function addHabit(text: string, name: string): string {
  return edit(text.trim() === '' ? '# Habits\n' : text, (lines, items) => insertInto(lines, items, 'active', name))
}

export function renameHabit(text: string, from: string, to: string): string {
  return edit(text, (lines, items) => {
    const item = find(items, from)
    if (item) lines[item.line] = lines[item.line].replace(BULLET, (whole, old: string) => whole.replace(old, to))
  })
}

function moveHabit(text: string, name: string, from: 'active' | 'archived', to: 'active' | 'archived'): string {
  return edit(text, (lines, items) => {
    const item = find(items, name, from)
    if (!item) return
    lines.splice(item.line, 1)
    insertInto(lines, scan(lines), to, name)
  })
}

export const archiveHabit = (text: string, name: string): string => moveHabit(text, name, 'active', 'archived')
export const unarchiveHabit = (text: string, name: string): string => moveHabit(text, name, 'archived', 'active')

/** Puts active habits in the given order by rewriting only their own lines. Unlisted habits keep their relative order at the end. */
export function reorderHabits(text: string, order: string[]): string {
  return edit(text, (lines, items) => {
    const active = items.filter((i) => i.section === 'active')
    const names = active.map((i) => i.name)
    const known = order.filter((n) => names.includes(n))
    const next = [...known, ...names.filter((n) => !known.includes(n))]
    active.forEach((item, i) => {
      lines[item.line] = `- ${next[i]}`
    })
  })
}
