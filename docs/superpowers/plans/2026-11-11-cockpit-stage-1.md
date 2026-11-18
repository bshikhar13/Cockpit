# Cockpit Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac desktop app where the user writes a daily diary, keeps PARA notes, manages tasks, and ticks habits, with everything stored as plain markdown in a Google Drive folder.

**Architecture:** Electron app in three layers. `src/core` is pure TypeScript with no Electron or filesystem imports; it owns every file format (task lines, repeat rules, diary frontmatter, habits, wikilinks). `src/main` owns the vault on disk, an in-memory index, the file watcher, and services that combine core functions with file I/O, exposed to the UI through one typed IPC contract. `src/renderer` is a React UI with a CodeMirror 6 live-preview editor.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, CodeMirror 6 (`@codemirror/lang-markdown` with GFM), MiniSearch, chokidar, `yaml`, Vitest, Playwright (Electron), electron-builder.

**Spec:** `docs/superpowers/specs/2026-11-11-cockpit-design.md`

**One deviation from the spec, to confirm with the user:** the spec calls for a SQLite index in `~/Library/Application Support/Cockpit/`. Stage 1 uses an in-memory index rebuilt from the files at every launch. It meets the spec's intent (files are the source of truth, the index is disposable), avoids a native module that must be compiled separately for Electron and for the test runner, and a fresh vault parses in well under a second. A persistent index returns in stage 3, when embeddings need one.

## Global Constraints

- Files in the vault are the only source of truth. Nothing the user needs is stored anywhere else.
- Opening a file never writes to it. An edit changes only the characters edited. Line endings and trailing newlines are preserved.
- Nothing but the user's own typing changes diary body text. The two permitted programmatic diary edits are habit ticks in frontmatter and wikilink target rewrites caused by the user renaming a note.
- The logical day rolls over at 04:00 local time (setting `rolloverHour`, default `4`). Every "today", "due", "overdue", and repeat calculation uses the logical day.
- Dates are `YYYY-MM-DD` strings everywhere.
- Task line format is the Obsidian Tasks emoji format: `📅` due, `⏫` high, `🔼` medium, `🔽` low, `🔁` repeat, `✅` completed date, `🆔` id.
- Only files named `Tasks.md` hold tasks. Checkbox lines elsewhere are not tasks.
- Note names are unique across the vault (case-insensitive), except `Tasks.md`. Names may not contain `/ \ : [ ] | # ^` or start with a dot.
- Vault top-level names are fixed: `Diary`, `Projects`, `Areas`, `Resources`, `Archive`, `Attachments`, `Inbox`, `Habits.md`.
- Video extensions rendered as players: `.mp4`, `.mov`, `.webm`.
- No AI, calendar, web clipper, posting, import, reminders, or streak counters.
- All `src/core` code is pure: no `fs`, no `electron`, no `Date.now()` (callers pass dates in).
- Commit after every task. `.superpowers/` is git-ignored.

## Review Focus

Conditions the spec implies but does not spell out, most likely to bite first. Each has a test in the task named.

1. **App left open across 04:00.** Today must switch to the new day; typing must not continue into yesterday's file unnoticed. (Task 9 test, Task 13 behaviour.)
2. **Vault folder missing at launch** (Drive not mounted, folder renamed). The app must show the folder picker with an explanation, and must not create a fresh empty skeleton at the old path. (Task 6 test.)
3. **Hand-edited or malformed task lines** (no id, bad date, unknown trailing text). They must still list as tasks where a checkbox and title exist, and the app must never drop or reorder text it does not understand. (Task 2 and Task 4 tests.)
4. **Names with characters that break filenames or links** on create and rename. Rejected with a clear message, nothing written. (Task 8 test.)
5. **Habit names that are awkward in YAML** (`5k run`, `Read: 20 min`, `"Quote"`, `yes`). Frontmatter must stay valid and round-trip. (Task 5 test.)

## File Structure

```
package.json, electron.vite.config.ts, tsconfig*.json, vitest.config.ts, playwright.config.ts
src/core/
  day.ts                 logical date and date arithmetic
  tasks/line.ts          parse and format one task line
  tasks/repeat.ts        repeat rules and next occurrence
  tasks/file.ts          edit tasks inside a Tasks.md text
  frontmatter.ts         split and replace a YAML frontmatter block without touching the body
  diary.ts               diary paths, new-day text, habit ticks
  habits.ts              Habits.md parse and format
  links.ts               wikilink extraction and rewrite
  para.ts                classify vault paths, validate names
  types.ts               shared types and the IPC contract
src/main/
  index.ts               app start, window, wiring
  settings.ts            settings file in userData
  vault.ts               safe file access under the vault root
  vault-index.ts         in-memory index and search
  watcher.ts             chokidar to index to renderer events
  services/notes.ts      create, rename, move, archive, attachments
  services/tasks.ts      list and mutate tasks across files
  services/habits.ts     habit list and ticks
  services/diary.ts      open a day, day-change timer
  ipc.ts                 registers every handler in the contract
src/preload/index.ts     exposes window.cockpit
src/renderer/src/
  App.tsx, api.ts, useVault.ts
  shell/Sidebar.tsx, shell/CommandPalette.tsx, shell/VaultPicker.tsx
  editor/Editor.tsx, editor/livePreview.ts, editor/media.ts, editor/tables.ts, editor/wikilinks.ts
  screens/Today.tsx, screens/TasksScreen.tsx, screens/HabitsScreen.tsx, screens/NotePage.tsx
  components/TaskRow.tsx, components/TaskAdd.tsx, components/HabitGrid.tsx, components/Backlinks.tsx
tests/core/*.test.ts, tests/main/*.test.ts, tests/renderer/*.test.ts, tests/fixtures/*.md
e2e/smoke.spec.ts
```

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `.gitignore`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `tests/core/sanity.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test` (vitest run), `typecheck`, `e2e`, `package`. Vitest includes `tests/**/*.test.ts`; default environment `node`; files under `tests/renderer/` use `jsdom`.

- [ ] **Step 1:** `git init` in the project root. Write `.gitignore` with `node_modules`, `out`, `dist`, `.superpowers/`, `.DS_Store`.
- [ ] **Step 2:** Scaffold with `npm create @quick-start/electron@latest . -- --template react-ts` (if the directory-not-empty prompt blocks it, scaffold into a temp directory and move the files in). Remove the template's demo components and assets.
- [ ] **Step 3:** Install: `npm i codemirror @codemirror/state @codemirror/view @codemirror/language @codemirror/lang-markdown @codemirror/autocomplete @codemirror/commands @lezer/markdown minisearch chokidar yaml` and `npm i -D vitest jsdom @playwright/test electron-builder`.
- [ ] **Step 4:** Add `vitest.config.ts` and a sanity test asserting `1 + 1 === 2`. `App.tsx` renders the text `Cockpit`. Window: 1280×800, title `Cockpit`, `contextIsolation: true`, `nodeIntegration: false`.
- [ ] **Step 5:** Run `npm test` (expect 1 passed), `npm run typecheck` (expect no errors), `npm run build` (expect success).
- [ ] **Step 6:** Commit: `chore: scaffold electron app`. Include the existing `docs/` folder in this commit.

---

### Task 2: Logical day and task lines

**Files:**
- Create: `src/core/types.ts`, `src/core/day.ts`, `src/core/tasks/line.ts`
- Test: `tests/core/day.test.ts`, `tests/core/task-line.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type Priority = 'high' | 'medium' | 'low'
export interface Task {
  id: string | null        // null for hand-written lines without 🆔
  title: string
  done: boolean
  due?: string             // YYYY-MM-DD
  priority?: Priority
  repeat?: string          // rule text after 🔁, e.g. "every weekday"
  completed?: string       // YYYY-MM-DD after ✅
  extra?: string           // any trailing text not understood, preserved verbatim
}
// day.ts
export function logicalDate(now: Date, rolloverHour: number): string
export function addDays(date: string, n: number): string
export function weekday(date: string): number   // 0 = Sunday
export function daysBetween(a: string, b: string): number  // b - a
// tasks/line.ts
export function parseTaskLine(line: string): Task | null
export function formatTaskLine(task: Task): string
export function newTaskId(): string   // 6 chars from [a-z0-9]
```

- [ ] **Step 1: Write failing tests**

