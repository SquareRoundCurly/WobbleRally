// Validate the on-device measurement harness against a separate rAF observer.
// This software-browser result does not establish physical-phone performance.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { startServer } from './server.mjs'
const server = await startServer()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 740, height: 420 }, hasTouch: true })
const track = JSON.parse(await readFile('src/track.json', 'utf8'))
const sourceSha = createHash('sha256').update(await readFile('scripts/main.js')).digest('hex')
const errors = [], checks = [], samples = []
let result, independent, downloadRecord
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:4194/?benchmark=desktop&controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  await page.locator('#benchmark-device').fill('Linux SwiftShader container — benchmark harness validation')
  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: "Let's race" }).click()
  await page.evaluate(() => window.gameHost.step(330))
  // The public host can be paused while the game's phase still says racing.
  // The device probe must reject that frozen-clock state instead of showing a
  // misleading high FPS from an idle canvas.
  await page.waitForFunction(() => document.querySelector('#benchmark-status').textContent.includes('stopped advancing'))
  assert.equal(await page.evaluate(() => window.deviceBenchmarkResult), undefined)
  checks.push('A frozen host clock cannot complete a live measurement')
  const gameFrame = page.frames()[1]
  await gameFrame.evaluate(() => {
    window.independentFrames = []; window.observeBenchmarkFrames = true
    const observe = now => {
      window.independentFrames.push(now)
      if (window.observeBenchmarkFrames) requestAnimationFrame(observe)
    }
    requestAnimationFrame(observe)
  })
  await page.evaluate(() => window.gameHost.resume())
  await page.waitForFunction(() => document.querySelector('#device-benchmark').dataset.running === 'true')
  const panel = await page.locator('#device-benchmark').boundingBox()
  for (const selector of ['#r-stats', '.r-time', '[aria-label="Steer left"]', '[aria-label="Steer right"]', '#r-use']) {
    const box = await frame.locator(selector).boundingBox()
    assert.ok(panel.x + panel.width <= box.x || box.x + box.width <= panel.x
      || panel.y + panel.height <= box.y || box.y + box.height <= panel.y,
      'The active benchmark panel must leave race HUD and driving controls clear')
  }
  let held = null
  const deadline = Date.now() + 75000
  while (Date.now() < deadline) {
    result = await page.evaluate(() => window.deviceBenchmarkResult)
    if (result) break
    const o = await page.evaluate(() => window.gameHost.observe({ entities: [100] }))
    const racer = o.game['1'].racers[0], p = o.scene.entities[0].transform.position
    let nearest = 0, best = Infinity
    track.samples.forEach((q, i) => {
      const distance = (q.p[0] - p[0]) ** 2 + (q.p[2] - p[2]) ** 2
      if (distance < best) { nearest = i; best = distance }
    })
    const q = track.samples[(nearest + 7) % track.samples.length].p
    const delta = Math.atan2(q[0] - p[0], q[2] - p[2]) - racer.heading
    const error = Math.atan2(Math.sin(delta), Math.cos(delta))
    const next = Math.abs(error) < .1 ? null : error > 0 ? 'd' : 'a'
    if (held !== next) {
      if (held) await page.keyboard.up(held)
      if (next) await page.keyboard.down(next)
      held = next
    }
    if (racer.item !== null) await page.keyboard.press('Space')
    samples.push({ hostTicks: o.ticks, elapsed: o.game['1'].elapsed, p })
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(result, 'Thirty continuous seconds of live racing must produce a result')
  if (held) await page.keyboard.up(held)
  await page.evaluate(() => window.gameHost.pause())
  independent = await gameFrame.evaluate(() => { window.observeBenchmarkFrames = false; return window.independentFrames })
  assert.equal(result.build.files['scripts/main.js'], sourceSha)
  assert.equal(Object.keys(result.build.files).length, 13)
  assert.equal(result.build.probeSha256, createHash('sha256').update(await readFile('tests/device-benchmark.mjs')).digest('hex'))
  assert.equal(result.deviceClass, 'desktop')
  assert.equal(result.targetFps, 60)
  assert.ok(result.durationMs >= 30000 && result.durationMs < 40000)
  assert.equal(result.frames, result.frameMs.length)
  assert.ok(Math.abs(result.frameMs.reduce((sum, ms) => sum + ms, 0) - result.durationMs) < .001)
  assert.ok(result.softwareRenderer)
  assert.ok(result.endState.elapsed > result.startState.elapsed)
  assert.ok(result.endState.racers.some((r, i) => Math.hypot(...r.position.map((n, k) => n - result.startState.racers[i].position[k])) > 2))
  // Every measured delta must match the same continuous sequence from a second,
  // separately installed observer in the browser's actual animation clock.
  const deltas = independent.slice(1).map((t, i) => t - independent[i])
  const match = deltas.findIndex((value, start) => Math.abs(value - result.frameMs[0]) < .001
    && result.frameMs.every((value, i) => Math.abs(value - deltas[start + i]) < .001))
  assert.ok(match >= 0, 'Reported intervals must match independent browser animation timestamps')
  checks.push('Raw frame intervals match an independent browser observer while native karts move')
  const downloadEvent = page.waitForEvent('download')
  await page.locator('#benchmark-download').click()
  const download = await downloadEvent
  await download.saveAs('evidence/device-benchmark-software.json')
  downloadRecord = JSON.parse(await readFile('evidence/device-benchmark-software.json', 'utf8'))
  assert.equal(downloadRecord.deviceLabel, 'Linux SwiftShader container — benchmark harness validation')
  assert.equal(downloadRecord.meanFps, result.meanFps)
  checks.push('The named-device JSON download preserves build hashes, renderer, samples and results')
  await page.screenshot({ path: 'evidence/device-benchmark-desktop.png' })
  await page.goto('http://127.0.0.1:4194/?benchmark=phone&controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  assert.ok(await page.getByText('Phone · 30 FPS target').isVisible())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.frameLocator('iframe').getByRole('button', { name: "Let's race" }).click()
  await page.evaluate(() => window.gameHost.step(240))
  for (const name of ['Steer left', 'Steer right', 'Use power-up']) {
    const box = await page.frameLocator('iframe').getByRole('button', { name }).boundingBox()
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844)
  }
  await page.screenshot({ path: 'evidence/device-benchmark-phone-layout.png' })
  checks.push('The phone benchmark names the 30 FPS target and leaves all three driving controls reachable')
  errors.push(...await page.evaluate(() => window.hostErrors))
  assert.deepEqual(errors, [])
  console.log('PASS', checks.join('\nPASS '))
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1 }
finally {
  await writeFile('evidence/device-benchmark-harness.json', JSON.stringify({ sourceSha, browser: browser.version(),
    notice: 'Software-only harness validation; no physical-phone or GPU-desktop measurement.', checks, result, independent, samples, errors }, null, 2))
  await browser.close(); server.kill()
}
