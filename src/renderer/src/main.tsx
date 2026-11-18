import { createRoot } from 'react-dom/client'
import { api } from './api'
import { App } from './App'
import { flushAll } from './editor/noteSession'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)

// Before the window closes or the app quits, the back end asks for every open note to be saved.
api.on('flush-request', () => {
  void flushAll().finally(() => void api.app.flushed())
})

// A file dropped anywhere but the editor is ignored; by default the window would open it and replace the app.
for (const type of ['dragover', 'drop'] as const) {
  document.addEventListener(type, (e) => {
    if (!e.defaultPrevented) e.preventDefault()
  })
}