```ts
// day.test.ts
expect(logicalDate(new Date(2026, 10, 12, 0, 30), 4)).toBe('2026-11-11')
expect(logicalDate(new Date(2026, 10, 12, 3, 59), 4)).toBe('2026-11-11')
expect(logicalDate(new Date(2026, 10, 12, 4, 0), 4)).toBe('2026-11-12')
expect(logicalDate(new Date(2026, 0, 1, 2, 0), 4)).toBe('2025-12-31')
expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
expect(weekday('2026-11-11')).toBe(3)
expect(daysBetween('2026-11-11', '2026-11-16')).toBe(5)

// task-line.test.ts
expect(parseTaskLine('- [ ] Send pilot deck 📅 2026-11-12 ⏫ 🆔 k3f9a2')).toEqual(
  { id: 'k3f9a2', title: 'Send pilot deck', done: false, due: '2026-11-12', priority: 'high' })
expect(parseTaskLine('- [x] Book physio 📅 2026-11-10 ✅ 2026-11-10 🆔 m2d7q9')).toMatchObject(
  { done: true, completed: '2026-11-10' })
expect(parseTaskLine('- [ ] Review PR queue 🔁 every weekday 📅 2026-11-11 🆔 p8x1c4')).toMatchObject(
  { repeat: 'every weekday', due: '2026-11-11' })
expect(parseTaskLine('- [ ] Bare task')).toEqual({ id: null, title: 'Bare task', done: false })
expect(parseTaskLine('* [X] Star bullet')).toMatchObject({ done: true, title: 'Star bullet' })
expect(parseTaskLine('- [ ] Bad date 📅 tomorrow')).toEqual(
  { id: null, title: 'Bad date', done: false, extra: '📅 tomorrow' })
expect(parseTaskLine('Some prose')).toBeNull()
expect(parseTaskLine('- not a checkbox')).toBeNull()
expect(parseTaskLine('- [ ] ')).toBeNull()
// format is canonical: title, 🔁, 📅, priority, ✅, extra, 🆔
const t = { id: 'ab12cd', title: 'X', done: false, repeat: 'every week', due: '2026-11-12', priority: 'low' as const }
expect(formatTaskLine(t)).toBe('- [ ] X 🔁 every week 📅 2026-11-12 🔽 🆔 ab12cd')
// round trip of every sample line above: parse(format(parse(l))) deep-equals parse(l)
expect(newTaskId()).toMatch(/^[a-z0-9]{6}$/)
```

- [ ] **Step 2:** Run `npx vitest run tests/core/day.test.ts tests/core/task-line.test.ts`. Expect FAIL (modules missing).
- [ ] **Step 3:** Implement. `logicalDate` subtracts `rolloverHour` hours from `now` and formats the local date. Date arithmetic uses UTC noon internally to avoid DST drift. `parseTaskLine` takes metadata tokens from the end of the line; the first token it cannot parse, and everything from there to the next recognised token, goes into `extra`; the title is what precedes the first metadata emoji.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(core): logical day and task line format`.

---

### Task 3: Repeat rules

**Files:**
- Create: `src/core/tasks/repeat.ts`
- Test: `tests/core/repeat.test.ts`

**Interfaces:**
- Consumes: `addDays`, `weekday`, `daysBetween` from `day.ts`.
- Produces:

```ts
export type RepeatRule =
  | { kind: 'days'; every: number }
  | { kind: 'weekday' }
  | { kind: 'weeks'; every: number }
  | { kind: 'month' }
export function parseRepeat(text: string): RepeatRule | null
export function nextOccurrence(rule: RepeatRule, due: string, completedOn: string): string
export const REPEAT_PRESETS: string[]  // 'every day','every weekday','every week','every month'
```

- [ ] **Step 1: Write failing tests**

```ts
expect(parseRepeat('every day')).toEqual({ kind: 'days', every: 1 })
expect(parseRepeat('every 3 days')).toEqual({ kind: 'days', every: 3 })
expect(parseRepeat('every weekday')).toEqual({ kind: 'weekday' })
expect(parseRepeat('every week')).toEqual({ kind: 'weeks', every: 1 })
expect(parseRepeat('every 2 weeks')).toEqual({ kind: 'weeks', every: 2 })
expect(parseRepeat('every month')).toEqual({ kind: 'month' })
expect(parseRepeat('Every Day')).toEqual({ kind: 'days', every: 1 })
expect(parseRepeat('sometimes')).toBeNull()
expect(parseRepeat('every 0 days')).toBeNull()

const n = (r: string, due: string, done: string) => nextOccurrence(parseRepeat(r)!, due, done)
// daily, on time and five days late: one task for tomorrow, never a backlog
expect(n('every day', '2026-11-11', '2026-11-11')).toBe('2026-11-12')
expect(n('every day', '2026-11-06', '2026-11-11')).toBe('2026-11-12')
// completed early: still strictly after the completion day and after the due day
expect(n('every day', '2026-11-11', '2026-11-09')).toBe('2026-11-12')
// every 3 days stays on the due date's cadence
expect(n('every 3 days', '2026-11-01', '2026-11-11')).toBe('2026-11-13')
// weekday: Friday -> Monday, Saturday completion -> Monday
expect(n('every weekday', '2026-11-13', '2026-11-13')).toBe('2026-11-16')
expect(n('every weekday', '2026-11-13', '2026-11-14')).toBe('2026-11-16')
// weekly keeps the due date's weekday (Wednesday)
expect(n('every week', '2026-11-11', '2026-11-11')).toBe('2026-11-18')
expect(n('every week', '2026-11-11', '2026-11-20')).toBe('2026-11-25')
expect(n('every 2 weeks', '2026-11-11', '2026-11-12')).toBe('2026-11-25')
// monthly keeps the day of month, clamped to month length
expect(n('every month', '2026-01-31', '2026-01-31')).toBe('2026-02-28')
expect(n('every month', '2026-11-11', '2026-12-20')).toBe('2027-01-11')
```

- [ ] **Step 2:** Run `npx vitest run tests/core/repeat.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. Rule: the result is the earliest date that is on the due date's cadence (`due + k × interval`, `k ≥ 1`), and strictly after `completedOn`. For `month`, candidates are the due date's day-of-month in each following month, clamped to the last day of that month. For `weekday`, candidates are every Monday to Friday after `max(due, completedOn)`.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(core): repeat rules`.

---

### Task 4: Editing tasks inside a file

**Files:**
- Create: `src/core/tasks/file.ts`
- Test: `tests/core/task-file.test.ts`

**Interfaces:**
- Consumes: `Task`, `parseTaskLine`, `formatTaskLine`, `newTaskId`, `parseRepeat`, `nextOccurrence`.
- Produces:

```ts
export type TaskRef = { id: string } | { line: number }       // line is 0-based
export interface TaskAt { task: Task; line: number }
export type TaskPatch = Partial<Pick<Task, 'title' | 'due' | 'priority' | 'repeat'>>
  // a key present with value undefined clears that field
export function listTasks(text: string): TaskAt[]
export function addTask(text: string, input: Omit<Task, 'id' | 'done'>): { text: string; task: Task }
export function updateTask(text: string, ref: TaskRef, patch: TaskPatch): string
export function completeTask(text: string, ref: TaskRef, today: string): string
export function uncompleteTask(text: string, ref: TaskRef): string
export function removeTask(text: string, ref: TaskRef): { text: string; removed: Task }
export function insertTask(text: string, task: Task): string   // used by move; keeps the task's id
```

All functions throw `Error('task not found')` when the ref matches nothing. All preserve the file's line-ending style and every line they do not target.

- [ ] **Step 1: Write failing tests**

```ts
const file = '# Tasks\n\nSome prose the user wrote.\n\n- [ ] A 📅 2026-11-11 🆔 aaaaaa\n- [ ] B\n- not a task\n'
expect(listTasks(file).map(t => [t.task.title, t.line])).toEqual([['A', 4], ['B', 5]])

// add appends after the last task line; adds an id; file with no tasks appends at end
const added = addTask(file, { title: 'C', due: '2026-11-12' })
expect(added.text.split('\n')[6]).toBe(`- [ ] C 📅 2026-11-12 🆔 ${added.task.id}`)
expect(added.text.split('\n')[7]).toBe('- not a task')
expect(addTask('', { title: 'First' }).text).toMatch(/^- \[ \] First 🆔 [a-z0-9]{6}\n$/)

// update by id changes only that line
const up = updateTask(file, { id: 'aaaaaa' }, { title: 'A2', due: undefined, priority: 'high' })
expect(up.split('\n')[4]).toBe('- [ ] A2 ⏫ 🆔 aaaaaa')
expect(up.split('\n').filter((_, i) => i !== 4)).toEqual(file.split('\n').filter((_, i) => i !== 4))

// mutating a line with no id assigns one
expect(updateTask(file, { line: 5 }, { due: '2026-11-13' }).split('\n')[5])
  .toMatch(/^- \[ \] B 📅 2026-11-13 🆔 [a-z0-9]{6}$/)

// complete, non-repeating
expect(completeTask(file, { id: 'aaaaaa' }, '2026-11-11').split('\n')[4])
  .toBe('- [x] A 📅 2026-11-11 ✅ 2026-11-11 🆔 aaaaaa')

// complete, repeating: done line stays, next occurrence inserted directly below with a new id
const rep = '- [ ] Run 🔁 every day 📅 2026-11-06 🆔 rrrrrr\n- [ ] Other 🆔 oooooo\n'
const done = completeTask(rep, { id: 'rrrrrr' }, '2026-11-11').split('\n')
expect(done[0]).toBe('- [x] Run 🔁 every day 📅 2026-11-06 ✅ 2026-11-11 🆔 rrrrrr')
expect(done[1]).toMatch(/^- \[ \] Run 🔁 every day 📅 2026-11-12 🆔 (?!rrrrrr)[a-z0-9]{6}$/)
expect(done[2]).toBe('- [ ] Other 🆔 oooooo')

