import { diaryPath, newDiaryText, renameHabitTick, setHabitTick } from '../../core/diary'
import {
  addHabit, archiveHabit, parseHabits, renameHabit, reorderHabits, unarchiveHabit, type HabitList
} from '../../core/habits'
import type { Vault } from '../vault'
import type { VaultIndex } from '../vault-index'

const FILE = 'Habits.md'

export class HabitsService {
  constructor(
    private vault: Vault,
    private index: VaultIndex
  ) {}

  private async text(): Promise<string> {
    return (await this.vault.exists(FILE)) ? (await this.vault.read(FILE)).text : ''
  }

  async list(): Promise<HabitList> {
    return parseHabits(await this.text())
  }

  /** Changes Habits.md line by line, so anything else the owner keeps in that file survives. */
  private async change(fn: (text: string) => string): Promise<void> {
    const before = await this.text()
    const after = fn(before)
    if (after !== before) await this.vault.write(FILE, after)
  }

  private checkName(name: string, list: HabitList, except?: string): string {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (!clean) throw new Error('A habit needs a name')
    const taken = [...list.active, ...list.archived].filter((h) => h !== except)
    if (taken.some((h) => h.toLowerCase() === clean.toLowerCase())) throw new Error(`A habit named "${clean}" already exists`)
    return clean
  }

  async add(name: string): Promise<void> {
    const clean = this.checkName(name, await this.list())
    await this.change((text) => addHabit(text, clean))
  }

  async rename(from: string, to: string): Promise<void> {
    const clean = this.checkName(to, await this.list(), from)
    if (clean === from) return
    // diary files first: if one cannot be read the rename stops before the list changes, and can be retried
    for (const rel of this.index.diaryFiles()) {
      const { text } = await this.vault.read(rel)
      let renamed: string
      try {
        renamed = renameHabitTick(text, from, clean)
      } catch {
        continue // a diary file with broken frontmatter is left exactly as it is
      }
      if (renamed !== text) {
        await this.vault.write(rel, renamed)
        this.index.upsert(rel, renamed)
      }
    }
    await this.change((text) => renameHabit(text, from, clean))
  }

  /** Sets the order of active habits. Habits missing from the list keep their place at the end. */
  async reorder(active: string[]): Promise<void> {
    await this.change((text) => reorderHabits(text, active))
  }

  async archive(name: string): Promise<void> {
    await this.change((text) => archiveHabit(text, name))
  }

  async unarchive(name: string): Promise<void> {
    await this.change((text) => unarchiveHabit(text, name))
  }

  async setTick(date: string, name: string, value: boolean): Promise<void> {
    const rel = diaryPath(date)
    const text = (await this.vault.exists(rel)) ? (await this.vault.read(rel)).text : newDiaryText(date)
    const next = setHabitTick(text, name, value)
    await this.vault.write(rel, next)
    this.index.upsert(rel, next)
  }

  history(from: string, to: string): Record<string, Record<string, boolean>> {
    return this.index.habitTicks(from, to)
  }
}
