import { expect, test } from 'vitest'
import { daysLeft, PROJECT_STATUSES, projectStatus } from '../../src/core/projects'

test('days left counts down to the deadline and says plainly when it has passed', () => {
  expect(daysLeft('2026-11-30', '2026-11-18')).toEqual({ days: 12, label: '12 days left', tone: 'ok' })
  expect(daysLeft('2026-11-25', '2026-11-18')).toEqual({ days: 7, label: '7 days left', tone: 'near' })
  expect(daysLeft('2026-11-19', '2026-11-18')).toEqual({ days: 1, label: '1 day left', tone: 'near' })
  expect(daysLeft('2026-11-18', '2026-11-18')).toEqual({ days: 0, label: 'Due today', tone: 'near' })
  expect(daysLeft('2026-11-17', '2026-11-18')).toEqual({ days: -1, label: '1 day overdue', tone: 'over' })
  expect(daysLeft('2026-11-08', '2026-11-18')).toEqual({ days: -10, label: '10 days overdue', tone: 'over' })
  expect(daysLeft(undefined, '2026-11-18')).toBeNull()
  expect(daysLeft('not a date', '2026-11-18')).toBeNull()
})

test('a project is active, to be picked up, or done; anything else reads as active', () => {
  expect(PROJECT_STATUSES.map((s) => [s.value, s.label])).toEqual([
    ['active', 'Active'],
    ['to-pick-up', 'To be picked up'],
    ['done', 'Done']
  ])
  expect(projectStatus('done')).toBe('done')
  expect(projectStatus('to-pick-up')).toBe('to-pick-up')
  expect(projectStatus('To be picked up')).toBe('to-pick-up') // typed by hand in the file
  expect(projectStatus(undefined)).toBe('active')
  expect(projectStatus('someday')).toBe('active')
})
