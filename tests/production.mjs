// Exercise the actual published PWA as a disposable, non-owner player.
// WOBBLE_LOGIN_FILE points outside the repository to operator-provided logins.
// Credentials remain in memory and are never included in the evidence report.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const login = JSON.parse(await readFile(process.env.WOBBLE_LOGIN_FILE, 'utf8')).player
assert.equal(login.disposable, true)
assert.match(login.uid, /^publication-acceptance-\d+-\d+$/)
const deployment = JSON.parse(await readFile('evidence/deployment.json', 'utf8'))
const manifest = JSON.parse(execFileSync('python3', ['-c',
  "import zipfile; print(zipfile.ZipFile('dist/wobble-rally-0.1.0.zip').read('pocketrealms.package.json').decode())"]).toString())
const checks = [], errors = [], requests = [], verifiedFiles = new Map(), browserFiles = new Set()
const report = { deploymentId: deployment.id, releaseId: deployment.release_id,
  moduleId: deployment.module_id, runtime: manifest.runtime, checks, errors, requests,
  notice: 'Actual public PWA smoke check under software rendering; not a physical-device performance result.' }
const api = async (path, method = 'GET') => {
  const response = await fetch('https://api.pocketrealms.ai' + path, {
    method, headers: { Authorization: 'Bearer ' + login.exchange.idToken },
  })
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`)
  return response.status === 204 ? null : response.json()
}
const state = save => save.snapshot?.scripts.find(script => script.entity === 1)?.state
const waitSave = async predicate => {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const save = (await api(`/api/sessions/${report.session.uuid}/save`)).save
    if (state(save) && predicate(state(save), save)) return save
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error('The live PWA did not persist the expected gameplay checkpoint')
}
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] })
report.browser = browser.version()
const context = await browser.newContext({ viewport: { width: 960, height: 600 }, hasTouch: true })
const page = await context.newPage()
page.setDefaultTimeout(45000)
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  const url = new URL(response.url())
  if (url.origin !== 'https://api.pocketrealms.ai') return
  requests.push({ path: url.pathname, method: response.request().method(), status: response.status() })
  const match = url.pathname.match(/^\/api\/sessions\/[^/]+\/files\/(.+)$/)
  if (match && response.status() === 200) browserFiles.add(decodeURIComponent(match[1]))
})

try {
  const catalog = await api('/api/realms')
  report.realm = catalog.realms.find(realm => realm.release_id === deployment.release_id)
  assert.ok(report.realm, 'The release must be discoverable by a non-owner account')
  assert.equal(report.realm.title, 'Wobble Rally')
  checks.push('Public catalog exposes the exact published release to a separate player')
  console.log('PASS', checks.at(-1))

  await page.goto('https://pocketrealms.ai', { waitUntil: 'domcontentloaded' })
  // Install the authenticated Firebase session using its documented persisted
  // user shape. All application/API authorization still uses the real token.
  const user = { uid: login.uid, displayName: 'Wobble Rally deployment check',
    email: null, emailVerified: false, isAnonymous: false, providerData: [],
    stsTokenManager: { refreshToken: login.exchange.refreshToken,
      accessToken: login.exchange.idToken, expirationTime: login.claims.exp * 1000 },
    apiKey: login.apiKey, appName: '[DEFAULT]' }
  await page.evaluate(async ({ user, key }) => {
    localStorage.setItem(key, JSON.stringify(user))
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('firebaseLocalStorageDb', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' })
      request.onerror = () => reject(new Error('Could not initialize the test player session'))
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('firebaseLocalStorage', 'readwrite')
        tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: user })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(new Error('Could not persist the test player session'))
      }
    })
  }, { user, key: `firebase:authUser:${login.apiKey}:[DEFAULT]` })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByRole('radio', { name: /Wobble Rally/ }).check()
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sessions'
    && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  report.session = (await (await created).json()).session
  assert.equal(report.session.release_id, deployment.release_id)
  assert.equal(report.session.workspace_status, 'none')
  const frame = page.frameLocator('.browser-game-surface iframe')
  await frame.getByRole('button', { name: "Let's race" }).waitFor({ state: 'visible', timeout: 120000 })
  assert.deepEqual([...browserFiles].sort(), manifest.files.map(file => file.path).sort())
  report.browserFiles = [...browserFiles]
  // Chromium can discard response bodies after the PWA streams them. Verify
  // the immutable server bytes independently and retain the browser's actual
  // download responses; the production host also verifies its own checksums.
  for (const expected of manifest.files) {
    const response = await fetch(`https://api.pocketrealms.ai/api/sessions/${report.session.uuid}/files/${expected.path}`,
      { headers: { Authorization: 'Bearer ' + login.exchange.idToken } })
    assert.equal(response.status, 200)
    const body = Buffer.from(await response.arrayBuffer())
    assert.equal(body.length, expected.size)
    assert.equal(createHash('sha256').update(body).digest('hex'), expected.sha256)
    verifiedFiles.set(expected.path, expected.sha256)
  }
  assert.equal(verifiedFiles.size, manifest.files.length)
  report.verifiedFiles = Object.fromEntries(verifiedFiles)
  const initial = await waitSave(() => true)
  report.initial = initial
  checks.push('The production PWA launches all 13 verified payload files without a workspace')
  console.log('PASS', checks.at(-1))

  await frame.getByRole('button', { name: "Let's race" }).click()
  const racing = await waitSave(s => s.race.phase === 'racing' && s.race.elapsed >= 2)
  report.racing = racing
  assert.equal(state(racing).race.racers.length, 4)
  assert.ok(state(racing).bodies.every((body, i) =>
    Math.hypot(...body.position.map((n, k) => n - state(initial).bodies[i].position[k])) > 2))
  await page.keyboard.press('a', { delay: 450 })
  await page.keyboard.press('d', { delay: 450 })
  await page.keyboard.press('Space')
  await page.screenshot({ path: 'evidence/production-desktop.png', timeout: 45000 })
  await frame.getByRole('button', { name: 'Pause race' }).click()
  await page.getByRole('button', { name: 'Pause & save', exact: true }).click()
  const paused = await waitSave(s => s.race.phase === 'paused')
  report.paused = paused
  checks.push('The published game races four native karts and stores its live checkpoint')
  console.log('PASS', checks.at(-1))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.session-list-item').filter({ hasText: 'Wobble Rally' }).click()
  await frame.getByRole('button', { name: 'Back to the race' }).waitFor({ state: 'visible', timeout: 120000 })
  const restored = await waitSave((s, save) => save.revision > paused.revision)
  report.restored = restored
  assert.deepEqual(state(restored).race, state(paused).race)
  assert.deepEqual(state(restored).bodies, state(paused).bodies)
  await frame.getByRole('button', { name: 'Back to the race' }).click()
  report.resumed = await waitSave(s => s.race.elapsed > state(paused).race.elapsed + .2)
  checks.push('Reload restores the saved race and native bodies exactly; explicit resume advances play')
  console.log('PASS', checks.at(-1))

  await page.setViewportSize({ width: 390, height: 844 })
  // The platform retains the desktop sidebar when resized. Use its existing
  // collapse control to give a phone enough game space; retain this required
  // user action in the report instead of hiding the sidebar through test CSS.
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().width < 80)
  report.phoneSetup = '390×844; pressed the platform Collapse sidebar button before playing.'
  const resumePhone = frame.getByRole('button', { name: 'Back to the race' })
  if (await resumePhone.isVisible()) await resumePhone.click()
  for (const name of ['Steer left', 'Steer right', 'Use power-up']) {
    const box = await frame.getByRole('button', { name }).boundingBox()
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844,
      `${name} must remain reachable in the published phone layout`)
  }
  await page.screenshot({ path: 'evidence/production-phone-layout.png', timeout: 45000 })
  checks.push('All three touch controls fit in the live PWA phone layout with its sidebar collapsed')
  assert.deepEqual(errors, [])
  assert.ok(!requests.some(request => /\/(workspace|runtime|chat|ui-state)(\/|$)/.test(request.path)))
  assert.ok(!requests.some(request => request.status >= 400))
  console.log('PASS', checks.at(-1))
} catch (error) {
  errors.push(error.stack)
  console.error(error.message)
  await page.screenshot({ path: 'evidence/production-failure.png', timeout: 15000 }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  if (report.session?.uuid) {
    try {
      await api(`/api/sessions/${report.session.uuid}`, 'DELETE')
      report.testSessionDeleted = true
    } catch (error) { errors.push(error.message); process.exitCode = 1 }
  }
  report.finishedAt = new Date().toISOString()
  await writeFile('evidence/production-browser.json', JSON.stringify(report, null, 2) + '\n')
}
