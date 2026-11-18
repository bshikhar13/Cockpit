import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname, join } from 'path'
import { Readable } from 'stream'
import { FILE_SCHEME, relFromAttachmentUrl } from '../core/attachments'
import type { AppState } from '../core/types'
import type { Keys } from './crypto'
import { changeFolderPasscode, detectEncrypted, encryptInto, unlockFolder } from './encryption'
import { registerIpc, type Runtime } from './ipc'
import { DiaryService } from './services/diary'
import { HabitsService } from './services/habits'
import { NotesService } from './services/notes'
import { TasksService } from './services/tasks'
import { loadSettings, saveSettings, type Settings } from './settings'
import { Vault } from './vault'
import { VaultIndex } from './vault-index'
import { watchVault } from './watcher'

// Cockpit is a light-mode app: date pickers, menus, and scrollbars follow, whatever the system is set to.
nativeTheme.themeSource = 'light'

if (process.env.COCKPIT_USER_DATA) app.setPath('userData', process.env.COCKPIT_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.heic': 'image/heic',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf'
}

let settings: Settings
let runtime: Runtime | null = null
let stopWatching: Array<() => void> = []
let quitting = false
/** windows whose notes are saved and may close */
const readyToClose = new WeakSet<BrowserWindow>()
let finishClose: (() => void) | null = null
/** the last attachment decrypted, so seeking in a video does not decrypt the whole file for every request */
let lastDecrypted: { vault: Vault; rel: string; mtimeMs: number; bytes: Buffer } | null = null

const userData = (): string => app.getPath('userData')
const send = (event: string, payload: unknown): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(event, payload)
}

function closeVault(): void {
  stopWatching.forEach((stop) => stop())
  stopWatching = []
  runtime = null // the keys of an encrypted folder go with it: they are held nowhere else
  lastDecrypted = null
}

/** Opens a notes folder. Returns false, creating nothing, if the folder is not there. */
async function openVault(path: string, keys: Keys | null = null): Promise<boolean> {
  closeVault()
  if (!(await Vault.isUsable(path))) return false
  const vault = new Vault(path, (abs) => shell.trashItem(abs), keys)
  await vault.ensureSkeleton()
  const index = await VaultIndex.build(vault)
  const diary = new DiaryService(vault, index, () => settings)
  runtime = {
    vault,
    index,
    diary,
    notes: new NotesService(vault, index),
    tasks: new TasksService(vault, index, () => diary.today()),
    habits: new HabitsService(vault, index)
  }
  stopWatching.push(watchVault(vault, index, (rels) => send('vault-changed', rels)))
  stopWatching.push(diary.watchDayChange((today) => send('day-changed', today)))
  // If the folder disappears while the app is open (Drive stopped, folder renamed), go back to the picker.
  const gone = setInterval(async () => {
    if (runtime?.vault === vault && !(await Vault.isUsable(path))) {
      closeVault()
      send('vault-changed', [])
    }
  }, 5000)
  stopWatching.push(() => clearInterval(gone))
  return true
}

/** True when the chosen folder is an encrypted one. Remembered in settings, so a folder whose settings file has gone missing is still never opened as plain. */
async function folderIsEncrypted(path: string): Promise<boolean> {
  return (settings.encrypted && settings.vaultPath === path) || (await detectEncrypted(path, userData()))
}

async function appState(): Promise<AppState> {
  const there = settings.vaultPath !== null && (await Vault.isUsable(settings.vaultPath))
  const encrypted = runtime ? runtime.vault.encrypted : there && (await folderIsEncrypted(settings.vaultPath!))
  return {
    vaultPath: settings.vaultPath,
    vaultUsable: runtime !== null,
    rolloverHour: settings.rolloverHour,
    today: runtime ? runtime.diary.today() : '',
    duplicates: runtime ? runtime.index.duplicates() : [],
    encrypted,
    locked: runtime === null && encrypted,
    unreadable: runtime ? runtime.index.unreadable() : []
  }
}

/** The folder dialog. Tests name the folder through an environment variable instead. */
async function pickFolder(title: string): Promise<string | null> {
  if (process.env.COCKPIT_PICK_FOLDER) return process.env.COCKPIT_PICK_FOLDER
  const result = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
}

async function chooseVault(): Promise<boolean> {
  const picked = await pickFolder('Choose your notes folder')
  if (!picked || !(await Vault.isUsable(picked))) return false
  // decided from the settings file, the kept copy, and the files themselves: an encrypted folder is never opened as plain
  const encrypted = await detectEncrypted(picked, userData())
  if (encrypted) closeVault() // stays locked until the passcode is entered
  else if (!(await openVault(picked))) return false
  settings = { ...settings, vaultPath: picked, encrypted }
  saveSettings(userData(), settings)
  send('vault-changed', [])
  return true
}

