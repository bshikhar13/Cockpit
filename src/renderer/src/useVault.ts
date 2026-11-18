import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/** Loads data from the back end and reloads it whenever the vault or the day changes. */
export function useVault<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; reload(): void } {
  const [data, setData] = useState<T>()
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let live = true
    loadRef.current().then(
      (d) => live && setData(d),
      () => undefined
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  useEffect(() => {
    const offVault = api.on('vault-changed', reload)
    const offDay = api.on('day-changed', reload)
    return () => {
      offVault()
      offDay()
    }
  }, [reload])

  return { data, reload }
}
