import { addDays, weekday } from '../../../core/day'
import { api } from '../api'
import { useVault } from '../useVault'

export interface GridWeek {
  /** the Monday */
  start: string
  days: string[]
  /** habit name -> days ticked that week */
  counts: Record<string, number>
}

/** Weeks run Monday to Sunday, oldest first; the last one contains `today`. */
export function buildGrid(
  today: string,
  weeks: number,
  habits: string[],
  history: Record<string, Record<string, boolean>>
): GridWeek[] {
  const monday = addDays(today, -((weekday(today) + 6) % 7))
  const out: GridWeek[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(monday, -7 * w)
    const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(start, n))
    const counts: Record<string, number> = {}
    for (const h of habits) counts[h] = days.filter((d) => history[d]?.[h]).length
    out.push({ start, days, counts })
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const short = (date: string): string => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`
const WEEKS = 12

export function HabitGrid({ today }: { today: string }): JSX.Element | null {
  const habits = useVault(() => api.habits.list())
  const from = buildGrid(today, WEEKS, [], {})[0].start
  const history = useVault(() => api.habits.history(from, today), [from, today])
  const active = habits.data?.active ?? []
  if (!habits.data || !history.data || active.length === 0) return null
  const grid = buildGrid(today, WEEKS, active, history.data)

  return (
    <div className="habit-sheet" data-testid="habit-grid">
      <div className="sheet-row sheet-head">
        <div className="sheet-name" />
        {grid.map((week) => (
          <div key={week.start} className="sheet-week">
            {short(week.start)}
          </div>
        ))}
      </div>
      {active.map((name) => (
        <div key={name} className="sheet-row">
          <div className="sheet-name" title={name}>
            {name}
          </div>
          {grid.map((week) => (
            <div key={week.start} className="sheet-week">
              <div className="week-cells">
                {week.days.map((day) => {
                  const on = history.data?.[day]?.[name] === true
                  return day > today ? (
                    <span key={day} className="cell future" />
                  ) : (
                    <button
                      key={day}
                      className={`cell ${on ? 'on' : ''}`}
                      title={`${name} · ${short(day)}`}
                      onClick={() => void api.habits.setTick(day, name, !on)}
                    />
                  )
                })}
              </div>
              <span className="week-count">{week.counts[name]}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