async function unlock(secret: string): Promise<void> {
  if (!settings.vaultPath) throw new Error('No notes folder is chosen')
  const keys = await unlockFolder(settings.vaultPath, secret, userData())
  if (!(await openVault(settings.vaultPath, keys))) throw new Error('The notes folder is not available')
  settings = { ...settings, encrypted: true }
  saveSettings(userData(), settings)
  send('vault-changed', [])
}

async function lock(): Promise<void> {
  closeVault()
  send('vault-changed', [])
}

async function createEncrypted(passcode: string, copyCurrent: boolean): Promise<string | null> {
  const folder = await pickFolder('Choose an empty folder for your encrypted notes')
  if (!folder) return null
  // checks first, then creates, copies and verifies; on failure the new folder is left empty and nothing here changes
  const { keys, recoveryKey } = await encryptInto(copyCurrent && runtime ? runtime.vault : null, folder, passcode, userData())
  // From here the encrypted folder is complete. Point at it and hand back the recovery key even
  // if opening it hiccups: the key is shown once, and losing it now would be far worse.
  settings = { ...settings, vaultPath: folder, encrypted: true }
  saveSettings(userData(), settings)
  await openVault(folder, keys).catch(() => false)
  send('vault-changed', [])
  return recoveryKey
}

async function changePasscode(current: string, next: string): Promise<void> {
  if (!settings.vaultPath) throw new Error('No notes folder is chosen')
  await changeFolderPasscode(settings.vaultPath, current, next, userData())
}

/** Serves files from inside the vault, with range support so video can seek. */
async function serveVaultFile(request: Request): Promise<Response> {
  if (!runtime) return new Response('no vault', { status: 404 })
  try {
    const rel = relFromAttachmentUrl(request.url)
    const abs = runtime.vault.abs(rel)
    // an encrypted file has to be decrypted whole before any part of it can be served
    let decrypted: Buffer | null = null
    if (runtime.vault.encrypted) {
      const { mtimeMs } = await stat(abs)
      if (lastDecrypted?.vault !== runtime.vault || lastDecrypted.rel !== rel || lastDecrypted.mtimeMs !== mtimeMs) {
        lastDecrypted = { vault: runtime.vault, rel, mtimeMs, bytes: await runtime.vault.readBytes(rel) }
      }
      decrypted = lastDecrypted.bytes
    }
    const size = decrypted ? decrypted.length : (await stat(abs)).size
    const type = MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream'
    const body = (start?: number, end?: number): BodyInit =>
      decrypted
        ? new Uint8Array(decrypted.subarray(start ?? 0, end === undefined ? undefined : end + 1))
        : (Readable.toWeb(createReadStream(abs, start === undefined ? {} : { start, end })) as ReadableStream)
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      return new Response(body(start, end), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        }
      })
    }
    return new Response(body(), {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
    })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Cockpit',
    backgroundColor: '#fbfbf8',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // The window only ever shows the app. Links open in the browser; a dropped file never replaces it.
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })
  // Closing or quitting first lets the window save unsaved typing (autosave waits a moment after the last key).
  win.on('close', (event) => {
    if (readyToClose.has(win) || !runtime) return
    event.preventDefault()
    const timer = setTimeout(() => finishClose?.(), 3000)
    finishClose = () => {
      clearTimeout(timer)
      finishClose = null
      readyToClose.add(win)
      if (quitting) app.quit()
      else win.close()
    }
    win.webContents.send('flush-request')
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  // the packaged app takes its icon from the bundle; when run from source, show it in the Dock too
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  settings = loadSettings(userData())
  if (process.env.COCKPIT_VAULT) settings = { ...settings, vaultPath: process.env.COCKPIT_VAULT, encrypted: false }
  // an encrypted folder is not opened here: it waits, locked, for the passcode
  if (settings.vaultPath && (await Vault.isUsable(settings.vaultPath)) && !(await folderIsEncrypted(settings.vaultPath))) {
    await openVault(settings.vaultPath)
  }

  protocol.handle(FILE_SCHEME, serveVaultFile)
  registerIpc((channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args)), {
    runtime: () => runtime,
    appState,
    chooseVault,
    setRolloverHour: async (h) => {
      if (!Number.isInteger(h) || h < 0 || h > 6) throw new Error('Choose an hour between 0 and 6')
      settings = { ...settings, rolloverHour: h }
      saveSettings(userData(), settings)
      send('day-changed', runtime?.diary.today() ?? '')
    },
    flushed: () => finishClose?.(),
    unlock,
    lock,
    createEncrypted,
    changePasscode,
    // in the distraction-free writing mode the window's close/minimise buttons go too
    setFocusMode: (on) => {
      for (const win of BrowserWindow.getAllWindows()) win.setWindowButtonVisibility(!on)
    },
    emitChanged: () => send('vault-changed', [])
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => app.quit())