// adding a repeat to a task with no due date is the caller's job (service sets due = today);
// completing a repeating task with no due date uses `today` as the due date
// uncomplete removes ✅ and unticks; does not delete a spawned occurrence
expect(uncompleteTask('- [x] A ✅ 2026-11-11 🆔 aaaaaa\n', { id: 'aaaaaa' })).toBe('- [ ] A 🆔 aaaaaa\n')

// remove
expect(removeTask(file, { id: 'aaaaaa' }).text).not.toContain('aaaaaa')
expect(() => updateTask(file, { id: 'zzzzzz' }, {})).toThrow('task not found')

// CRLF preserved; unknown trailing text preserved through an edit
expect(updateTask('- [ ] A 🆔 aaaaaa\r\n- [ ] B\r\n', { id: 'aaaaaa' }, { title: 'Z' }))
  .toBe('- [ ] Z 🆔 aaaaaa\r\n- [ ] B\r\n')
expect(updateTask('- [ ] A 📅 soon 🆔 aaaaaa\n', { id: 'aaaaaa' }, { priority: 'low' }))
  .toBe('- [ ] A 🔽 📅 soon 🆔 aaaaaa\n')
```

- [ ] **Step 2:** Run `npx vitest run tests/core/task-file.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement the functions above.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(core): task file editing`.

---

### Task 5: Diary frontmatter and habits

**Files:**
- Create: `src/core/frontmatter.ts`, `src/core/diary.ts`, `src/core/habits.ts`
- Test: `tests/core/frontmatter.test.ts`, `tests/core/diary.test.ts`, `tests/core/habits.test.ts`

**Interfaces:**
- Produces:

```ts
// frontmatter.ts
export function splitFrontmatter(text: string): { yaml: string | null; body: string; bodyOffset: number }
export function readFrontmatter(text: string): Record<string, unknown>      // {} if none or invalid
export function writeFrontmatter(text: string, data: Record<string, unknown>): string
  // replaces or inserts the block; the body is returned byte-identical
// diary.ts
export function diaryPath(date: string): string            // 'Diary/2026/2026-11-11.md'
export function dateFromDiaryPath(rel: string): string | null
export function newDiaryText(date: string): string         // '---\ndate: 2026-11-11\n---\n\n'
export function readHabitTicks(text: string): Record<string, boolean>
export function setHabitTick(text: string, habit: string, value: boolean): string
export function renameHabitTick(text: string, from: string, to: string): string  // no-op if absent
// habits.ts
export interface HabitList { active: string[]; archived: string[] }
export function parseHabits(text: string): HabitList
export function formatHabits(list: HabitList): string
```

`Habits.md` format: `# Habits`, a blank line, one `- Name` per active habit, then if any are archived `## Archived` and one `- Name` each. `setHabitTick(..., false)` removes the key; an empty `habits` map is removed from the frontmatter.

- [ ] **Step 1: Write failing tests**

```ts
const body = '\nSpent the morning on the deck.\n\n| a | b |\n|---|---|\n'
const d = '---\ndate: 2026-11-11\n---\n' + body
// body is byte-identical after any tick operation
const ticked = setHabitTick(d, 'Run', true)
expect(ticked.endsWith(body)).toBe(true)
expect(readHabitTicks(ticked)).toEqual({ Run: true })
expect(readHabitTicks(setHabitTick(ticked, 'Run', false))).toEqual({})
expect(setHabitTick(ticked, 'Run', false)).toBe(d)
// file with no frontmatter gains one; body unchanged
expect(setHabitTick('Just text\n', 'Run', true)).toMatch(/^---\n[\s\S]*---\nJust text\n$/)
// awkward names stay valid YAML and round-trip
for (const name of ['5k run', 'Read: 20 min', '"Quote"', 'yes', 'No sugar #1', 'Café']) {
  expect(readHabitTicks(setHabitTick(d, name, true))).toEqual({ [name]: true })
}
// rename keeps the value and the body
const r = renameHabitTick(ticked, 'Run', 'Morning run')
expect(readHabitTicks(r)).toEqual({ 'Morning run': true })
expect(r.endsWith(body)).toBe(true)
expect(renameHabitTick(d, 'Run', 'X')).toBe(d)
// invalid frontmatter is left alone on read and never throws
expect(readHabitTicks('---\n: : bad\n---\nx')).toEqual({})
// CRLF file keeps CRLF in the body
expect(setHabitTick('---\r\ndate: 2026-11-11\r\n---\r\nA\r\nB\r\n', 'Run', true).endsWith('A\r\nB\r\n')).toBe(true)

expect(diaryPath('2026-11-11')).toBe('Diary/2026/2026-11-11.md')
expect(dateFromDiaryPath('Diary/2026/2026-11-11.md')).toBe('2026-11-11')
expect(dateFromDiaryPath('Areas/Job/Job.md')).toBeNull()

const h = '# Habits\n\n- Run\n- Read\n\n## Archived\n\n- Yoga\n'
expect(parseHabits(h)).toEqual({ active: ['Run', 'Read'], archived: ['Yoga'] })
expect(formatHabits(parseHabits(h))).toBe(h)
expect(parseHabits('')).toEqual({ active: [], archived: [] })
```

- [ ] **Step 2:** Run the three test files. Expect FAIL.
- [ ] **Step 3:** Implement. Use the `yaml` package only on the frontmatter block. If the existing frontmatter is invalid YAML, `setHabitTick` throws `Error('invalid frontmatter')` and writes nothing.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(core): diary frontmatter and habits`.

---

### Task 6: Links, PARA paths, vault, settings

**Files:**
- Create: `src/core/links.ts`, `src/core/para.ts`, `src/main/vault.ts`, `src/main/settings.ts`
- Test: `tests/core/links.test.ts`, `tests/core/para.test.ts`, `tests/main/vault.test.ts`

**Interfaces:**
- Produces:

```ts
// links.ts
export interface Wikilink { target: string; alias?: string; from: number; to: number }
export function extractWikilinks(text: string): Wikilink[]     // ignores fenced and inline code
export function rewriteWikilinks(text: string, oldName: string, newName: string): string
// para.ts
export type Kind = 'diary' | 'project' | 'area' | 'resource' | 'archive' | 'inbox' | 'attachment' | 'habits' | 'other'
export interface PathInfo { kind: Kind; container: string | null; isTasksFile: boolean; isHomeNote: boolean; name: string }
  // container = 'Projects/Launch' etc; name = filename without .md
export function classify(rel: string): PathInfo
export function validateName(name: string): string | null     // null if valid, else the message to show
export const SKELETON: string[]   // ['Diary','Projects','Areas','Resources','Archive','Attachments','Inbox']
// vault.ts
export class Vault {
  constructor(root: string)
  static async isUsable(root: string): Promise<boolean>   // exists and is a directory
  async ensureSkeleton(): Promise<void>     // creates SKELETON dirs, Inbox/Tasks.md, Habits.md if missing
  async read(rel: string): Promise<{ text: string; hash: string }>   // hash = sha1 of bytes
  async write(rel: string, text: string): Promise<string>           // returns new hash; creates parents
  async save(rel: string, text: string, baseHash: string | null): Promise<{ hash: string; conflictCopy?: string }>
  async exists(rel: string): Promise<boolean>
  async listMarkdown(): Promise<string[]>   // all .md files, relative, POSIX separators, skips dotfiles
  async move(from: string, to: string): Promise<void>  // file or folder; fails if `to` exists
  async remove(rel: string): Promise<void>             // moves to macOS Trash via shell.trashItem
  async writeAttachment(bytes: Uint8Array, filename: string): Promise<string>  // returns rel under Attachments/
  abs(rel: string): string                             // throws Error('outside vault') on traversal
}
// settings.ts
export interface Settings { vaultPath: string | null; rolloverHour: number }
export function loadSettings(dir: string): Settings   // defaults { vaultPath: null, rolloverHour: 4 }
export function saveSettings(dir: string, s: Settings): void
```

`save` conflict rule: if the file exists and its current hash differs from `baseHash`, the current disk content is first written to `<name> (conflict YYYY-MM-DD HHmmss).md` beside it, then the new text is written, and `conflictCopy` is returned. `writeAttachment` de-duplicates names by appending ` 1`, ` 2`. Environment overrides for tests: `COCKPIT_VAULT` (vault path) and `COCKPIT_USER_DATA` (settings directory).

- [ ] **Step 1: Write failing tests**

```ts
// links.test.ts
const t = 'See [[Pricing notes]] and [[Robin|him]].\n`[[not a link]]`\n```\n[[nor this]]\n```\n'
expect(extractWikilinks(t).map(l => [l.target, l.alias])).toEqual([['Pricing notes', undefined], ['Robin', 'him']])
expect(t.slice(extractWikilinks(t)[0].from, extractWikilinks(t)[0].to)).toBe('[[Pricing notes]]')
expect(rewriteWikilinks(t, 'robin', 'Robin Hale')).toContain('[[Robin Hale|him]]')        // case-insensitive match
expect(rewriteWikilinks(t, 'Robin', 'R')).toContain('`[[not a link]]`')
expect(rewriteWikilinks('no links\r\nhere', 'A', 'B')).toBe('no links\r\nhere')

