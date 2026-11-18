import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface Settings {
  vaultPath: string | null
  rolloverHour: number
  /** the notes folder is encrypted; remembered so it is never opened as a plain folder by mistake */
  encrypted: boolean
}

const DEFAULTS: Settings = { vaultPath: null, rolloverHour: 4, encrypted: false }

export function loadSettings(dir: string): Settings {
  const file = join(dir, 'settings.json')
  if (!existsSync(file)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return {
      vaultPath: typeof raw.vaultPath === 'string' ? raw.vaultPath : null,
      rolloverHour: Number.isInteger(raw.rolloverHour) ? raw.rolloverHour : DEFAULTS.rolloverHour,
      encrypted: raw.encrypted === true
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(dir: string, s: Settings): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(s, null, 2))
}
