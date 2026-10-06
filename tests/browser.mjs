import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { startServer } from './server.mjs'

const server = await startServer()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 740, height: 420 }, hasTouch: true })
await page.addInitScript(() => {
  const NativeAudioContext = window.AudioContext
  window.testAudioContexts = []
  window.AudioContext = new Proxy(NativeAudioContext, {
    construct(Target, args) {
      const context = new Target(...args)
      window.testAudioContexts.push(context)
      return context
    },
  })
})
page.setDefaultTimeout(15000)
const checks = [], errors = [], captures = []
page.on('pageerror', error => errors.push(error.message))
const sourceSha = createHash('sha256').update(await readFile('scripts/main.js')).digest('hex')
const observe = () => page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103] }))
const snapshot = () => page.evaluate(() => window.gameHost.snapshot())
const step = n => page.evaluate(count => window.gameHost.step(count), n)
const gameState = saved => saved.scripts.find(script => script.entity === 1).state
const check = (name, details = {}) => { checks.push({ name, ...details }); console.log('PASS', name) }
const touch = async (cdp, type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 8, radiusY: 8, force: 1 })) })
const center = async locator => { const r = await locator.boundingBox(); assert.ok(r); return [r.x + r.width / 2, r.y + r.height / 2] }

try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  let frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: "Let's race" }).click()
  assert.equal(await page.frames()[1].evaluate(() => window.testAudioContexts[0]?.state), 'running')
  await step(240)
  let initial = await observe()
  assert.equal(initial.game['1'].phase, 'racing')
  assert.ok(initial.scene.entities.every(body => body.physics.tick === 240))
  assert.ok(initial.scene.entities.some(body => body.physics.contacts.length))
  check('Native Box3D bodies advance and contact the course', { observation: initial })

  await page.keyboard.down('a'); await step(6)
  assert.equal((await observe()).game['1'].controls.steer, -1)
  await page.keyboard.down('d'); await step(6)
  assert.equal((await observe()).game['1'].controls.steer, 0)
  await page.keyboard.up('a'); await step(6)
  assert.equal((await observe()).game['1'].controls.steer, 1)
  await page.keyboard.up('d')
  check('Real A/D key holds, opposing inputs, and key releases')

  await frame.getByRole('button', { name: 'Pause race' }).click()
  const paused = await snapshot()
  await step(180)
  const frozen = await snapshot()
  assert.deepEqual(gameState(frozen), gameState(paused))
  check('Pause freezes canonical race and native body motion for 180 ticks')
  await frame.getByRole('button', { name: 'Back to the race' }).click()
  await step(30)
  assert.ok(gameState(await snapshot()).race.elapsed > gameState(paused).race.elapsed)
  check('Resume restores motion')

  // Save through the public host, then load into a completely fresh iframe.
  await frame.getByRole('button', { name: 'Pause race' }).click()
  const saved = await snapshot()
  await page.evaluate(save => window.mountTestGame(save), saved)
  frame = page.frameLocator('iframe')
  const restored = await snapshot()
  assert.deepEqual(gameState(restored), gameState(saved))
  await step(60)
  assert.deepEqual(gameState(await snapshot()), gameState(saved))
  check('Paused save round-trips exactly through a fresh sandbox and remains paused')
  await frame.getByRole('button', { name: 'Back to the race' }).click()
  assert.equal(await page.frames()[1].evaluate(() => window.testAudioContexts[0]?.state), 'running')
  check('A trusted resume gesture restarts audio after loading a saved race')
  await step(60)
  const activeSave = await snapshot()
  await page.evaluate(save => window.mountTestGame(save), activeSave)
  const activeRestored = gameState(await snapshot()), originalActive = gameState(activeSave)
  assert.equal(activeRestored.race.phase, 'paused')
  assert.equal(activeRestored.race.resumePhase, 'racing')
  assert.equal(activeRestored.race.elapsed, originalActive.race.elapsed)
  assert.equal(activeRestored.race.random, originalActive.race.random)
  assert.deepEqual(activeRestored.race.racers, originalActive.race.racers)
  assert.deepEqual(activeRestored.bodies.map(body => body.position), originalActive.bodies.map(body => body.position))
  check('Active saves restore all racers and RNG, and require deliberate resume')

  // Explicitly constructed saved-state fixture: isolate input/item composition.
  // Full-race evidence is generated separately without state edits.
  const fixture = structuredClone(activeSave), setup = gameState(fixture)
  setup.race.racers[0].item = 0
  setup.race.racers.forEach((racer, i) => { if (i) { racer.item = null; racer.aiUseAt = 999 } })
  await page.evaluate(save => window.mountTestGame(save), fixture)
  frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: 'Back to the race' }).click()
  const cdp = await page.context().newCDPSession(page)
  const left = await center(frame.getByRole('button', { name: 'Steer left' }))
  const right = await center(frame.getByRole('button', { name: 'Steer right' }))
  const use = await center(frame.getByRole('button', { name: 'Use power-up' }))
  await page.frames()[1].evaluate(() => {
    window.pointerTrace = []
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
      window.addEventListener(type, event => window.pointerTrace.push({ type, id: event.pointerId, target: event.target.id || event.target.dataset?.steer, trusted: event.isTrusted }), true)
    }
  })
  await touch(cdp, 'touchStart', [[1, ...left]])
  await touch(cdp, 'touchStart', [[1, ...left], [2, ...use]])
  await step(6)
  const combined = await observe()
  captures.push({ combined, left, right, use, pointerTrace: await page.frames()[1].evaluate(() => window.pointerTrace) })
  assert.equal(combined.game['1'].controls.steer, -1)
  assert.equal(combined.game['1'].racers[0].item, null)
  assert.ok(combined.game['1'].racers[0].boostUntil > combined.game['1'].elapsed)
  await touch(cdp, 'touchMove', [[1, 370, 170], [2, ...use]])
  await step(6)
  assert.equal((await observe()).game['1'].controls.steer, -1)
  await touch(cdp, 'touchEnd', [])
  await step(6)
  assert.equal((await observe()).game['1'].controls.steer, 0)
  check('Real multi-touch steering plus use, drag outside, and release', { observation: combined })
  await touch(cdp, 'touchStart', [[1, ...right]])
  await step(6)
  assert.equal((await observe()).game['1'].controls.steer, 1)
  await touch(cdp, 'touchCancel', [])
  await step(6)
  assert.equal((await observe()).game['1'].controls.steer, 0)
  check('Real pointer cancellation clears steering')

  await page.keyboard.down('d'); await step(6)
  // Focus the outer document: this produces an actual iframe window blur.
  await page.evaluate(() => { document.body.tabIndex = 0; document.body.focus() })
  await step(30)
  assert.equal((await observe()).game['1'].phase, 'paused')
  assert.equal((await observe()).game['1'].controls.steer, 0)
  await page.keyboard.up('d')
  check('Losing browser control focus pauses and releases held input')
  await frame.getByRole('button', { name: 'Back to the race' }).click()
  await step(12)
  assert.equal((await observe()).game['1'].phase, 'racing')

  await page.screenshot({ path: 'evidence/shared-inputs/touch-landscape.png', timeout: 15000 })
  captures.push('touch-landscape.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await step(1)
  for (const name of ['Steer left', 'Steer right', 'Use power-up']) {
    const box = await frame.getByRole('button', { name }).boundingBox()
    assert.ok(box && box.width >= 64 && box.height >= 60 && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844)
  }
  await page.screenshot({ path: 'evidence/shared-inputs/touch-portrait.png', timeout: 15000 })
  captures.push('touch-portrait.png')
  assert.equal(await frame.locator('#r-controls button').count(), 3)
  check('Exactly three reachable driving buttons after landscape-to-portrait resize')
  errors.push(...await page.evaluate(() => window.hostErrors))
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(error.stack)
  process.exitCode = 1
  console.error(error)
} finally {
  await writeFile('evidence/shared-inputs/browser-mechanics.json', JSON.stringify({ sourceSha, browser: browser.version(), checks, errors, captures }, null, 2))
  await browser.close(); server.kill()
}