// para.test.ts
expect(classify('Diary/2026/2026-11-11.md')).toMatchObject({ kind: 'diary', container: null })
expect(classify('Projects/Launch/Launch.md')).toMatchObject({ kind: 'project', container: 'Projects/Launch', isHomeNote: true })
expect(classify('Areas/Job/Tasks.md')).toMatchObject({ kind: 'area', container: 'Areas/Job', isTasksFile: true })
expect(classify('Inbox/Tasks.md')).toMatchObject({ kind: 'inbox', container: 'Inbox', isTasksFile: true })
expect(classify('Archive/Launch/Tasks.md')).toMatchObject({ kind: 'archive', isTasksFile: false })  // archived tasks are not tasks
expect(classify('Resources/Pricing/Tiering.md')).toMatchObject({ kind: 'resource', container: 'Resources/Pricing', name: 'Tiering' })
for (const bad of ['a/b', 'a:b', 'a[b', 'a]b', 'a|b', 'a#b', 'a^b', 'a\\b', '.hidden', '', '   ', 'Tasks'])
  expect(validateName(bad)).not.toBeNull()
expect(validateName('Client: pilot')).not.toBeNull()
expect(validateName('Client pilot')).toBeNull()

// vault.test.ts (temp dir per test)
expect(await Vault.isUsable(join(tmp, 'missing'))).toBe(false)       // and nothing is created there
expect(existsSync(join(tmp, 'missing'))).toBe(false)
await v.ensureSkeleton(); await v.ensureSkeleton()                    // idempotent, never overwrites
expect(await v.exists('Inbox/Tasks.md')).toBe(true)
expect(() => v.abs('../etc/passwd')).toThrow('outside vault')
const h1 = await v.write('Inbox/A.md', 'one')
expect((await v.save('Inbox/A.md', 'two', h1)).conflictCopy).toBeUndefined()
await v.write('Inbox/A.md', 'changed on disk')
const res = await v.save('Inbox/A.md', 'mine', h1)                    // stale base
expect((await v.read('Inbox/A.md')).text).toBe('mine')
expect((await v.read(res.conflictCopy!)).text).toBe('changed on disk')
expect(res.conflictCopy).toMatch(/^Inbox\/A \(conflict \d{4}-\d{2}-\d{2} \d{6}\)\.md$/)
expect(await v.writeAttachment(new Uint8Array([1]), 'p.png')).toBe('Attachments/p.png')
expect(await v.writeAttachment(new Uint8Array([2]), 'p.png')).toBe('Attachments/p 1.png')
await expect(v.move('Inbox/A.md', 'Inbox/Tasks.md')).rejects.toThrow()
expect(await v.listMarkdown()).toEqual(expect.arrayContaining(['Inbox/A.md', 'Inbox/Tasks.md', 'Habits.md']))
```

- [ ] **Step 2:** Run the three test files. Expect FAIL.
- [ ] **Step 3:** Implement. `Vault.remove` takes the trash function as an optional constructor argument so tests can stub it.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat: links, PARA paths, vault file access, settings`.

---

### Task 7: Index and watcher

**Files:**
- Create: `src/main/vault-index.ts`, `src/main/watcher.ts`
- Test: `tests/main/vault-index.test.ts`

**Interfaces:**
- Consumes: `Vault`, `classify`, `extractWikilinks`, `listTasks`, `readHabitTicks`, `readFrontmatter`, `dateFromDiaryPath`.
- Produces:

```ts
// types.ts additions
export interface NoteRef { rel: string; name: string; kind: Kind; container: string | null }
export interface TaskItem extends Task { file: string; line: number; container: string; containerName: string; containerKind: Kind }
export interface SearchHit { rel: string; name: string; snippet: string }
export interface TreeNode { rel: string; name: string; type: 'folder' | 'note'; kind: Kind; children?: TreeNode[]; meta?: { status?: string; deadline?: string; area?: string } }
// vault-index.ts
export class VaultIndex {
  static async build(vault: Vault): Promise<VaultIndex>
  upsert(rel: string, text: string): void
  remove(rel: string): void
  notes(): NoteRef[]                                // excludes Tasks.md and Habits.md
  resolve(name: string): NoteRef | null             // case-insensitive; on duplicates, shortest rel wins
  duplicates(): string[][]                          // groups of rels sharing a name
  backlinks(name: string): NoteRef[]
  linkers(name: string): string[]                   // rels of files containing a link to name
  tasks(): TaskItem[]
  habitTicks(from: string, to: string): Record<string, Record<string, boolean>>   // date -> habit -> true
  diaryFiles(): string[]
  search(query: string, limit?: number): SearchHit[]   // title boost 3x, prefix matching
  tree(): TreeNode[]                                 // Inbox, Projects, Areas, Resources, Archive in that order
}
// watcher.ts
export function watchVault(vault: Vault, index: VaultIndex, onChange: (rels: string[]) => void): () => void
  // chokidar on the vault root; ignores dotfiles; debounces 150 ms; upserts or removes in the index; returns stop()
```

- [ ] **Step 1: Write failing tests** against a temp vault seeded with: `Projects/Launch/Launch.md` (frontmatter `status: active`, `area: Studio`, body links `[[Robin]]`), `Projects/Launch/Tasks.md` (two tasks), `Areas/Job/Job.md`, `Areas/Job/Tasks.md` (one task), `Inbox/Robin.md`, `Archive/Old/Tasks.md` (one task), `Diary/2026/2026-11-10.md` (ticks `Run: true`, body links `[[Launch]]`).

```ts
expect(ix.notes().map(n => n.name).sort()).toEqual(['2026-11-10', 'Job', 'Launch', 'Robin'])
expect(ix.resolve('robin')?.rel).toBe('Inbox/Robin.md')
expect(ix.backlinks('Robin').map(n => n.rel)).toEqual(['Projects/Launch/Launch.md'])
expect(ix.backlinks('Launch').map(n => n.rel)).toEqual(['Diary/2026/2026-11-10.md'])
expect(ix.tasks()).toHaveLength(3)                                   // archived task excluded
expect(ix.tasks()[0]).toMatchObject({ container: 'Projects/Launch', containerName: 'Launch', containerKind: 'project' })
expect(ix.habitTicks('2026-11-01', '2026-11-30')).toEqual({ '2026-11-10': { Run: true } })
expect(ix.search('rob')[0].rel).toBe('Inbox/Robin.md')
expect(ix.tree().map(n => n.name)).toEqual(['Inbox', 'Projects', 'Areas', 'Resources', 'Archive'])
expect(ix.tree()[1].children![0].meta).toMatchObject({ status: 'active', area: 'Studio' })
ix.upsert('Inbox/Robin (1).md', 'dup'); ix.upsert('Inbox/robin.md', 'dup2')
expect(ix.duplicates()).toEqual([['Inbox/Robin.md', 'Inbox/robin.md']])   // case-insensitive name clash reported
ix.remove('Inbox/Robin.md'); expect(ix.resolve('Robin')?.rel).toBe('Inbox/robin.md')
ix.upsert('Projects/Launch/Tasks.md', ''); expect(ix.tasks()).toHaveLength(1)
```

- [ ] **Step 2:** Run `npx vitest run tests/main/vault-index.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement `VaultIndex` with per-file records in a `Map` and a MiniSearch instance for full text. Implement `watchVault`; it has no unit test and is covered by the e2e smoke test in Task 16.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(main): in-memory vault index and watcher`.

---

### Task 8: Notes service

**Files:**
- Create: `src/main/services/notes.ts`
- Test: `tests/main/notes-service.test.ts`

**Interfaces:**
- Consumes: `Vault`, `VaultIndex`, `validateName`, `rewriteWikilinks`, `writeFrontmatter`.
- Produces:

```ts
export class NotesService {
  constructor(vault: Vault, index: VaultIndex)
  async create(folder: string | null, name: string): Promise<string>     // null -> 'Inbox'; returns rel
  async openOrCreateByName(name: string): Promise<string>               // resolve, else create in Inbox
  async rename(rel: string, newName: string): Promise<string>           // rewrites links vault-wide
  async move(rel: string, toFolder: string): Promise<string>
  async createContainer(kind: 'project' | 'area' | 'resource', name: string, opts?: { area?: string; deadline?: string }): Promise<string>
  async setProjectMeta(rel: string, meta: { status?: 'active' | 'done'; deadline?: string | null; area?: string | null }): Promise<void>
  async archive(containerRel: string): Promise<string>                  // moves folder to Archive/<name>
  async unarchive(archivedRel: string): Promise<string>                 // back to its original parent
  async importAttachment(bytes: Uint8Array, filename: string, forNoteRel: string): Promise<string>  // returns markdown to insert
}
```

