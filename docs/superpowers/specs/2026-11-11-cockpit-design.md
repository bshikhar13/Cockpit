# Cockpit: design

Date: 2026-11-11
Status: stage 1 built; later stages outlined

Cockpit is a personal knowledge management app for one person on one Mac. It
aims to replace a separate notes app, task manager, and calendar habit with one
place built around daily writing.

Throughout this document, **(decided)** marks a product requirement, and
**(call)** marks an implementation choice that can be revisited.

## 1. Why this exists

Many people juggle several parts of life at once (work, side projects,
health, learning, hobbies) across separate tools. A common pattern:

- Thoughts go into a notes app as new notes each time and get buried.
- The task manager is cluttered: tasks from every part of life sit in one pile.
- Time blocking never sticks, because putting tasks on a calendar is a habit
  that is hard to build.

The diagnosis: capture is easy, and everything after capture fails. The habit
most likely to stick is daily free-form writing.
So the system is built around that habit, uses the PARA method (Projects,
Areas, Resources, Archive) as the spine that everything hangs from, and over
time hands the filing, resurfacing, and scheduling to background agents.

## 2. The whole system, in stages

The user asked for eight things: diary, PARA notes, tasks, habits, Google
Calendar with time blocking, a vault for web resources, a central chat backed
by local-LLM agents, and help posting to Twitter and LinkedIn. That is several
projects. They are built in this order, and **this document specifies stage 1
only**. Each later stage gets its own design conversation before it is built.

| Stage | What | Status |
|---|---|---|
| 1 | Daily writing, PARA notes, tasks, habits | Specified here |
| 2 | Google Calendar and automatic time blocking | Outline in section 9 |
| 3 | Local-LLM agents and central chat | Outline in section 9 |
| 4 | Vault for web resources | Outline in section 9 |
| 5 | Twitter and LinkedIn topics and drafting | Outline in section 9 |

Stage 1 is daily writing, tasks, and habits **(decided)**: the smallest set
that can replace the notes app and task manager for daily use. The order of
stages 2 to 5 is a **(call)**.

Stage 1 contains no AI. The agents need real diary entries and tasks to work
on, and the user gets a usable app sooner.

## 3. Goals, non-goals, anti-goals

### Goals for stage 1

- The user can run a whole day in Cockpit without opening Obsidian or
  Todoist: write the diary, see and tick today's tasks, tick habits, and find
  any note.
- Every note and task belongs to a Project or Area, or sits visibly in an
  inbox, so nothing gets buried.
- All data is plain markdown in a folder that Google Drive syncs.

### Non-goals for stage 1

- No AI, chat, or agents.
- No calendar or time blocking.
- No web clipper or resource vault beyond ordinary notes in Resources.
- No social posting features.
- No import from other apps; a vault starts fresh **(decided)**.
- No iPhone app; the Mac only, for now **(decided)**.
- No collaboration, plugin system, or graph view.

### Anti-goals: these make it a failure even if it works

- **Lock-in.** If the app vanished, the folder must still be readable and
  editable in any markdown editor, Obsidian included.
- **New chores.** Anything that needs a daily maintenance habit to stay
  useful, such as a daily review queue **(decided)**.
- **Nagging.** No reminders or streak pressure on habits. Habits are trackers
  filled in at the end of the day, not rules to follow **(decided)**.
- **Touching the diary.** Nothing other than the user ever changes diary
  text. This binds later stages too.

## 4. The vault: what is on disk

The vault is one folder chosen on first launch, typically inside Google Drive
for desktop (`~/Library/CloudStorage/GoogleDrive-<account>/My Drive/`). The app only reads
and writes local files; Drive does all syncing **(call)**. The first-launch
screen should tell the user to set the vault folder to "Available offline" in
Drive so files are real local files and not cloud placeholders.

The app's code lives separately, outside Drive.

```
<vault>/
  Diary/
    2026/
      2026-11-11.md
  Projects/
    <Project name>/
      <Project name>.md      the project's home note
      Tasks.md
      <other notes>.md
  Areas/
    <Area name>/
      <Area name>.md         the area's home note
      Tasks.md
      <other notes>.md
  Resources/
    <Topic>/
      <notes>.md
  Archive/
    <moved project, area, or resource folders>
  Attachments/
    <images and videos>
  Inbox/
    Tasks.md                 tasks with no home yet
    <loose notes>.md         notes with no home yet
  Habits.md                  the list of habits being tracked
```

