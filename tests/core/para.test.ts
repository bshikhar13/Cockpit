import { expect, test } from 'vitest'
import { classify, validateName } from '../../src/core/para'

test('classifies vault paths', () => {
  expect(classify('Diary/2026/2026-11-11.md')).toMatchObject({ kind: 'diary', container: null })
  expect(classify('Projects/Launch/Launch.md')).toMatchObject({
    kind: 'project', container: 'Projects/Launch', isHomeNote: true, isTasksFile: false
  })
  expect(classify('Areas/Job/Tasks.md')).toMatchObject({ kind: 'area', container: 'Areas/Job', isTasksFile: true })
  expect(classify('Inbox/Tasks.md')).toMatchObject({ kind: 'inbox', container: 'Inbox', isTasksFile: true })
  expect(classify('Archive/Launch/Tasks.md')).toMatchObject({ kind: 'archive', isTasksFile: false })
  expect(classify('Resources/Pricing/Tiering.md')).toMatchObject({
    kind: 'resource', container: 'Resources/Pricing', name: 'Tiering', isHomeNote: false
  })
  expect(classify('Habits.md')).toMatchObject({ kind: 'habits' })
  expect(classify('Attachments/p.png')).toMatchObject({ kind: 'attachment' })
  expect(classify('Loose.md')).toMatchObject({ kind: 'other', name: 'Loose' })
})

test('rejects names that break filenames or links', () => {
  for (const bad of ['a/b', 'a:b', 'a[b', 'a]b', 'a|b', 'a#b', 'a^b', 'a\\b', '.hidden', '', '   ', 'Tasks', 'tasks']) {
    expect(validateName(bad), bad).not.toBeNull()
  }
  expect(validateName('Client: pilot')).not.toBeNull()
  expect(validateName('Client pilot')).toBeNull()
  expect(validateName("Robin's notes (v2)")).toBeNull()
})
