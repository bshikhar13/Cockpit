import { useRef } from 'react'
import { addDays } from '../../../core/day'
import { setHabitTick } from '../../../core/diary'
import { api } from '../api'
import { DayTape } from '../components/DayTape'
import { HabitTicks } from '../components/HabitTicks'
import { TaskAdd } from '../components/TaskAdd'
import { longDate, TaskRow } from '../components/TaskRow'
import { Editor, type EditorHandle } from '../editor/Editor'
import { useNav } from '../nav'
import { useVault } from '../useVault'

export function Today(props: { date?: string }): JSX.Element | null {
  const nav = useNav()
  const today = nav.today
  const editor = useRef<EditorHandle>(null)
  // with no explicit date the screen follows the real today, including across the day rollover
  const date = props.date ?? today
  const diary = useVault(() => (date ? api.diary.open(date) : Promise.resolve(null)), [date])
  // the rail belongs to the day in view: its tasks, and what was finished on it
  const tasks = useVault(() => (date ? api.tasks.list({ view: 'day', date }) : Promise.resolve([])), [date])
  const due = useVault(() => (date ? api.tasks.dueDates(addDays(date, -3), addDays(date, 3)) : Promise.resolve({})), [date])
  const habits = useVault(() => api.habits.list())
  const ticks = useVault(() => (date ? api.habits.history(date, date) : Promise.resolve({})), [date])
  const go = (d: string): void => nav.navigate(d === today ? { screen: 'today' } : { screen: 'today', date: d })
  // The diary page is open in the editor, so a habit tick is made as an edit there: one writer per file.
  const tick = async (name: string, value: boolean): Promise<void> => {
    const done = await editor.current?.transform((text) => setHabitTick(text, name, value))
    if (!done) await api.habits.setTick(date, name, value)
  }
  if (!date) return null
  const rel = diary.data && diary.data.includes(date) ? diary.data : null
  const active = habits.data?.active ?? []
  const ticked = active.filter((h) => (ticks.data as Record<string, Record<string, boolean>> | undefined)?.[date]?.[h]).length
  const two = (n: number): string => String(n).padStart(2, '0')
  const openTasks = (tasks.data ?? []).filter((t) => !t.done)
  const dayName = longDate(date).split(', ')[1]

  return (
    <>
      <header className="page-header">
        <h1 data-testid="today-heading">{longDate(date)}</h1>
        <button onClick={() => go(addDays(date, -1))} title="Previous day">‹</button>
        <button onClick={() => go(addDays(date, 1))} title="Next day">›</button>
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} />
        {date !== today && <button onClick={() => go(today)}>Today</button>}
        <button onClick={() => nav.setFocus(true)} title="Write with nothing else on screen (⌘⇧F)" data-testid="focus-button">
          Focus
        </button>
      </header>
      <DayTape date={date} today={today} due={due.data} onPick={go} />
      <div className="page-body">
        <div className="page-scroll">
          <div className="column">{rel && <Editor ref={editor} key={rel} rel={rel} autoFocus placeholder="What's on your mind?" />}</div>
        </div>
        <aside className="rail" data-testid="rail">
          <div className="gauges">
            <div className={`gauge ${openTasks.some((t) => t.due !== undefined && t.due < today) ? 'caution' : ''}`}>
              <span className="gauge-label">Due</span>
              <span className="gauge-value" data-testid="gauge-due">{two(openTasks.length)}</span>
            </div>
            <div className={`gauge ${active.length > 0 && ticked === active.length ? 'ok' : ''}`}>
              <span className="gauge-label">Habits</span>
              <span className="gauge-value">
                {two(ticked)}
                <small>/{two(active.length)}</small>
              </span>
            </div>
          </div>
          <h4 data-testid="rail-tasks-heading">{date === today ? "Today's tasks" : `Tasks · ${dayName}`}</h4>
          {tasks.data?.length === 0 && <div className="empty">{date === today ? 'Nothing due today.' : 'Nothing due on this day.'}</div>}
          {tasks.data?.map((t) => <TaskRow key={`${t.file}:${t.id ?? t.line}`} task={t} today={today} showContainer />)}
          <TaskAdd key={date} defaultDue={date} pickContainer />
          <h4>Habits{date !== today ? ` · ${dayName}` : ''}</h4>
          <HabitTicks date={date} onTick={tick} />
        </aside>
      </div>
    </>
  )
}
