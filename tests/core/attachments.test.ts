import { expect, test } from 'vitest'
import { attachmentUrl, relFromAttachmentUrl } from '../../src/core/attachments'

test('resolves a link relative to its note into a vault URL', () => {
  expect(attachmentUrl('Diary/2026/2026-11-11.md', '../../Attachments/my%20pic.png')).toBe(
    'cockpit-file://vault/Attachments/my%20pic.png'
  )
  expect(attachmentUrl('Inbox/Idea.md', 'local.png')).toBe('cockpit-file://vault/Inbox/local.png')
})

test('web URLs pass through and escapes from the vault are refused', () => {
  expect(attachmentUrl('Inbox/Idea.md', 'https://e.com/i.jpg')).toBe('https://e.com/i.jpg')
  expect(attachmentUrl('Inbox/Idea.md', '../../etc/passwd')).toBeNull()
  expect(attachmentUrl('Inbox/Idea.md', '/etc/passwd')).toBeNull()
})

test('a vault URL maps back to a relative path', () => {
  expect(relFromAttachmentUrl('cockpit-file://vault/Attachments/my%20pic.png')).toBe('Attachments/my pic.png')
})
