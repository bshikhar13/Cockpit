# Cockpit

A personal knowledge management app for one person on one Mac: a daily diary, PARA notes
(Projects, Areas, Resources, Archive), tasks, and habits. Everything is stored as plain markdown
in a folder you choose, so Google Drive can sync it and any markdown editor can read it.

This is stage 1. Calendar and time blocking, local-LLM agents and chat, a web resource vault, and
social post drafting are later stages. See `docs/superpowers/specs/2026-11-11-cockpit-design.md`.

## Run it

```bash
npm install
npm run dev
```

On first launch, choose your notes folder. For Google Drive, pick or create a folder inside
`~/Library/CloudStorage/GoogleDrive-<account>/My Drive/` and set it to **Available offline** in
Drive, so the files are real local files.

## Build the app

```bash
npm run package
```

This produces `dist/mac-arm64/Cockpit.app` (unsigned). Drag it to Applications. The first time,
right-click the app and choose Open.

## Test

```bash
npm test          # unit tests
npm run typecheck
npm run e2e       # builds, then drives the real app on a temporary folder
```

## What is in the notes folder

```
Diary/2026/2026-11-11.md     one file per day; habit ticks live in its frontmatter
Projects/<Name>/<Name>.md    a project's home note (status, deadline, area in frontmatter)
Projects/<Name>/Tasks.md     its tasks
Areas/<Name>/...             same shape, for ongoing areas
Resources/<Topic>/...        reference notes
Archive/...                  archived projects, areas, and topics
Attachments/                 images and video pasted or dropped into notes
Inbox/                       notes and tasks with no home yet
Habits.md                    the list of habits being tracked
```

Tasks are checkbox lines in the Obsidian Tasks format:

```
- [ ] Send pilot deck 📅 2026-11-12 ⏫ 🆔 k3f9a2
- [ ] Review PR queue 🔁 every weekday 📅 2026-11-11 🆔 p8x1c4
```

Only files named `Tasks.md` hold tasks. Notes link to each other with `[[Note name]]`.

## How it behaves

- The day ends at 4 am by default, so late-night writing belongs to the day that is ending.
  Change it with the gear button in the sidebar.
- Opening a note never writes to it. An edit changes only what you typed.
- If a file changes on disk while you have unsaved edits, your version is kept and the other
  version is saved beside it as a conflict copy.
- The search index is kept in memory and rebuilt from the files at every launch.

## Code layout

- `src/core` pure logic for every file format (no Electron, no file access)
- `src/main` the notes folder on disk, the index, the file watcher, and services
- `src/preload` the bridge that exposes `window.cockpit`
- `src/renderer` the React interface and the CodeMirror editor

## Licence

MIT. See [LICENSE](LICENSE).