Rules. Every method updates the index for each file it writes, moves, or removes. `create` and `rename` throw `Error(<validateName message>)` for bad names and `Error('A note named "<name>" already exists')` on a case-insensitive clash. `createContainer` creates `<Kind>s/<name>/<name>.md` (frontmatter `status: active` plus opts for projects; no frontmatter for areas and resources) and, for projects and areas, an empty `Tasks.md`. Renaming a home note renames its folder too. `archive` records `archivedFrom: Projects` (or `Areas`, `Resources`) in the home note's frontmatter; `unarchive` reads it. `importAttachment` returns `![](<relative path from the note's folder to the attachment>)` with spaces percent-encoded.

- [ ] **Step 1: Write failing tests**

```ts
expect(await s.create(null, 'Idea')).toBe('Inbox/Idea.md')
await expect(s.create(null, 'idea')).rejects.toThrow('already exists')
await expect(s.create(null, 'a/b')).rejects.toThrow()
expect(await v.exists('Inbox/a')).toBe(false)                         // nothing written on rejection
expect(await s.createContainer('project', 'Launch', { area: 'Studio' })).toBe('Projects/Launch/Launch.md')
expect(await v.exists('Projects/Launch/Tasks.md')).toBe(true)
expect(await s.openOrCreateByName('Robin')).toBe('Inbox/Robin.md')
expect(await s.openOrCreateByName('robin')).toBe('Inbox/Robin.md')

// rename rewrites links everywhere, diary included, and changes nothing else in those files
await v.write('Diary/2026/2026-11-10.md', '---\ndate: 2026-11-10\n---\nTalked to [[Robin]] today.\n')
// (index.upsert the diary file)
expect(await s.rename('Inbox/Robin.md', 'Robin Hale')).toBe('Inbox/Robin Hale.md')
expect((await v.read('Diary/2026/2026-11-10.md')).text).toBe('---\ndate: 2026-11-10\n---\nTalked to [[Robin Hale]] today.\n')
expect(ix.backlinks('Robin Hale')).toHaveLength(1)

// renaming a home note renames the folder
expect(await s.rename('Projects/Launch/Launch.md', 'Launch v2')).toBe('Projects/Launch v2/Launch v2.md')

// archive and unarchive
expect(await s.archive('Projects/Launch v2')).toBe('Archive/Launch v2')
expect(ix.tasks().filter(t => t.container.includes('Launch'))).toEqual([])
expect(await s.unarchive('Archive/Launch v2')).toBe('Projects/Launch v2')

expect(await s.move('Inbox/Idea.md', 'Projects/Launch v2')).toBe('Projects/Launch v2/Idea.md')
expect(await s.importAttachment(new Uint8Array([1]), 'my pic.png', 'Diary/2026/2026-11-10.md'))
  .toBe('![](../../Attachments/my%20pic.png)')
```

- [ ] **Step 2:** Run `npx vitest run tests/main/notes-service.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement `NotesService`.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(main): notes service`.

---

### Task 9: Tasks, habits, and diary services

**Files:**
- Create: `src/main/services/tasks.ts`, `src/main/services/habits.ts`, `src/main/services/diary.ts`
- Test: `tests/main/tasks-service.test.ts`, `tests/main/habits-service.test.ts`, `tests/main/diary-service.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 7.
- Produces:

```ts
// types.ts additions
export type TaskView = { view: 'today' } | { view: 'upcoming' } | { view: 'inbox' } | { view: 'container'; container: string } | { view: 'all' }
export interface TaskInput { title: string; container?: string; due?: string; priority?: Priority; repeat?: string }
export interface TaskHandle { file: string; ref: TaskRef }
// services/tasks.ts
export class TasksService {
  constructor(vault: Vault, index: VaultIndex, today: () => string)
  list(view: TaskView, includeDone?: boolean): TaskItem[]
  async add(input: TaskInput): Promise<TaskItem>          // container default 'Inbox'
  async update(h: TaskHandle, patch: TaskPatch): Promise<void>
  async complete(h: TaskHandle): Promise<void>
  async uncomplete(h: TaskHandle): Promise<void>
  async move(h: TaskHandle, toContainer: string): Promise<void>
  async remove(h: TaskHandle): Promise<void>
}
// services/habits.ts
export class HabitsService {
  constructor(vault: Vault, index: VaultIndex)
  async list(): Promise<HabitList>
  async add(name: string): Promise<void>
  async rename(from: string, to: string): Promise<void>   // rewrites the key in every diary file that has it
  async reorder(active: string[]): Promise<void>
  async archive(name: string): Promise<void>
  async unarchive(name: string): Promise<void>
  async setTick(date: string, name: string, value: boolean): Promise<void>   // creates the diary file if missing
  history(from: string, to: string): Record<string, Record<string, boolean>>
}
// services/diary.ts
export class DiaryService {
  constructor(vault: Vault, index: VaultIndex, settings: () => Settings, now?: () => Date)
  today(): string
  async open(date: string): Promise<string>               // creates the file with newDiaryText if missing; returns rel
  watchDayChange(onChange: (today: string) => void): () => void   // checks every 30 s; fires once per change
}
```

View rules. `today`: not done and `due <= today`, sorted overdue first by date, then priority high to low, then title. `upcoming`: not done and `today < due <= today + 7`, sorted by date. `inbox`: container `Inbox`. `container`: that container, undated tasks included. Undated tasks never appear in `today` or `upcoming`. `update` with a `repeat` on a task that has no due date also sets `due` to today. An invalid repeat rule throws `Error('Unknown repeat rule')`. `move` removes the line from one file and inserts it in the other, keeping the id; `add` and `move` create `Tasks.md` if the container has none. Habit `add` and `rename` reject empty names and case-insensitive duplicates across active and archived.

- [ ] **Step 1: Write failing tests** (fixed `today = '2026-11-11'`)

```ts
// tasks-service.test.ts
await t.add({ title: 'Overdue', due: '2026-11-09' })
await t.add({ title: 'Today low', due: '2026-11-11', priority: 'low' })
await t.add({ title: 'Today high', due: '2026-11-11', priority: 'high', container: 'Areas/Job' })
await t.add({ title: 'Undated' })
await t.add({ title: 'Next week', due: '2026-11-18' })
await t.add({ title: 'Far', due: '2026-11-19' })
expect(t.list({ view: 'today' }).map(x => x.title)).toEqual(['Overdue', 'Today high', 'Today low'])
expect(t.list({ view: 'upcoming' }).map(x => x.title)).toEqual(['Next week'])
expect(t.list({ view: 'inbox' }).map(x => x.title)).toContain('Undated')
const u = t.list({ view: 'inbox' }).find(x => x.title === 'Undated')!
await t.update({ file: u.file, ref: { id: u.id! } }, { repeat: 'every day' })
expect(t.list({ view: 'today' }).map(x => x.title)).toContain('Undated')              // due became today
await expect(t.update({ file: u.file, ref: { id: u.id! } }, { repeat: 'whenever' })).rejects.toThrow('Unknown repeat rule')
await t.complete({ file: u.file, ref: { id: u.id! } })
expect(t.list({ view: 'all' }).filter(x => x.title === 'Undated').map(x => x.due)).toEqual(['2026-11-12'])
await t.move({ file: u.file, ref: { id: t.list({ view: 'all' }).find(x => x.title === 'Far')!.id! } }, 'Projects/New')
expect(await v.exists('Projects/New/Tasks.md')).toBe(true)
// a hand-written line with no id can be completed by line number
await v.write('Areas/Job/Tasks.md', '- [ ] Hand written 📅 2026-11-11\n'); ix.upsert('Areas/Job/Tasks.md', (await v.read('Areas/Job/Tasks.md')).text)
const hw = t.list({ view: 'today' }).find(x => x.title === 'Hand written')!
expect(hw.id).toBeNull()
await t.complete({ file: hw.file, ref: { line: hw.line } })
expect((await v.read('Areas/Job/Tasks.md')).text).toMatch(/^- \[x\] Hand written 📅 2026-11-11 ✅ 2026-11-11 🆔 [a-z0-9]{6}\n$/)

// habits-service.test.ts
await h.add('Run'); await h.add('Read')
await expect(h.add('run')).rejects.toThrow()
await h.setTick('2026-11-11', 'Run', true)                                           // creates the diary file
expect((await v.read('Diary/2026/2026-11-11.md')).text).toBe('---\ndate: 2026-11-11\nhabits:\n  Run: true\n---\n\n')
await h.rename('Run', 'Morning run')
expect(h.history('2026-11-01', '2026-11-30')).toEqual({ '2026-11-11': { 'Morning run': true } })
await h.archive('Read'); expect(await h.list()).toEqual({ active: ['Morning run'], archived: ['Read'] })
await h.reorder(['Morning run']); await h.unarchive('Read')
expect((await h.list()).active).toEqual(['Morning run', 'Read'])

// diary-service.test.ts
let clock = new Date(2026, 10, 12, 3, 59)
const d = new DiaryService(v, ix, () => ({ vaultPath: '', rolloverHour: 4 }), () => clock)
expect(d.today()).toBe('2026-11-11')
expect(await d.open('2026-11-11')).toBe('Diary/2026/2026-11-11.md')
await v.write('Diary/2026/2026-11-11.md', 'mine'); await d.open('2026-11-11')
expect((await v.read('Diary/2026/2026-11-11.md')).text).toBe('mine')                 // open never overwrites
// day change fires exactly once when the clock crosses 04:00 (use vi.useFakeTimers)
const seen: string[] = []; const stop = d.watchDayChange(x => seen.push(x))
clock = new Date(2026, 10, 12, 4, 0); vi.advanceTimersByTime(30_000); vi.advanceTimersByTime(30_000)
expect(seen).toEqual(['2026-11-12']); stop()
```

