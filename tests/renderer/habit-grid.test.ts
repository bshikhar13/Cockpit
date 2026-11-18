import { expect, test } from 'vitest'
import { buildGrid } from '../../src/renderer/src/components/HabitGrid'

test('grid has one Monday-to-Sunday week per column, ending with the current week', () => {
  const g = buildGrid('2026-11-11', 12, ['Run'], {
    '2026-11-09': { Run: true },
    '2026-11-11': { Run: true },
    '2026-08-24': { Run: true }
  })
  expect(g).toHaveLength(12)
  expect(g[11].start).toBe('2026-11-09')
  expect(g[11].days).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
  expect(g[11].counts).toEqual({ Run: 2 })
  expect(g[0].start).toBe('2026-08-24')
  expect(g[0].counts).toEqual({ Run: 1 })
  expect(g[5].counts).toEqual({ Run: 0 })
})

test('Sunday belongs to the week that began on Monday', () => {
  expect(buildGrid('2026-11-15', 1, [], {})[0].start).toBe('2026-11-09')
  expect(buildGrid('2026-11-16', 1, [], {})[0].start).toBe('2026-11-16')
})
