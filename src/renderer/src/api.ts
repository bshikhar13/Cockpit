import type { CockpitApi } from '../../core/types'
import { anyUnsaved, flushAll } from './editor/noteSession'
import { withFlush } from './flushGuard'

declare global {
  interface Window {
    cockpit: CockpitApi
  }
}

// Anything that renames, moves, removes, or rewrites note files saves open notes first.
const raw: CockpitApi | undefined = typeof window === 'undefined' ? undefined : window.cockpit
export const api: CockpitApi = withFlush(raw ?? ({} as CockpitApi), raw ? flushAll : async () => undefined, !raw ? [] : [
  'notes.rename', 'notes.move', 'notes.remove',
  'para.archive', 'para.unarchive', 'para.setProjectMeta',
  'habits.rename', 'app.chooseVault', 'app.createEncrypted'
])

if (raw) {
  // Locking throws the keys away. If something has not been saved yet, refuse, so it is not stranded.
  const lock = raw.app.lock
  api.app.lock = async () => {
    await flushAll()
    if (anyUnsaved()) throw new Error('Some changes are not saved yet. Try again in a moment.')
    return lock()
  }
}

/** The owner-facing part of an error that crossed the process boundary. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