- [ ] **Step 2:** Run the three test files. Expect FAIL.
- [ ] **Step 3:** Implement the three services.
- [ ] **Step 4:** Run the tests. Expect PASS. Then run the whole suite: `npm test`.
- [ ] **Step 5:** Commit: `feat(main): tasks, habits, and diary services`.

---

### Task 10: IPC contract, app wiring, shell, vault picker

**Files:**
- Modify: `src/core/types.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`
- Create: `src/main/ipc.ts`, `src/renderer/src/api.ts`, `src/renderer/src/useVault.ts`, `src/renderer/src/shell/Sidebar.tsx`, `src/renderer/src/shell/VaultPicker.tsx`, `src/renderer/src/styles.css`
- Test: `tests/main/ipc-contract.test.ts`

**Interfaces:**
- Produces the one contract the whole renderer uses:

```ts
// types.ts
export interface CockpitApi {
  app: {
    state(): Promise<{ vaultPath: string | null; vaultUsable: boolean; rolloverHour: number; today: string; duplicates: string[][] }>
    chooseVault(): Promise<boolean>            // native folder dialog; on success ensures skeleton and builds the index
    setRolloverHour(h: number): Promise<void>
  }
  notes: {
    tree(): Promise<TreeNode[]>
    all(): Promise<NoteRef[]>
    read(rel: string): Promise<{ text: string; hash: string }>
    save(rel: string, text: string, baseHash: string | null): Promise<{ hash: string; conflictCopy?: string }>
    create(folder: string | null, name: string): Promise<string>
    openOrCreateByName(name: string): Promise<string>
    rename(rel: string, newName: string): Promise<string>
    move(rel: string, toFolder: string): Promise<string>
    remove(rel: string): Promise<void>
    backlinks(name: string): Promise<NoteRef[]>
    search(q: string): Promise<SearchHit[]>
    importAttachment(bytes: Uint8Array, filename: string, forNoteRel: string): Promise<string>
    attachmentUrl(noteRel: string, linkPath: string): Promise<string>   // cockpit-file:// URL
  }
  para: {
    createContainer(kind: 'project' | 'area' | 'resource', name: string, opts?: { area?: string; deadline?: string }): Promise<string>
    setProjectMeta(rel: string, meta: { status?: 'active' | 'done'; deadline?: string | null; area?: string | null }): Promise<void>
    archive(containerRel: string): Promise<string>
    unarchive(archivedRel: string): Promise<string>
  }
  diary: { open(date: string): Promise<string> }
  tasks: {
    list(view: TaskView, includeDone?: boolean): Promise<TaskItem[]>
    add(input: TaskInput): Promise<TaskItem>
    update(h: TaskHandle, patch: TaskPatch): Promise<void>
    complete(h: TaskHandle): Promise<void>
    uncomplete(h: TaskHandle): Promise<void>
    move(h: TaskHandle, toContainer: string): Promise<void>
    remove(h: TaskHandle): Promise<void>
  }
  habits: {
    list(): Promise<HabitList>
    add(name: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    reorder(active: string[]): Promise<void>
    archive(name: string): Promise<void>
    unarchive(name: string): Promise<void>
    setTick(date: string, name: string, value: boolean): Promise<void>
    history(from: string, to: string): Promise<Record<string, Record<string, boolean>>>
  }
  on(event: 'vault-changed', cb: (rels: string[]) => void): () => void
  on(event: 'day-changed', cb: (today: string) => void): () => void
}
export const API_CHANNELS: string[]   // 'app.state', 'notes.read', ... one per method above
```

- Renderer hook: `useVault<T>(load: () => Promise<T>, deps?: unknown[]): { data: T | undefined; reload(): void }` which re-runs `load` on every `vault-changed` and `day-changed` event.
- Renderer navigation state in `App.tsx`: `type Route = { screen: 'today'; date?: string } | { screen: 'tasks' } | { screen: 'habits' } | { screen: 'note'; rel: string }`, with `navigate(route)` passed by React context `NavContext`.

- [ ] **Step 1: Write the failing test.** `ipc-contract.test.ts` imports `API_CHANNELS` and a `registerIpc(handle, deps)` function from `ipc.ts`, calls it with a fake `handle` that records channel names, and asserts the recorded set equals `API_CHANNELS` exactly (no missing, no extra).
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement `ipc.ts`: `registerIpc(handle: (channel: string, fn: (...args: any[]) => unknown) => void, deps: { vault, index, notes, tasks, habits, diary, settings })`. Every mutating handler lets the services update the index, then emits `vault-changed`. Errors propagate with their message intact.
- [ ] **Step 4:** Implement `preload/index.ts` building `window.cockpit` from `API_CHANNELS` with `ipcRenderer.invoke`, plus `on`. Implement `main/index.ts` startup: load settings (honouring `COCKPIT_VAULT` and `COCKPIT_USER_DATA`); if `vaultPath` is set and `Vault.isUsable`, ensure skeleton, build index, start watcher and day-change timer; otherwise start with no vault. Register a `cockpit-file://` protocol that serves files from inside the vault only, with range-request support so video can seek.
- [ ] **Step 5:** Implement the shell. `VaultPicker` shows when `vaultUsable` is false: if `vaultPath` is set, the text "Cockpit can't find your notes folder at `<path>`. Google Drive may not be running, or the folder was moved."; always a "Choose folder" button; and the note "In Google Drive, set this folder to Available offline." `Sidebar` shows search field, Today, Tasks, Habits, then the tree from `notes.tree()` with Inbox first and a count badge of Inbox notes plus open Inbox tasks, expandable folders, and "New project", "New area", "New note" buttons. If `duplicates` is non-empty, a small warning line at the bottom lists the clashing names. Three-column CSS grid layout: sidebar 240px, centre flexible, right rail 280px (rendered only by Today). Light and dark colours via `prefers-color-scheme`.
- [ ] **Step 6:** Run `npm test` and `npm run typecheck`. Expect PASS. Run `npm run dev`, choose a temp folder, confirm the skeleton folders appear on disk and the sidebar shows them.
- [ ] **Step 7:** Commit: `feat: IPC contract, app wiring, shell, and vault picker`.

---

### Task 11: Editor with live preview

**Files:**
- Create: `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/livePreview.ts`, `src/renderer/src/editor/useNoteFile.ts`
- Test: `tests/renderer/live-preview.test.ts`, `tests/renderer/fidelity.test.ts`, `tests/fixtures/sample.md`, `tests/fixtures/crlf.md`

**Interfaces:**
- Consumes: `window.cockpit.notes.read/save`, `on('vault-changed')`.
- Produces:

```ts
// livePreview.ts
export function detectLineSeparator(text: string): '\n' | '\r\n'
export function createState(text: string, extensions?: Extension[]): EditorState   // sets EditorState.lineSeparator
export function hiddenRanges(state: EditorState): { from: number; to: number }[]
  // syntax marks to hide: heading #s, emphasis and strong markers, inline code ticks, link URL parts,
  // strikethrough markers, and the whole frontmatter block; nothing on a line that holds a selection head
export const livePreview: Extension      // decorations from hiddenRanges plus heading, quote, list, checkbox styling
// useNoteFile.ts
export function useNoteFile(rel: string): {
  text: string | null; onChange(text: string): void; flush(): Promise<void>; conflictCopy: string | null
}
// Editor.tsx
export function Editor(props: { rel: string; extensions?: Extension[]; autoFocus?: boolean }): JSX.Element
```

Behaviour. `useNoteFile` reads on mount, saves 600 ms after the last change with the last known hash as `baseHash`, flushes on unmount and on window blur, and never saves if the text equals what was last read or saved. On `vault-changed` for its file: if there are no unsaved edits it reloads, keeping the cursor position where possible; if there are, it does nothing and lets the next save produce a conflict copy, which it surfaces as a dismissible banner "This note changed on disk while you were editing. The other version was saved as `<name>`." Checkboxes in rendered task-list items are clickable and toggle `[ ]`/`[x]` in the text.

- [ ] **Step 1: Write failing tests**

```ts
// fidelity.test.ts: for each fixture (sample.md has headings, lists, a table, an image link, a video link,
// wikilinks, frontmatter, emoji task lines, trailing spaces, and no final newline; crlf.md uses \r\n)
const raw = readFileSync(path, 'utf8')
const st = createState(raw)
expect(st.sliceDoc()).toBe(raw)                                        // load is lossless
const edited = st.update({ changes: { from: 0, insert: 'X' } }).state
expect(edited.sliceDoc()).toBe('X' + raw)                              // an edit changes only what was edited
expect(detectLineSeparator('a\r\nb')).toBe('\r\n'); expect(detectLineSeparator('a\nb')).toBe('\n')

// live-preview.test.ts
const doc = '---\ndate: 2026-11-11\n---\n# Title\n\nSome **bold** and *em* and `code`.\n'
const at = (pos: number) => createState(doc).update({ selection: { anchor: pos } }).state
const hidden = (s: EditorState) => hiddenRanges(s).map(r => s.sliceDoc(r.from, r.to))
// cursor on the last line: frontmatter, '# ', and inline marks on other lines are hidden
expect(hidden(at(doc.length))).toEqual(expect.arrayContaining(['---\ndate: 2026-11-11\n---\n', '# ']))
// cursor on the bold line: that line's marks are shown
expect(hidden(at(doc.indexOf('bold')))).not.toContain('**')
// cursor elsewhere: they are hidden
expect(hidden(at(doc.indexOf('Title'))).filter(x => x === '**')).toHaveLength(2)
// cursor inside frontmatter shows it
expect(hidden(at(5))).not.toContain('---\ndate: 2026-11-11\n---\n')
```

