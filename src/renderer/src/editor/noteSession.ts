export interface NoteIo {
  read(rel: string): Promise<{ text: string; hash: string }>
  save(rel: string, text: string, baseHash: string | null): Promise<{ hash: string; conflictCopy?: string }>
}

export interface SessionEvents {
  /** a new version of the text arrived from disk */
  onLoaded(text: string): void
  onConflict(conflictCopy: string): void
  onError(message: string | null): void
}

const live = new Set<NoteSession>()

/** Saves every note with unsaved edits. Used before the window closes and before files are moved. */
export async function flushAll(): Promise<void> {
  await Promise.all([...live].map((s) => s.flush()))
}

/** True while any open note still has text that has not reached the disk. */
export function anyUnsaved(): boolean {
  return [...live].some((s) => s.dirty)
}

/**
 * One open note: reads it, saves the owner's edits shortly after they stop typing, retries a
 * failed save, and never writes unless the text differs from what is on disk.
 */
export class NoteSession {
  private hash: string | null = null
  private onDisk: string | null = null
  private pending: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private rel: string,
    private io: NoteIo,
    private events: SessionEvents,
    private opts = { saveDelay: 600, retryDelay: 3000 }
  ) {
    live.add(this)
  }

  get dirty(): boolean {
    return this.pending !== null
  }

  async load(): Promise<void> {
    if (this.pending !== null || this.disposed) return // unsaved edits: the next save sorts out any conflict
    try {
      const file = await this.io.read(this.rel)
      if (this.pending !== null || this.disposed) return
      this.hash = file.hash
      if (file.text !== this.onDisk) {
        this.onDisk = file.text
        this.events.onLoaded(file.text)
      }
      this.events.onError(null)
    } catch {
      if (!this.disposed) this.events.onError('This note could not be read. It may have been moved or deleted.')
    }
  }

  change(text: string): void {
    this.clearTimer()
    if (text === this.onDisk) {
      this.pending = null
      return
    }
    this.pending = text
    this.timer = setTimeout(() => void this.flush(), this.opts.saveDelay)
  }

  flush(): Promise<void> {
    this.clearTimer()
    this.saving = this.saving.then(async () => {
      const text = this.pending
      if (text === null) return
      try {
        const result = await this.io.save(this.rel, text, this.hash)
        this.hash = result.hash
        this.onDisk = text
        if (this.pending === text) this.pending = null
        if (result.conflictCopy) this.events.onConflict(result.conflictCopy)
        this.events.onError(null)
      } catch {
        this.events.onError('Could not save. Your text is still here and Cockpit will keep trying.')
        if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.opts.retryDelay)
      }
      if (this.disposed && this.pending === null) live.delete(this)
    })
    return this.saving
  }

  /** The screen showing this note is closing: save what is left. Stays registered until that save lands. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.flush()
    if (this.pending === null) live.delete(this)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