All of the layout above is a **(call)**.

**Inbox** is the one place for anything without a home. It appears in the
sidebar above Projects with a count of what is in it, so loose items stay
visible instead of buried. "New note" creates the note in whichever project,
area, or resource folder is currently open, and in Inbox otherwise. Notes and
tasks can be dragged from Inbox to a project or area.

**What "today" means.** The day rolls over at 04:00, not midnight, so writing
and ticking habits at 00:30 still lands on the day that is ending. This applies
everywhere: which diary file opens, which day habit ticks go to, what counts as
due or overdue, and repeat dates. The hour is a setting **(call)**.

### Markdown

- GitHub-flavoured markdown: headings, lists, checkboxes, tables, code, links.
- **Images and video** **(decided: must be supported)**: dropping or pasting a
  file copies it into `Attachments/` and inserts a standard relative link,
  `![](../../Attachments/name.png)`. A link whose target has a video extension
  (`.mp4`, `.mov`, `.webm`) renders as an inline player **(call)**.
- **Links between notes**: `[[Note name]]` wikilinks, with autocomplete while
  typing and click to open. Each note shows a list of the notes that link to
  it **(call)**.
- **Link rules** **(call)**: links resolve by note name, not path, so moving
  or archiving a note never breaks them. Note names are therefore unique
  across the vault, enforced when a note is created or renamed. `Tasks.md`
  files are exempt and cannot be linked to. Diary notes are named by their
  date. Clicking a link to a note that does not exist creates it in Inbox.
  Renaming a note rewrites the links that point to it everywhere, diary
  included; this changes only the link target, and only as a result of the
  user's own rename.
- YAML frontmatter holds structured data where needed.

### Diary files

One file per day, created the first time that day is opened. Frontmatter holds
the date and that day's habit ticks. Everything below is the user's free
text.

```markdown
---
date: 2026-11-11
habits:
  Run: true
  Write: true
---

Spent the morning on the pilot deck...
```

A habit absent from the map, or `false`, means not done. There is no separate
"skipped" state **(call)**.

### Projects and areas

- A **Project** has an outcome and an end. Its home note's frontmatter holds
  `status` (`active` or `done`), an optional `deadline`, and an optional
  `area` naming the Area it belongs to.
- An **Area** is ongoing with no end: Work, Health, Fitness, Music.
- Archiving moves the whole folder into `Archive/`. Unarchiving moves it back.
  Archived tasks do not appear in task views.

### Tasks

Tasks are checkbox lines in a `Tasks.md` file (or `Inbox.md`), using the
Obsidian Tasks plugin's emoji format so they stay readable and portable
**(call)**:

```markdown
- [ ] Send pilot deck 📅 2026-11-12 ⏫ 🆔 k3f9a2
- [ ] Review PR queue 🔁 every weekday 📅 2026-11-11 🆔 p8x1c4
- [x] Book physio 📅 2026-11-10 ✅ 2026-11-10 🆔 m2d7q9
```

- A task's project or area is the folder its file is in.
- Fields: title, optional due date, optional priority (high, medium, low),
  optional repeat rule, and a short id generated on creation. The id is there
  so later stages can link calendar blocks and agent actions to a task.
- Repeat rules supported: every day, every weekday, every week, every month,
  every N days or weeks. Completing a repeating task marks it done and adds
  the next occurrence below it.
- The next occurrence is the first date matching the rule that falls after the
  day the task was completed. A daily task ticked five days late produces one
  new task for tomorrow, never a backlog of missed copies **(call)**.
- A repeating task always has a due date. Adding a repeat rule to a task
  without one sets the due date to today.
- Checkbox lines the user types in the diary or in ordinary notes are just
  checkboxes in stage 1. They are not tasks. Lifting tasks out of the diary is
  stage 3's job.

### Habits

`Habits.md` is a plain list of habit names, with archived habits under a
separate heading. Habits are yes or no only **(decided)**. Renaming a habit in
the app rewrites its key in past diary files so history is kept **(call)**.

## 5. The app: what the user sees

Layout: **writing first** **(decided)**, chosen over a dashboard-first layout. Three columns.

