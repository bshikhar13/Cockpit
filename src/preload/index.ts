import { contextBridge, ipcRenderer } from 'electron'
import { API_CHANNELS } from '../core/types'

const api: Record<string, any> = {}
for (const channel of API_CHANNELS) {
  const [ns, method] = channel.split('.')
  api[ns] ??= {}
  api[ns][method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
}
api.on = (event: string, cb: (payload: unknown) => void) => {
  const listener = (_e: unknown, payload: unknown): void => cb(payload)
  ipcRenderer.on(event, listener)
  return () => ipcRenderer.removeListener(event, listener)
}

contextBridge.exposeInMainWorld('cockpit', api)
