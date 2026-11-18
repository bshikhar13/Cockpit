import type { EditorState, TransactionSpec } from '@codemirror/state'

/** The smallest single replacement that turns `before` into `after`; null if they are equal. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) }
}

/**
 * Applies a text-to-text function to the open document as one small edit, so that changes made
 * by the app (a habit tick in the frontmatter) and the owner's unsaved typing never collide.
 */
export function transformDoc(state: EditorState, fn: (text: string) => string): TransactionSpec | null {
  const before = state.doc.toString() // always \n-joined, matching document positions
  const change = minimalChange(before, fn(before).replace(/\r\n/g, '\n'))
  if (!change) return null
  return { changes: { ...change, insert: state.toText(change.insert.replace(/\n/g, state.lineBreak)) } }
}
