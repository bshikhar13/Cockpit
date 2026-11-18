import { createContext, useContext } from 'react'

export type Route =
  | { screen: 'today'; date?: string }
  | { screen: 'tasks'; tab?: 'today' | 'upcoming' | 'inbox' | 'grouped' }
  | { screen: 'habits' }
  | { screen: 'note'; rel: string }

export interface Nav {
  route: Route
  navigate(route: Route): void
  /** open a note by path; diary pages open on the Today screen */
  openNote(rel: string): void
  openPalette(): void
  today: string
  /** distraction-free writing: only the page remains */
  focus: boolean
  setFocus(on: boolean): void
}

export const NavContext = createContext<Nav>(null as unknown as Nav)
export const useNav = (): Nav => useContext(NavContext)