**Left sidebar.** Today, Tasks, Habits at the top. Below them the PARA tree:
Projects, Areas, Resources, Archive, each expandable to its folders and notes.
New project, area, and note buttons. Search at the top.

**Centre.** The editor. Markdown renders as you type (tables as tables, images
and video inline), with no separate preview mode. Saves automatically.

**Right rail, on the Today screen only.**
- *Today's tasks*: every task due today or overdue, each showing its project
  or area as a tag. Tick to complete. An "add task" line at the bottom: type a
  title, optionally pick a project or area (default Inbox); the due date
  defaults to today. Overdue tasks stay in this list until completed or
  re-dated.
- *Habits*: one checkbox per active habit with the last seven days shown as
  small squares beside it.

### Screens

- **Today.** Opens on launch. Today's diary in the centre, rail on the right.
  Previous-day and next-day arrows and a date picker move through the diary;
  the rail's habit ticks follow the day shown, while its task list always
  shows the real today.
- **Tasks.** Views: Today, Upcoming (next seven days), Inbox, and By project
  or area. Tasks with no due date appear only under their project or area and
  in Inbox, never under Today. This is the rule that prevents Todoist-style
  clutter **(call)**. Completed tasks are hidden by default with a toggle to
  show them. Tasks can be added, edited, moved between projects and areas, and
  deleted here.
- **Habits.** Add, rename, reorder, and archive habits. A history grid shows
  the last twelve weeks, one row per habit, one square per day, with a count
  per week. No streak counters, no reminders.
- **Project or area page.** The home note in the editor, with that project's
  open tasks and its list of notes shown alongside.
- **Search.** A Cmd+K palette that finds notes by title and by full text, and
  opens the result.

## 6. How it is built

All of this section is a **(call)**.

- **Electron** desktop app with **React** and **TypeScript**, built with Vite.
  Tauri was considered and dropped: it needs a Rust toolchain, and the
  background agents of stage 3 are simpler to run in Node. The larger
  app size does not matter for personal use.
- **Editor**: file fidelity wins over a fully word-processor-like feel. Use a
  source-preserving live-preview editor in the style of Obsidian's (CodeMirror
  6 is the suggested base): the document in memory is the markdown text
  itself, with formatting, tables, images, and video rendered in place and the
  raw markdown shown for the element under the cursor. Editors that parse and
  re-serialise the whole file (Milkdown, TipTap) are ruled out because they
  reformat text the user did not touch. Hard requirements: opening a file
  never writes to it, and an edit changes only the characters edited.
- **Files are the source of truth.** A SQLite index (full-text search, task
  list, backlinks, habit history) lives in
  `~/Library/Application Support/Cockpit/`, outside the vault so Drive never
  syncs it. It can be deleted and rebuilt from the files at any time.
- **File watching.** The app watches the vault and updates the index and any
  open note when files change on disk, whether from Drive or another editor.
  If a file changes on disk while the user has unsaved edits to it, the
  user's version is kept and the disk version is saved beside it as a
  conflict copy; nothing is silently discarded.
- **Packaging.** A local unsigned `.app` the user drags to Applications. No
  auto-update, no distribution.

### Left to the builder

Folder structure of the codebase, state management, component library, visual
styling (clean and quiet, with light and dark mode following the system),
exact keyboard shortcuts beyond Cmd+K, the id format for tasks, and how the
index schema is laid out.

## 7. Testing

- Unit tests for everything that reads or writes the file formats: task line
  parsing and writing, repeat-rule next-date calculation, diary frontmatter
  and habit ticks, habit rename, archive moves.
- Round-trip tests for the editor: a set of sample markdown files (tables,
  images, video links, wikilinks, frontmatter) must survive open and save.
- One end-to-end smoke test that launches the app on a temporary vault, writes
  a diary entry, adds and completes a task, ticks a habit, and checks the
  files on disk.

## 8. Done means

Stage 1 is done when, on a fresh vault inside Google Drive, the user can:

1. Open the app and start typing in today's diary with no setup beyond
   picking the vault folder.
2. Paste an image, drop a video, and build a table, and see all three inline.
3. Create a project and an area, add notes to them, and link between notes.
4. Add tasks with due dates, priorities, and repeats; see today's in the rail;
   complete them.