- [ ] **Step 2:** Run `npx vitest run tests/renderer`. Expect FAIL.
- [ ] **Step 3:** Implement. Walk the Lezer markdown syntax tree (`syntaxTree(state)`) with GFM enabled to find mark nodes; frontmatter is detected with `splitFrontmatter` from core. Build decorations from a `StateField` (block-level replacements require a field, not a view plugin).
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Mount `Editor` for route `note`. Run `npm run dev`; open a note, type headings, bold, lists, and a checkbox; confirm rendering, autosave to disk, and that a file opened and closed without typing has an unchanged modified time.
- [ ] **Step 6:** Commit: `feat(editor): live-preview markdown editor with lossless save`.

---

### Task 12: Editor media, tables, wikilinks, backlinks

**Files:**
- Create: `src/renderer/src/editor/media.ts`, `src/renderer/src/editor/tables.ts`, `src/renderer/src/editor/wikilinks.ts`, `src/renderer/src/components/Backlinks.tsx`
- Modify: `src/renderer/src/editor/Editor.tsx`
- Test: `tests/renderer/media.test.ts`, `tests/renderer/tables.test.ts`, `tests/renderer/wikilinks.test.ts`

**Interfaces:**
- Consumes: `createState`, `notes.importAttachment`, `notes.attachmentUrl`, `notes.all`, `notes.openOrCreateByName`, `notes.backlinks`, `extractWikilinks` from core, `NavContext`.
- Produces:

```ts
// media.ts
export interface MediaRef { from: number; to: number; path: string; alt: string; type: 'image' | 'video' }
export function findMedia(state: EditorState): MediaRef[]      // ![alt](path); video if .mp4/.mov/.webm (case-insensitive)
export function mediaExtension(noteRel: string): Extension     // block widgets below the line; paste and drop handlers
// tables.ts
export interface TableRef { from: number; to: number; rows: string[][]; align: ('left' | 'center' | 'right' | null)[] }
export function findTables(state: EditorState): TableRef[]
export const tableExtension: Extension                         // renders an HTML table when the selection is outside it
// wikilinks.ts
export function wikilinkExtension(opts: { names: () => string[]; open: (name: string) => void }): Extension
export function completionRange(textBeforeCursor: string): { from: number; query: string } | null
```

Behaviour. Images render as `<img>` (max width 100%), video as `<video controls>` (max width 100%), both through `attachmentUrl`; http(s) image URLs render directly. Pasting or dropping image or video files calls `importAttachment` and inserts the returned markdown on its own line at the cursor or drop position. A table renders as a table while the selection is outside it and shows raw markdown when the cursor enters it. Typing `[[` opens autocomplete over all note names; choosing one inserts `Name]]`. A wikilink renders as a link (alias if present) when the cursor is off it; Cmd+click, or a plain click when rendered, calls `open(target)`, which calls `openOrCreateByName` then navigates. `Backlinks` lists `notes.backlinks(name)` under the editor on every note except diary pages, hidden when empty.

- [ ] **Step 1: Write failing tests**

```ts
// media.test.ts
const s = createState('![a](../../Attachments/p.png)\ntext ![](clip.MOV) more\n`![](no.png)`\n![x](https://e.com/i.jpg)\n')
expect(findMedia(s).map(m => [m.path, m.type])).toEqual([
  ['../../Attachments/p.png', 'image'], ['clip.MOV', 'video'], ['https://e.com/i.jpg', 'image']])
expect(findMedia(createState('![](my%20pic.png)'))[0].path).toBe('my%20pic.png')

// tables.test.ts
const t = createState('before\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\nafter\n')
expect(findTables(t)).toHaveLength(1)
expect(findTables(t)[0].rows).toEqual([['a', 'b'], ['1', '2']])
expect(findTables(t)[0].align).toEqual(['left', 'right'])
expect(findTables(createState('| not | a table\n'))).toEqual([])

// wikilinks.test.ts
expect(completionRange('see [[Roh')).toEqual({ from: 6, query: 'Roh' })
expect(completionRange('see [[Robin]] and')).toBeNull()
expect(completionRange('plain')).toBeNull()
expect(completionRange('[[a|b')).toBeNull()
```

- [ ] **Step 2:** Run `npx vitest run tests/renderer`. Expect FAIL on the new files.
- [ ] **Step 3:** Implement the three extensions and `Backlinks`, and add them to `Editor`.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Run `npm run dev`. Paste a screenshot, drop an `.mp4`, type a table, type `[[` and pick a note, click a link to a note that does not exist. Confirm: files land in `Attachments/`, the video plays and seeks, the table renders, the new note appears in Inbox, and the linked note shows a backlink.
- [ ] **Step 6:** Commit: `feat(editor): media, tables, wikilinks, backlinks`.

---

### Task 13: Today screen

**Files:**
- Create: `src/renderer/src/screens/Today.tsx`, `src/renderer/src/components/TaskRow.tsx`, `src/renderer/src/components/TaskAdd.tsx`, `src/renderer/src/components/HabitTicks.tsx`
- Test: `tests/renderer/today-logic.test.ts`

**Interfaces:**
- Consumes: `diary.open`, `tasks.list({ view: 'today' })`, `tasks.add/complete`, `habits.list/setTick/history`, `app.state`, `on('day-changed')`, `Editor`, `addDays` from core.
- Produces:

```ts
// TaskRow.tsx
export function TaskRow(props: { task: TaskItem; today: string; showContainer?: boolean; onOpen?: () => void }): JSX.Element
  // checkbox, title, container tag, due label; overdue due labels styled as overdue
export function dueLabel(due: string | undefined, today: string): string
// TaskAdd.tsx
export function TaskAdd(props: { defaultContainer?: string; defaultDue?: string }): JSX.Element
export function parseQuickAdd(input: string, today: string): { title: string; due?: string; priority?: Priority }
// HabitTicks.tsx
export function HabitTicks(props: { date: string }): JSX.Element
export function lastSevenDays(date: string): string[]      // oldest first, ending on `date`
```

Behaviour. On launch and on route `today` with no date, the screen shows `app.state().today`. Header: the date as `Wednesday, 11 November`, previous and next arrows, a date input, and a "Today" button when viewing another day. Centre: `Editor` on `diary.open(date)`. Right rail: "Today's tasks" always lists the real today's tasks regardless of the day shown, each with its container tag, then `TaskAdd` (default due today, container Inbox with a dropdown of projects and areas); "Habits" shows `HabitTicks` for the day shown: one checkbox per active habit with seven small squares for the seven days ending on that day. On `day-changed`, if the screen was showing the old today, it flushes the editor and switches to the new today.

- [ ] **Step 1: Write failing tests**

```ts
expect(dueLabel('2026-11-11', '2026-11-11')).toBe('Today')
expect(dueLabel('2026-11-12', '2026-11-11')).toBe('Tomorrow')
expect(dueLabel('2026-11-10', '2026-11-11')).toBe('Yesterday')
expect(dueLabel('2026-11-06', '2026-11-11')).toBe('5 days overdue')
expect(dueLabel('2026-11-20', '2026-11-11')).toBe('20 Nov')
expect(dueLabel(undefined, '2026-11-11')).toBe('')
expect(lastSevenDays('2026-11-11')).toEqual(['2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10','2026-11-11'])
expect(parseQuickAdd('Call CA tomorrow !high', '2026-11-11')).toEqual({ title: 'Call CA', due: '2026-11-12', priority: 'high' })
expect(parseQuickAdd('Send deck today', '2026-11-11')).toEqual({ title: 'Send deck', due: '2026-11-11' })
expect(parseQuickAdd('Read about tomorrow land', '2026-11-11')).toEqual({ title: 'Read about tomorrow land' })  // only a trailing word counts
expect(parseQuickAdd('Plain', '2026-11-11')).toEqual({ title: 'Plain' })
```

