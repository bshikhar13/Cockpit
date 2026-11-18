import { isDate, logicalDate } from '../../core/day'
import { dateFromDiaryPath, diaryPath, newDiaryText } from '../../core/diary'
import type { Settings } from '../settings'
import type { Vault } from '../vault'
import type { VaultIndex } from '../vault-index'

export class DiaryService {
  constructor(
    private vault: Vault,
    private index: VaultIndex,
    private settings: () => Settings,
    private now: () => Date = () => new Date()
  ) {}

  today(): string {
    return logicalDate(this.now(), this.settings().rolloverHour)
  }

  /**
   * The path of a day's diary page. Nothing is created: a day the owner only looks at leaves no
   * file behind. The file comes into being the first time something is written or ticked.
   */
  async open(date: string): Promise<string> {
    if (!isDate(date)) throw new Error('Not a date')
    return diaryPath(date)
  }

  /** Reads a note. A diary page that does not exist yet reads as a blank page for its date. */
  async read(rel: string): Promise<{ text: string; hash: string }> {
    const date = dateFromDiaryPath(rel)
    if (date && !(await this.vault.exists(rel))) return { text: newDiaryText(date), hash: '' }
    return this.vault.read(rel)
  }

  /** Calls back once each time the logical day changes while the app is open. */
  watchDayChange(onChange: (today: string) => void): () => void {
    let last = this.today()
    const timer = setInterval(() => {
      const current = this.today()
      if (current !== last) {
        last = current
        onChange(current)
      }
    }, 30_000)
    return () => clearInterval(timer)
  }
}
