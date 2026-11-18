import { addDays, weekday } from '../../../core/day'

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export interface TapeDay {
  date: string
  weekday: string
  day: number
  /** the day in view */
  current: boolean
  today: boolean
}

/** Seven days centred on the day in view, like the heading tape on a flight display. */
export function tapeDays(date: string, today: string): TapeDay[] {
  return [-3, -2, -1, 0, 1, 2, 3].map((n) => {
    const d = addDays(date, n)
    return { date: d, weekday: WEEKDAYS[weekday(d)], day: Number(d.slice(8)), current: n === 0, today: d === today }
  })
}

export function DayTape(props: {
  date: string
  today: string
  /** date -> number of open tasks due that day */
  due?: Record<string, number>
  onPick: (date: string) => void
}): JSX.Element {
  return (
    <div className="tape" data-testid="day-tape">
      {tapeDays(props.date, props.today).map((d) => (
        <button
          key={d.date}
          className={`tape-day ${d.current ? 'current' : ''} ${d.today ? 'today' : ''}`}
          onClick={() => props.onPick(d.date)}
          title={`${d.today ? 'Today' : d.date}${props.due?.[d.date] ? ` · ${props.due[d.date]} task${props.due[d.date] > 1 ? 's' : ''} due` : ''}`}
        >
          <span className="tape-weekday">{d.weekday}</span>
          <span className="tape-num">{String(d.day).padStart(2, '0')}</span>
          {props.due?.[d.date] ? (
            <span className="tape-due" data-testid={`tape-due-${d.date}`}>
              {props.due[d.date]}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