5. Define habits and tick them at the end of the day; see the twelve-week
   grid.
6. Find any note with Cmd+K.
7. Open the same vault in another markdown editor and read everything.

## 9. Later stages: decisions already made

These are not specified for building. They record decisions already made so
they are not lost.

### Stage 2: Google Calendar and time blocking

- Integrates with Google Calendar **(decided)**.
- Placing tasks on a calendar is a habit most people do not have
  **(decided)**. So each morning the app drafts the day by placing tasks into
  free gaps around existing events, and the user accepts or nudges the blocks.
  This auto-draft approach is a **(call)** to confirm.

### Stage 3: Agents and central chat

- A central chat area that can reach all of the data, with agents working in
  the background to pull out the right information **(decided)**.
- A local LLM **(decided)**. Recommendation **(call)**: Ollama as the runner;
  Gemma 4 12B (about 8 GB) as the main model on a Mac with 16-18 GB of memory;
  `qwen3-embedding:0.6b` for search, with `nomic-embed-text` as fallback.
  Sources for these picks disagreed and were not verified against primary
  sources, so the model must be swappable and tested on real notes
  before committing.
- Agents read the diary after the fact: link entries to projects, areas, and
  people; lift tasks and ideas out; build a page per person mentioned
  (**call**).
- **Agents act on their own; there is no approval queue** **(decided)**. To
  keep mistakes cheap **(call)**: an activity log with one-click undo, visible
  marking of agent-made items, and hard limits: agents never edit diary text,
  never delete, and never post.

### Stage 4: Vault for web resources

- A place to keep useful resources collected from the web **(decided)**. It
  will live under Resources as markdown. Capture method is undecided.

### Stage 5: Twitter and LinkedIn

- Material comes from the user's own writing: daily learnings, work, personal
  experiences, thoughts, and recent reading **(decided)**.
- A daily list of topics to write about, and what to read in order to write on
  them **(decided)**.
- Drafts strictly in the user's own tone and language **(decided)**.
- A cloud LLM may be used here **(decided)**. Call: Claude, drafting only,
  receiving only the excerpts behind a draft; anything marked private is never
  sent.
- The user publishes; the app does not post **(call)**.

## 10. Encryption (added 2026-11-12)

An option to encrypt everything, with a passcode required every time the app opens and the
passcode acting as the key **(decided)**. The threat is the cloud provider and anyone who gets
into the user's Drive **(decided)**. A recovery key is offered **(decided)**.

This knowingly reverses the lock-in anti-goal in section 3 for folders where it is turned on: an
encrypted folder can be opened only by Cockpit with the passcode or the recovery key.

- **Optional.** A notes folder is plain or encrypted. Plain folders behave exactly as before.
- **What is encrypted** **(call)**: file contents, attachments, and every file and folder name.
  Still visible to the cloud: the number of files, their sizes, when they change, and the shape of
  the folder tree. Two files with the same name in different folders scramble to the same name.
- **Keys** **(call)**: a random 256-bit master key encrypts everything (AES-256-GCM). It is stored
  only wrapped, once under a key derived from the passcode and once under one derived from the
  recovery key, in `cockpit.vault.json` at the top of the folder (the one unencrypted file; it
  holds no secret). Passcode to key is scrypt (N=2^17, r=8, p=1). The passcode is never stored.
  Keys live in memory only while the folder is unlocked.
- **Passcode**: at least 12 characters **(call)**. Asked at every launch. Can be changed without
  re-encrypting any note. "Lock now" is in settings.
- **Recovery key**: 160 random bits, shown once at setup, stored nowhere.
- **Turning it on for existing notes** **(call)**: the app copies everything into a new, empty
  folder the user picks, verifying each file, and switches to it. The original folder is not
  changed or deleted; the user removes it and empties Drive's trash, because encrypting in place
  would leave readable versions in Drive's history.
- **Safety net**: a copy of `cockpit.vault.json` is kept in the app's own data folder and restored
  if the one in the notes folder disappears. A folder known to be encrypted is never opened as a
  plain folder.
- **Limits**: files are encrypted whole, so a very large video is held in memory to play. Files
  dropped into an encrypted folder by hand are ignored, not encrypted. An attacker who can modify
  the Drive folder can delete, swap, or roll back files, but cannot read or forge them.
