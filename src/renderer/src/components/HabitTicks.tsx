import { useEffect, useState } from 'react'
import { addDays } from '../../../core/day'
import { api } from '../api'
import { useVault } from '../useVault'

/** oldest first, ending on `date` */
export function lastSevenDays(date: string): string[] {
  return [-6, -5, -4, -3, -2, -1, 0].map((n) => addDays(date, n))
}

export function HabitTicks({
  date,
  onTick
}: {
  date: string
  /** how to record a tick; defaults to writing the diary file directly */
  onTick?: (name: string, value: boolean) => Promise<void>
}): JSX.Element {
  const days = lastSevenDays(date)
  // shown immediately, until the saved file confirms it
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const habits = useVault(() => api.habits.list())
  const history = useVault(() => api.habits.history(days[0], date), [date])
  const active = habits.data?.active ?? []
  useEffect(() => setOptimistic({}), [history.data, date])
  const tick = async (name: string, value: boolean): Promise<void> => {
    setOptimistic((o) => ({ ...o, [name]: value }))
    try {
      setError('')
      await (onTick ? onTick(name, value) : api.habits.setTick(date, name, value))
    } catch {
      setOptimistic({})
      setError("Couldn't record that. Check the top of this day's file for broken formatting.")
    }
  }
  if (habits.data && active.length === 0) return <div className="empty">No habits yet. Add some on the Habits screen.</div>
  return (
    <div>
      {active.map((name) => {
        const on = optimistic[name] ?? history.data?.[date]?.[name] === true
        return (
          <label key={name} className="habit-tick" data-testid="habit-tick">
            <input type="checkbox" checked={on} onChange={() => void tick(name, !on)} />
            <span className="habit-name">{name}</span>
            <span className="dots" title="Last seven days">
              {days.map((d) => (
                <span key={d} className={`dot ${history.data?.[d]?.[name] ? 'on' : ''}`} />
              ))}
            </span>
          </label>
        )
      })}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
