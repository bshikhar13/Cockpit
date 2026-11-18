import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { logicalDate } from '../src/core/day'
import { diaryPath } from '../src/core/diary'

const today = logicalDate(new Date(), 4)

async function launch(vault: string, userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, COCKPIT_VAULT: vault, COCKPIT_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** the file's text, or '' while it does not exist yet */
const read = (vault: string, rel: string): string => (existsSync(join(vault, rel)) ? readFileSync(join(vault, rel), 'utf8') : '')

test('a full day in Cockpit, straight to plain files', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'cockpit-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  let { app, page } = await launch(vault, userData)

  // 1. Today opens on a blank page; no diary file exists until something is written
  await expect(page.getByTestId('today-heading')).toBeVisible()
  await expect(page.locator('.cm-content')).toBeVisible()
  expect(existsSync(join(vault, diaryPath(today)))).toBe(false)

  // 2. typing reaches the file
  await page.locator('.cm-content').click()
  await page.keyboard.type('Hello diary')
  await expect.poll(() => read(vault, diaryPath(today)), { timeout: 5000 }).toContain('Hello diary')

  // 3. a task added in the rail is a plain task line
  await page.getByTestId('task-add').fill('Smoke task')
  await page.keyboard.press('Enter')
  await expect.poll(() => read(vault, 'Inbox/Tasks.md')).toContain(`- [ ] Smoke task 📅 ${today}`)

  // 4. ticking it completes it; it stays on today's list, struck through
  await page.getByLabel('Complete Smoke task').click()
  await expect.poll(() => read(vault, 'Inbox/Tasks.md')).toContain('- [x] Smoke task')
  expect(read(vault, 'Inbox/Tasks.md')).toContain(`✅ ${today}`)
  await expect(page.locator('.task-row.done')).toHaveCount(1)
  await expect(page.getByTestId('gauge-due')).toHaveText('00')

  // 5. a habit ticked on Today lands in the diary frontmatter, and the words are untouched
  await page.getByTestId('nav-habits').click()
  await page.getByTestId('habit-add').fill('Run')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('habit-item')).toHaveCount(1)
  await page.getByTestId('nav-today').click()
  await page.getByTestId('habit-tick').locator('input').click()
  await expect.poll(() => read(vault, diaryPath(today))).toContain('Run: true')
  expect(read(vault, diaryPath(today))).toContain('Hello diary')
  expect(existsSync(join(vault, 'Diary', today.slice(0, 4)))).toBe(true)

  // 6. a file written outside the app shows up (the watcher)
  mkdirSync(join(vault, 'Projects/Ext'), { recursive: true })
  writeFileSync(join(vault, 'Projects/Ext/Ext.md'), '---\nstatus: active\n---\nWritten by another editor.\n')
  await expect(page.getByTestId('tree-Projects/Ext')).toBeVisible({ timeout: 5000 })

  // 7. Cmd+K finds and opens it
  await page.keyboard.press('Meta+k')
  await page.getByTestId('palette').locator('input').fill('Ext')
  await expect(page.locator('.palette-item').first()).toContainText('Ext')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-title')).toHaveText('Ext')

  // attachments are served with range support, so video can seek
  writeFileSync(join(vault, 'Attachments/clip.bin'), Buffer.from('0123456789'))
  const ranged = await page.evaluate(async () => {
    const r = await fetch('cockpit-file://vault/Attachments/clip.bin', { headers: { Range: 'bytes=2-5' } })
    return { status: r.status, range: r.headers.get('content-range'), body: await r.text() }
  })
  expect(ranged).toEqual({ status: 206, range: 'bytes 2-5/10', body: '2345' })
  const outside = await page.evaluate(async () => (await fetch('cockpit-file://vault/..%2F..%2Fetc%2Fpasswd')).status)
  expect(outside).toBe(404)

  // 8. everything is still there after a restart
  await app.close()
  ;({ app, page } = await launch(vault, userData))
  await expect(page.locator('.cm-content')).toContainText('Hello diary')
  await expect(page.getByTestId('habit-tick').locator('input')).toBeChecked()
  await app.close()

  // no conflict copies were produced along the way
  expect(read(vault, diaryPath(today))).toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\nhabits:\n {2}Run: true\n---\n\nHello diary$/)
  const diaryDir = join(vault, 'Diary', today.slice(0, 4))
  expect(require('fs').readdirSync(diaryDir)).toEqual([`${today}.md`])
})

