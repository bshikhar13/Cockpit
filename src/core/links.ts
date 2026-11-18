export interface Wikilink {
  target: string
  alias?: string
  from: number
  to: number
}

const LINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g

/** Character ranges covered by fenced code blocks and inline code spans. */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let pos = 0
  let fence: { marker: string; start: number } | null = null
  for (const line of text.split('\n')) {
    const end = pos + line.length
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence.marker[0] && m[1].length >= fence.marker.length) {
        ranges.push([fence.start, end])
        fence = null
      }
    } else if (m) {
      fence = { marker: m[1], start: pos }
    } else {
      for (const c of line.matchAll(/(`+)[^`]*?\1/g)) ranges.push([pos + c.index!, pos + c.index! + c[0].length])
    }
    pos = end + 1
  }
  if (fence) ranges.push([fence.start, text.length])
  return ranges
}

export function extractWikilinks(text: string): Wikilink[] {
  const code = codeRanges(text)
  const out: Wikilink[] = []
  for (const m of text.matchAll(LINK)) {
    const from = m.index!
    if (code.some(([a, b]) => from >= a && from < b)) continue
    const link: Wikilink = { target: m[1].trim(), from, to: from + m[0].length }
    if (m[2] !== undefined) link.alias = m[2].trim()
    out.push(link)
  }
  return out
}

/** Points every link to oldName at newName. Nothing else in the text changes. */
export function rewriteWikilinks(text: string, oldName: string, newName: string): string {
  const wanted = oldName.trim().toLowerCase()
  let out = ''
  let last = 0
  for (const link of extractWikilinks(text)) {
    if (link.target.toLowerCase() !== wanted) continue
    out += text.slice(last, link.from) + `[[${newName}${link.alias !== undefined ? '|' + link.alias : ''}]]`
    last = link.to
  }
  return out + text.slice(last)
}
