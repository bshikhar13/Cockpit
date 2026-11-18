import { type Document, isMap, parse, parseDocument } from 'yaml'

const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m

/**
 * Finds the frontmatter block. A leading `---` block that parses cleanly to something other than
 * a YAML map (prose between two horizontal rules) is the owner's text, not frontmatter. A block
 * that fails to parse is still reported, so that edits refuse it instead of guessing.
 */
export function splitFrontmatter(text: string): { yaml: string | null; body: string; bodyOffset: number } {
  const none = { yaml: null, body: text, bodyOffset: 0 }
  const m = text.startsWith('---') ? BLOCK.exec(text) : null
  if (!m || m.index !== 0) return none
  const doc = parseDocument(m[1])
  if (!doc.errors.length && doc.contents !== null && !isMap(doc.contents)) return none
  return { yaml: m[1], body: text.slice(m[0].length), bodyOffset: m[0].length }
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function block(yaml: string, eol: string): string {
  const inner = yaml.endsWith('\n') || yaml === '' ? yaml : yaml + '\n'
  return `---\n${inner}---\n`.replace(/\r?\n/g, eol)
}

/** {} when there is no frontmatter or it is not a valid YAML map */
export function readFrontmatter(text: string): Record<string, unknown> {
  const { yaml } = splitFrontmatter(text)
  if (yaml === null) return {}
  try {
    const data = parse(yaml)
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Edits the frontmatter in place, keeping key order, comments, and every byte of the body.
 * Returns the text unchanged when `edit` returns false. Throws 'invalid frontmatter' when the
 * existing block does not parse, and writes nothing. A block left with no keys is removed.
 */
export function editFrontmatter(text: string, edit: (doc: Document) => boolean): string {
  const { yaml, body } = splitFrontmatter(text)
  const doc = parseDocument(yaml ?? '')
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) throw new Error('invalid frontmatter')
  if (!edit(doc)) return text
  const empty = doc.contents === null || (isMap(doc.contents) && doc.contents.items.length === 0)
  if (empty) return body
  return block(doc.toString({ lineWidth: 0, flowCollectionPadding: false }), eolOf(text)) + body
}

/** Sets the given keys, removing those whose value is null or ''. Everything else is kept as written. */
export function updateFrontmatter(text: string, changes: Record<string, unknown>): string {
  return editFrontmatter(text, (doc) => {
    let changed = false
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue
      if (value === null || value === '') {
        if (doc.has(key)) {
          doc.delete(key)
          changed = true
        }
      } else if (doc.get(key) !== value) {
        doc.set(key, value)
        changed = true
      }
    }
    return changed
  })
}
