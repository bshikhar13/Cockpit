import { useCallback, useEffect, useMemo, useState } from 'react'
import { dateFromDiaryPath } from '../../core/diary'
import { api } from './api'
import { NavContext, type Nav, type Route } from './nav'
import { HabitsScreen } from './screens/HabitsScreen'
import { NotePage } from './screens/NotePage'
import { TasksScreen } from './screens/TasksScreen'
import { Today } from './screens/Today'
import { CommandPalette, noteOpened } from './shell/CommandPalette'
import { EncryptDialog } from './shell/EncryptDialog'
import { Sidebar } from './shell/Sidebar'
import { UnlockScreen } from './shell/UnlockScreen'
import { VaultPicker } from './shell/VaultPicker'
import { useVault } from './useVault'

export function App(): JSX.Element | null {
  const { data: state, reload } = useVault(() => api.app.state())
  const [route, setRoute] = useState<Route>({ screen: 'today' })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focus, setFocusState] = useState(false)
  const setFocus = useCallback((on: boolean) => {
    setFocusState(on)
    void api.app.setFocusMode(on)
  }, [])
  // Held here, above the switch between screens: setting up encryption changes which screen is
  // showing, and the recovery key must stay up until the owner confirms they have saved it.
  const [encrypting, setEncrypting] = useState<{ copyCurrent: boolean; path: string | null } | null>(null)

  // focus mode is for writing; going to Tasks or Habits leaves it
  useEffect(() => {
    if (focus && (route.screen === 'tasks' || route.screen === 'habits')) setFocus(false)
  }, [route, focus, setFocus])

  const openNote = useCallback((rel: string) => {
    const date = dateFromDiaryPath(rel)
    noteOpened(rel)
    setRoute(date ? { screen: 'today', date } : { screen: 'note', rel })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      const screens = { '1': 'today', '2': 'tasks', '3': 'habits' } as const
      if (mod && !e.shiftKey && !e.altKey && e.key in screens) {
        // Cmd+1, Cmd+2, Cmd+3: Today, Tasks, Habits, from anywhere
        e.preventDefault()
        setFocus(false)
        setPaletteOpen(false)
        setRoute({ screen: screens[e.key as keyof typeof screens] })
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFocusState((on) => {
          void api.app.setFocusMode(!on)
          return !on
        })
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        setFocusState((on) => {
          if (on) void api.app.setFocusMode(false)
          return false
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocus])

  const nav = useMemo<Nav>(
    () => ({
      route,
      navigate: setRoute,
      openNote,
      openPalette: () => setPaletteOpen(true),
      today: state?.today ?? '',
      focus,
      setFocus
    }),
    [route, openNote, state?.today, focus, setFocus]
  )

  if (!state) return null

  const screen = state.locked ? (
    <UnlockScreen path={state.vaultPath} onUnlocked={reload} />
  ) : !state.vaultUsable ? (
    <VaultPicker missingPath={state.vaultPath} onChosen={reload} onEncrypt={() => setEncrypting({ copyCurrent: false, path: null })} />
  ) : (
    <NavContext.Provider value={nav}>
      <div className={`app ${focus ? 'focus-mode' : ''}`} data-testid="app">
        <Sidebar state={state} onStateChange={reload} onEncrypt={() => setEncrypting({ copyCurrent: true, path: state.vaultPath })} />
        <main className="main">
          {route.screen === 'today' && <Today date={route.date} />}
          {route.screen === 'tasks' && <TasksScreen key={route.tab ?? 'today'} initialTab={route.tab} />}
          {route.screen === 'habits' && <HabitsScreen />}
          {route.screen === 'note' && <NotePage key={route.rel} rel={route.rel} />}
        </main>
        {focus && (
          <button className="focus-exit" onClick={() => setFocus(false)} data-testid="focus-exit">
            Esc to leave focus
          </button>
        )}
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </NavContext.Provider>
  )

  return (
    <>
      {screen}
      {encrypting && (
        <EncryptDialog
          copyCurrent={encrypting.copyCurrent}
          currentPath={encrypting.path}
          onDone={reload}
          onClose={() => {
            setEncrypting(null)
            reload()
          }}
        />
      )}
    </>
  )
}