- [ ] **Step 2:** Run `npx vitest run tests/renderer/today-logic.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement the helpers and components. `parseQuickAdd` recognises a trailing `today` or `tomorrow` and a trailing `!high`, `!medium`, `!low`, in either order. When `TaskAdd` gets no date from the text, it uses `defaultDue`.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Run `npm run dev`. Write in today's diary, add a task in the rail, tick it, tick a habit, go to yesterday and back. Confirm the diary file's frontmatter gains the habit and the body is untouched.
- [ ] **Step 6:** Commit: `feat: Today screen`.

---

### Task 14: Tasks and Habits screens

**Files:**
- Create: `src/renderer/src/screens/TasksScreen.tsx`, `src/renderer/src/components/TaskEditor.tsx`, `src/renderer/src/screens/HabitsScreen.tsx`, `src/renderer/src/components/HabitGrid.tsx`
- Test: `tests/renderer/habit-grid.test.ts`

**Interfaces:**
- Consumes: `tasks.*`, `habits.*`, `notes.tree` (for the container list), `TaskRow`, `TaskAdd`, `REPEAT_PRESETS`, `weekday`, `addDays`.
- Produces:

```ts
// HabitGrid.tsx
export interface GridWeek { start: string; days: string[]; counts: Record<string, number> }
export function buildGrid(today: string, weeks: number, habits: string[], history: Record<string, Record<string, boolean>>): GridWeek[]
  // weeks run Monday to Sunday; the last week is the one containing `today`; oldest first
export function HabitGrid(props: { today: string }): JSX.Element
// TaskEditor.tsx
export function TaskEditor(props: { task: TaskItem; onClose: () => void }): JSX.Element
```

Behaviour, Tasks screen. Tabs: Today, Upcoming, Inbox, By project or area. The last groups open tasks under each project and area heading (areas first, then projects, alphabetical), and includes undated tasks. A "Show completed" toggle. `TaskAdd` at the top of each tab, with the container preset in grouped view. Clicking a task opens `TaskEditor`: title, due date (with a clear button), priority, repeat (presets plus a free-text field accepting `every N days` and `every N weeks`), container dropdown (calls `tasks.move`), and Delete. Service error messages are shown inline.

Behaviour, Habits screen. Top: the list of active habits with add, rename (inline), drag to reorder, and archive; an "Archived" section with unarchive. Below: `HabitGrid` for the last twelve weeks: one row per active habit, one square per day (filled when ticked, empty otherwise, days after today blank), and the week's count at the end of each week's block. Clicking a square for today or a past day toggles that tick. No streaks, no percentages, no colour that signals failure.

- [ ] **Step 1: Write failing tests**

```ts
const g = buildGrid('2026-11-11', 12, ['Run'], { '2026-11-09': { Run: true }, '2026-11-11': { Run: true }, '2026-08-24': { Run: true } })
expect(g).toHaveLength(12)
expect(g[11].start).toBe('2026-11-09')                       // Monday of the week containing today
expect(g[11].days).toHaveLength(7)
expect(g[11].counts).toEqual({ Run: 2 })
expect(g[0].start).toBe('2026-08-24')
expect(g[0].counts).toEqual({ Run: 1 })
expect(buildGrid('2026-11-15', 1, [], {})[0].start).toBe('2026-11-09')   // Sunday belongs to the week that began Monday
```

- [ ] **Step 2:** Run `npx vitest run tests/renderer/habit-grid.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement both screens and their components.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Run `npm run dev`. Create a repeating task, complete it late, and confirm exactly one new occurrence. Add, rename, reorder, and archive habits; tick past days in the grid.
- [ ] **Step 6:** Commit: `feat: Tasks and Habits screens`.

---

### Task 15: Project and area pages, PARA actions, search

**Files:**
- Create: `src/renderer/src/screens/NotePage.tsx`, `src/renderer/src/shell/CommandPalette.tsx`, `src/renderer/src/shell/NameDialog.tsx`
- Modify: `src/renderer/src/shell/Sidebar.tsx`, `src/renderer/src/App.tsx`
- Test: `tests/renderer/palette.test.ts`

**Interfaces:**
- Consumes: `notes.*`, `para.*`, `tasks.list({ view: 'container' })`, `Editor`, `Backlinks`, `TaskRow`, `TaskAdd`.
- Produces:

```ts
// CommandPalette.tsx
export function mergeResults(query: string, notes: NoteRef[], hits: SearchHit[]): { rel: string; name: string; snippet?: string }[]
  // title matches first (prefix before substring, case-insensitive), then full-text hits, de-duplicated by rel, max 20
export function CommandPalette(props: { open: boolean; onClose: () => void }): JSX.Element
// NameDialog.tsx
export function NameDialog(props: { title: string; initial?: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }): JSX.Element
  // shows the rejected promise's message inline and stays open
```

Behaviour. `NotePage` renders any note: a title bar with the note name, a Rename button (`NameDialog` then `notes.rename`), a "Move to" menu of containers, and Delete (to Trash, after a confirm); the `Editor`; `Backlinks`. When the note is a project or area home note, a side panel shows that container's open tasks with `TaskAdd` preset to it, and its other notes; projects also show status (Active or Done), deadline, and area fields wired to `para.setProjectMeta`, plus an Archive button. Archived containers show Unarchive. Sidebar: "New project", "New area", "New resource topic" open `NameDialog` and call `para.createContainer`; "New note" creates in the folder of the currently open note's container, else Inbox, then navigates to it; notes can be dragged onto a project, area, or resource folder to move them; a right-click menu on folders and notes offers Rename, Archive or Unarchive, and Delete. Cmd+K opens `CommandPalette`: empty query lists recently opened notes (kept in memory), typing shows `mergeResults`, Enter opens, Esc closes; the sidebar search field opens the same palette. A gear button at the foot of the sidebar opens a small settings panel with two controls: "Day ends at" (hour 0 to 6, wired to `app.setRolloverHour`) and "Change notes folder" (`app.chooseVault`).

- [ ] **Step 1: Write failing tests**

```ts
const notes = [{ rel: 'Inbox/Robin.md', name: 'Robin' }, { rel: 'Areas/Job/Job.md', name: 'Job' }, { rel: 'Inbox/Throw.md', name: 'Throw' }] as NoteRef[]
const hits = [{ rel: 'Areas/Job/Job.md', name: 'Job', snippet: '...asked Robin about...' }, { rel: 'Inbox/Robin.md', name: 'Robin', snippet: 'x' }]
expect(mergeResults('ro', notes, hits).map(r => r.rel)).toEqual(['Inbox/Robin.md', 'Inbox/Throw.md', 'Areas/Job/Job.md'])
expect(mergeResults('', notes, [])).toEqual([])
expect(mergeResults('zzz', notes, [])).toEqual([])
```

- [ ] **Step 2:** Run `npx vitest run tests/renderer/palette.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement the page, palette, dialog, and sidebar actions.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Run `npm run dev`. Create a project and an area, add notes, drag a note out of Inbox, rename a linked note and confirm links follow, archive and unarchive the project, try the name `a/b` and confirm the inline error, and find a note by a word in its body with Cmd+K.
- [ ] **Step 6:** Commit: `feat: project and area pages, PARA actions, search palette`.

---

### Task 16: End-to-end smoke test and packaging

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `electron-builder.yml`, `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the built app, `COCKPIT_VAULT`, `COCKPIT_USER_DATA`.
- Produces: `npm run e2e` (builds, then runs Playwright against Electron); `npm run package` producing `dist/mac-arm64/Cockpit.app`, unsigned.

- [ ] **Step 1: Write the smoke test.** Launch with `_electron.launch` pointing `COCKPIT_VAULT` and `COCKPIT_USER_DATA` at fresh temp directories. Add stable `data-testid` attributes where needed. Steps and assertions:
  1. The Today screen is visible and `Diary/<year>/<today>.md` exists on disk.
  2. Type `Hello diary` in the editor; within 2 s the file's body contains `Hello diary`.
  3. Add task `Smoke task` in the rail; `Inbox/Tasks.md` contains `- [ ] Smoke task 📅 <today>`.
  4. Tick it; the file contains `- [x] Smoke task` and `✅ <today>`; the row leaves the rail.
  5. On the Habits screen add habit `Run`; back on Today tick it; the diary frontmatter contains `Run: true` and the body still contains `Hello diary`.
  6. Write `Projects/Ext/Ext.md` directly to disk from the test; within 3 s the sidebar shows `Ext` (proves the watcher).
  7. Press Cmd+K, type `Ext`, press Enter; the note page for `Ext` is shown.
  8. Close the app; relaunch with the same directories; `Hello diary` is shown again.
  9. Relaunch with `COCKPIT_USER_DATA` settings pointing at a path that does not exist; the vault picker is shown with the "can't find your notes folder" text, and that path still does not exist.
- [ ] **Step 2:** Run `npm run e2e`. Fix whatever fails until it passes.
- [ ] **Step 3:** Add `electron-builder.yml` (`appId: local.cockpit`, `productName: Cockpit`, `mac.target: dir`, `mac.identity: null`). Run `npm run package`. Expect `dist/mac-arm64/Cockpit.app` to exist and launch.
- [ ] **Step 4:** Write `README.md`: what Cockpit is, how to run in development, how to test, how to package and copy the app to Applications, the vault layout, and the Google Drive "Available offline" note.
- [ ] **Step 5:** Run the full check: `npm test && npm run typecheck && npm run e2e`. Expect all green.
- [ ] **Step 6:** Walk the spec's section 8 "Done means" list by hand in the packaged app against a folder inside Google Drive, and record the result of each of the seven items in the commit message body.
- [ ] **Step 7:** Commit: `test: end-to-end smoke test; build: package Cockpit.app`.