test('a missing notes folder shows the picker and creates nothing', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  const missing = join(mkdtempSync(join(tmpdir(), 'cockpit-e2e-gone-')), 'not-here')
  const { app, page } = await launch(missing, userData)
  await expect(page.getByTestId('vault-picker')).toContainText("can't find your notes folder")
  await expect(page.getByTestId('vault-picker')).toContainText('not-here')
  expect(existsSync(missing)).toBe(false)
  await app.close()
})

test('words typed just before quitting are saved', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'cockpit-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  const { app, page } = await launch(vault, userData)
  await expect(page.getByTestId('today-heading')).toBeVisible()
  await page.locator('.cm-content').click()
  await page.keyboard.type('Last words before quitting')
  await app.evaluate(({ app: electronApp }) => electronApp.quit()) // no pause: inside the autosave delay
  await app.waitForEvent('close')
  expect(read(vault, diaryPath(today))).toContain('Last words before quitting')
})

test('the window cannot be navigated away from the app', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'cockpit-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  const { app, page } = await launch(vault, userData)
  await expect(page.getByTestId('today-heading')).toBeVisible()
  writeFileSync(join(vault, 'dropped.html'), '<h1 id="gone">not the app</h1>')
  // checked through the main process: a cancelled navigation leaves Playwright's own page tracking waiting
  const inWindow = (js: string): Promise<unknown> =>
    app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code), js)
  await inWindow(`void (window.location.href = ${JSON.stringify('file://' + join(vault, 'dropped.html'))})`)
  await new Promise((r) => setTimeout(r, 800))
  const url = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL())
  expect(url).not.toContain('dropped.html')
  expect(await inWindow(`!!document.querySelector('[data-testid=today-heading]')`)).toBe(true)
  // a file dropped outside the editor is ignored rather than opened
  const prevented = await inWindow(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'x.html', { type: 'text/html' }))
    const e = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
    document.querySelector('[data-testid=rail]').dispatchEvent(e)
    return e.defaultPrevented
  })()`)
  expect(prevented).toBe(true)
  await app.close()
})

test('clicking a table cell puts the cursor in that cell, and typing stays there', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'cockpit-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  mkdirSync(join(vault, 'Inbox'), { recursive: true })
  writeFileSync(
    join(vault, 'Inbox/Prices.md'),
    'Intro line\n\n| Plan  | Price | Notes |\n| ----- | ----- | ----- |\n| Basic | 10    |       |\n| Pro   | 30    | last  |\n\nOutro line\n'
  )
  const { app, page } = await launch(vault, userData)
  await page.getByText('Prices', { exact: true }).click()
  const cell = (r: number, c: number) => page.locator(`.cm-table-widget [data-row="${r}"][data-col="${c}"]`)
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      return a?.dataset.row !== undefined ? `${a.dataset.row},${a.dataset.col}` : 'outside the table'
    })
  await expect(cell(1, 0)).toBeVisible()

  // from the text into an empty cell, then cell to cell, including the header and a filled cell
  await page.locator('.cm-line', { hasText: 'Outro line' }).click()
  await cell(1, 2).click()
  expect(await focused()).toBe('1,2')
  await page.keyboard.type('cheap')
  await cell(0, 1).click()
  expect(await focused()).toBe('0,1')
  await page.keyboard.press('Meta+ArrowRight') // the cursor is where the click landed; go to the end of the cell
  await page.keyboard.type('!')
  await cell(2, 0).click()
  expect(await focused()).toBe('2,0')
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type('+')
  await cell(2, 2).click()
  expect(await focused()).toBe('2,2')
  await page.locator('.cm-line', { hasText: 'Outro line' }).click()

  await expect
    .poll(() => read(vault, 'Inbox/Prices.md'))
    .toBe('Intro line\n\n| Plan  | Price! | Notes |\n| ----- | ------ | ----- |\n| Basic | 10     | cheap |\n| Pro+  | 30     | last  |\n\nOutro line\n')
  await expect(page.locator('.cm-table-widget table')).toHaveCount(1)
  await app.close()
})

test('encrypting notes: nothing readable on disk, passcode at every launch, recovery key works', async () => {
  const { readdirSync, readFileSync: readRaw, statSync } = require('fs') as typeof import('fs')
  const plain = mkdtempSync(join(tmpdir(), 'cockpit-e2e-plain-'))
  const encrypted = mkdtempSync(join(tmpdir(), 'cockpit-e2e-enc-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  const passcode = 'correct horse battery staple' // a test value, made up for this run
  mkdirSync(join(plain, 'Projects/Zebracorn launch'), { recursive: true })
  mkdirSync(join(plain, 'Attachments'), { recursive: true })
  writeFileSync(join(plain, 'Projects/Zebracorn launch/Zebracorn launch.md'), '---\nstatus: active\n---\nAsk Robin about tiering.\n')
  writeFileSync(join(plain, 'Attachments/pic.bin'), Buffer.from('0123456789'))
  const everything = (dir: string): string =>
    readdirSync(dir)
      .map((name) => {
        const p = join(dir, name)
        return `\n${name}\n` + (statSync(p).isDirectory() ? everything(p) : readRaw(p).toString('latin1'))
      })
      .join('')

  // --- turn encryption on, from a plain folder
  let app = await electron.launch({
    args: ['.'],
    env: { ...process.env, COCKPIT_VAULT: plain, COCKPIT_USER_DATA: userData, COCKPIT_PICK_FOLDER: encrypted }
  })
  let page = await app.firstWindow()
  await expect(page.getByTestId('today-heading')).toBeVisible()
  await page.locator('.cm-content').click()
  await page.keyboard.type('Dear diary, a private thought.')
  await page.getByTestId('settings').click()
  await page.getByTestId('encrypt-notes').click()
  await page.getByTestId('encrypt-passcode').fill('too short')
  await page.getByTestId('encrypt-confirm').fill('too short')
  await page.getByTestId('encrypt-understood').check()
  await expect(page.getByTestId('encrypt-submit')).toBeDisabled()
  await page.getByTestId('encrypt-passcode').fill(passcode)
  await page.getByTestId('encrypt-confirm').fill(passcode)
  await page.getByTestId('encrypt-submit').click()
  const recoveryKey = (await page.getByTestId('recovery-key').textContent({ timeout: 20_000 }))!
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await expect(page.getByTestId('recovery-done')).toBeDisabled()
  await page.getByTestId('recovery-saved').check()
  await page.getByTestId('recovery-done').click()

  // the app carries on, now in the encrypted folder, with everything there
  await expect(page.locator('.cm-content')).toContainText('Dear diary, a private thought.')
  await expect(page.getByTestId('tree-Projects/Zebracorn launch')).toBeVisible()
  await page.locator('.cm-content').click()
  await page.keyboard.type(' Written after encrypting.')
  const served = await page.evaluate(async () => {
    const r = await fetch('cockpit-file://vault/Attachments/pic.bin', { headers: { Range: 'bytes=2-5' } })
    return { status: r.status, body: await r.text() }
  })
  expect(served).toEqual({ status: 206, body: '2345' })
  await app.close()

  // --- on disk: only scrambled files and the settings file; the original folder is untouched
  const disk = everything(encrypted)
  for (const secret of ['diary', 'private', 'Zebracorn', 'Robin', 'tiering', 'Projects', 'Diary', 'Inbox', 'Tasks', '0123456789', 'encrypting', passcode, recoveryKey]) {
    expect(disk.includes(secret), `"${secret}" is readable in the encrypted folder`).toBe(false)
  }
  expect(readdirSync(encrypted)).toContain('cockpit.vault.json')
  expect(read(plain, 'Projects/Zebracorn launch/Zebracorn launch.md')).toContain('Ask Robin about tiering.')

  // --- every launch asks for the passcode
  ;({ app, page } = await launch(encrypted, userData))
  await expect(page.getByTestId('unlock-screen')).toBeVisible()
  await expect(page.getByTestId('today-heading')).toHaveCount(0)
  await page.getByTestId('unlock-input').fill('not the right passcode')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('unlock-error')).toHaveText('Wrong passcode')
  await page.getByTestId('unlock-input').fill(passcode)
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toContainText('Dear diary, a private thought. Written after encrypting.')

  // --- lock now, then get back in with the recovery key typed sloppily
  await page.getByTestId('settings').click()
  await expect(page.getByTestId('encrypted-status')).toBeVisible()
  await page.getByTestId('lock-now').click()
  await expect(page.getByTestId('unlock-screen')).toBeVisible()
  await page.getByTestId('unlock-input').fill(recoveryKey.toLowerCase().replace(/-/g, ' '))
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toContainText('Written after encrypting.')
  await app.close()
})

test('creating an encrypted folder on first run shows the recovery key and waits for it to be saved', async () => {
  const encrypted = mkdtempSync(join(tmpdir(), 'cockpit-e2e-enc-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  const env = { ...process.env, COCKPIT_USER_DATA: userData, COCKPIT_PICK_FOLDER: encrypted } as Record<string, string>
  delete env.COCKPIT_VAULT
  const app = await electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  await page.getByTestId('picker-encrypted').click()
  await page.getByTestId('encrypt-passcode').fill('correct horse battery staple')
  await page.getByTestId('encrypt-confirm').fill('correct horse battery staple')
  await page.getByTestId('encrypt-understood').check()
  await page.getByTestId('encrypt-submit').click()
  await expect(page.getByTestId('recovery-key')).toHaveText(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/, { timeout: 20_000 })
  await page.waitForTimeout(1500) // the app has opened the new folder by now; the key must still be on screen
  await expect(page.getByTestId('recovery-key')).toBeVisible()
  await page.getByTestId('recovery-saved').check()
  await page.getByTestId('recovery-done').click()
  await expect(page.getByTestId('today-heading')).toBeVisible()
  await page.getByTestId('settings').click()
  await expect(page.getByTestId('encrypted-status')).toBeVisible()
  await app.close()
})

test('a task added to Inbox shows in the sidebar Inbox section and opens from there', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'cockpit-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  const { app, page } = await launch(vault, userData)
  await expect(page.getByTestId('today-heading')).toBeVisible()
  await expect(page.getByTestId('inbox-tasks')).toHaveCount(0)
  await page.getByTestId('task-add').fill('Call the accountant')
  await page.keyboard.press('Enter')
  await page.getByTestId('task-add').fill('Undated thought')
  await page.keyboard.press('Enter')
  const row = page.getByTestId('inbox-tasks')
  await expect(row).toContainText('2')
  await row.click()
  await expect(page.getByTestId('tab-inbox')).toHaveClass(/active/)
  await expect(page.getByTestId('task-row')).toHaveCount(2)
  await expect(page.getByTestId('task-row').first()).toContainText('Call the accountant')
  await app.close()
})

test('the rail shows the tasks of the day in view, and looking at days leaves no files behind', async () => {
  const { addDays } = await import('../src/core/day')
  const vault = mkdtempSync(join(tmpdir(), 'cockpit-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  const later = addDays(today, 6)
  mkdirSync(join(vault, 'Projects/Trip'), { recursive: true })
  writeFileSync(join(vault, 'Projects/Trip/Trip.md'), '---\nstatus: active\n---\n')
  writeFileSync(join(vault, 'Projects/Trip/Tasks.md'), `- [ ] Book the flights 📅 ${later} ⏫ 🆔 trip01\n- [ ] Due now 📅 ${today} 🆔 nownow\n`)
  const { app, page } = await launch(vault, userData)
  const rows = page.getByTestId('task-row')

  // today: only what is due today
  await expect(page.getByTestId('rail-tasks-heading')).toHaveText("Today's tasks")
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Due now')

  // six days on: that day's task, not today's
  await page.locator('.page-header input[type=date]').fill(later)
  await expect(page.getByTestId('rail-tasks-heading')).toContainText('Tasks ·')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Book the flights')
  await expect(page.getByTestId(`tape-due-${later}`)).toHaveText('1')
  await expect(page.getByTestId('gauge-due')).toHaveText('01')

  // a task added while looking at that day is dated that day
  await page.getByTestId('task-add').fill('Book the hotel')
  await page.keyboard.press('Enter')
  await expect(rows).toHaveCount(2)
  await expect.poll(() => read(vault, 'Inbox/Tasks.md')).toContain(`- [ ] Book the hotel 📅 ${later}`)

  // finishing it keeps it listed for the day it was finished (today), struck through
  await page.getByLabel('Complete Book the flights').click()
  await expect(rows).toHaveCount(1)
  await page.locator('.page-header button', { hasText: 'Today' }).click()
  await expect(rows).toHaveCount(2)
  await expect(page.locator('.task-row.done')).toContainText('Book the flights')

  // a day in between has nothing
  await page.locator('.page-header input[type=date]').fill(addDays(today, 3))
  await expect(rows).toHaveCount(0)

  await app.close()
  expect(existsSync(join(vault, 'Diary', today.slice(0, 4)))).toBe(false) // browsing three days created no diary files
})

test('projects: three statuses, days left, active ones in bold; shortcuts; focus mode', async () => {
  const { addDays } = await import('../src/core/day')
  const vault = mkdtempSync(join(tmpdir(), 'cockpit-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-data-'))
  for (const [name, status] of [['Trip', 'active'], ['New bike', 'to-pick-up'], ['Old site', 'done']]) {
    mkdirSync(join(vault, 'Projects', name), { recursive: true })
    writeFileSync(join(vault, 'Projects', name, `${name}.md`), `---\nstatus: ${status}\ndeadline: ${addDays(today, 12)}\n---\nNotes.\n`)
  }
  const { app, page } = await launch(vault, userData)
  const weight = (rel: string) =>
    page.getByTestId(`tree-${rel}`).locator('.tree-name').evaluate((el) => Number(getComputedStyle(el).fontWeight))
  expect(await weight('Projects/Trip')).toBeGreaterThanOrEqual(600)
  expect(await weight('Projects/New bike')).toBeLessThan(600)
  expect(await weight('Projects/Old site')).toBeLessThan(600)

  // the project page counts down to the deadline
  await page.getByTestId('tree-Projects/Trip').click()
  await expect(page.getByTestId('days-left')).toHaveText('12 days left')
  // the new status can be chosen and is written to the file; a parked project is no longer bold
  await page.getByTestId('project-status').selectOption('to-pick-up')
  await expect.poll(() => read(vault, 'Projects/Trip/Trip.md')).toContain('status: to-pick-up')
  await expect.poll(() => weight('Projects/Trip')).toBeLessThan(600)
  // done projects show no countdown
  await page.getByTestId('tree-Projects/Old site').click()
  await expect(page.getByTestId('days-left')).toHaveCount(0)

  // Cmd+2, Cmd+3, Cmd+1
  await page.keyboard.press('Meta+2')
  await expect(page.getByTestId('tab-today')).toBeVisible()
  await page.keyboard.press('Meta+3')
  await expect(page.getByTestId('habit-add')).toBeVisible()
  await page.keyboard.press('Meta+1')
  await expect(page.getByTestId('today-heading')).toBeVisible()

  // focus: everything but the page goes; writing still saves; Escape brings it all back
  await page.getByTestId('focus-button').click()
  await expect(page.getByTestId('app')).toHaveClass(/focus-mode/)
  for (const gone of ['.sidebar', '.page-header', '.tape', '.rail']) await expect(page.locator(gone)).toBeHidden()
  await page.locator('.cm-content').click()
  await page.keyboard.type('Written in focus.')
  await expect.poll(() => read(vault, diaryPath(today))).toContain('Written in focus.')
  await page.keyboard.press('Escape')
  await expect(page.locator('.sidebar')).toBeVisible()
  // the keyboard way in, and a shortcut to another screen also leaves it
  await page.keyboard.press('Meta+Shift+f')
  await expect(page.locator('.sidebar')).toBeHidden()
  await page.keyboard.press('Meta+2')
  await expect(page.locator('.sidebar')).toBeVisible()
  await app.close()
})
