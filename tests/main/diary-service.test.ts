import { afterEach, expect, test, vi } from 'vitest'
import { DiaryService } from '../../src/main/services/diary'
import { tempVault } from './helpers'

afterEach(() => vi.useRealTimers())

test('today follows the rollover hour; opening a day never creates or overwrites its file', async () => {
  const { v, ix } = await tempVault()
  const clock = new Date(2026, 10, 12, 3, 59)
  const d = new DiaryService(v, ix, () => ({ vaultPath: '', rolloverHour: 4, encrypted: false }), () => clock)
  expect(d.today()).toBe('2026-11-11')
  expect(await d.open('2026-11-11')).toBe('Diary/2026/2026-11-11.md')
  expect(await v.exists('Diary/2026/2026-11-11.md')).toBe(false)
  expect((await d.read('Diary/2026/2026-11-11.md')).text).toBe('---\ndate: 2026-11-11\n---\n\n')
  await v.write('Diary/2026/2026-11-11.md', 'mine')
  await d.open('2026-11-11')
  expect((await v.read('Diary/2026/2026-11-11.md')).text).toBe('mine')
  await expect(d.open('not-a-date')).rejects.toThrow()
})

test('day change fires exactly once when the clock crosses the rollover hour', async () => {
  const { v, ix } = await tempVault()
  vi.useFakeTimers()
  let clock = new Date(2026, 10, 12, 3, 59)
  const d = new DiaryService(v, ix, () => ({ vaultPath: '', rolloverHour: 4, encrypted: false }), () => clock)
  const seen: string[] = []
  const stop = d.watchDayChange((x) => seen.push(x))
  vi.advanceTimersByTime(30_000)
  expect(seen).toEqual([])
  clock = new Date(2026, 10, 12, 4, 0)
  vi.advanceTimersByTime(30_000)
  vi.advanceTimersByTime(30_000)
  expect(seen).toEqual(['2026-11-12'])
  stop()
  clock = new Date(2026, 10, 13, 5, 0)
  vi.advanceTimersByTime(60_000)
  expect(seen).toEqual(['2026-11-12'])
})
