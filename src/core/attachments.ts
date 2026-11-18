export const FILE_SCHEME = 'cockpit-file'

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** URL the app can load for a media link written in a note; null if it points outside the vault. */
export function attachmentUrl(noteRel: string, linkPath: string): string | null {
  if (/^https?:\/\//i.test(linkPath)) return linkPath
  if (linkPath.startsWith('/') || /^[a-z]+:/i.test(linkPath)) return null
  const parts = noteRel.split('/').slice(0, -1)
  for (const seg of linkPath.split('/').map(decode)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return `${FILE_SCHEME}://vault/${parts.map(encodeURIComponent).join('/')}`
}

export function relFromAttachmentUrl(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean).map(decode).join('/')
}
