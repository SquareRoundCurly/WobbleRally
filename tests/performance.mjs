import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { startServer } from './server.mjs'
const track = JSON.parse(await readFile('src/track.json', 'utf8'))
const server = await startServer()
const angle = process.env.ANGLE || 'native'
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0', args: ['--no-sandbox',
  ...(angle === 'native' ? [] : [`--use-angle=${angle}`, '--enable-unsafe-swiftshader'])] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = [], samples = []
page.on('pageerror', error => errors.push(error.message))
let result
try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  await page.frameLocator('iframe').getByRole('button', { name: "Let's race" }).click()
  await page.evaluate(() => window.gameHost.step(180))
  const frame = page.frames()[1]
  await frame.evaluate(() => {
    window.frameTimes = []
    window.measureFrames = true
    let previous = null
    const measure = now => {
      if (previous !== null) window.frameTimes.push(now - previous)
      previous = now
      if (window.measureFrames) requestAnimationFrame(measure)
    }
    requestAnimationFrame(measure)
  })
  const started = Date.now()
  await page.evaluate(() => window.gameHost.resume())
  let held = null
  while (Date.now() - started < 15000) {
    const o = await page.evaluate(() => window.gameHost.observe({ entities: [100] }))
    const racer = o.game['1'].racers[0], p = o.scene.entities[0].transform.position
    let nearest = 0, best = Infinity
    track.samples.forEach((q, i) => {
      const d = (q.p[0] - p[0]) ** 2 + (q.p[2] - p[2]) ** 2
      if (d < best) { best = d; nearest = i }
    })
    const q = track.samples[(nearest + 7) % track.samples.length].p
    const angle = Math.atan2(q[0] - p[0], q[2] - p[2]) - racer.heading
    const error = Math.atan2(Math.sin(angle), Math.cos(angle))
    const next = Math.abs(error) < .1 ? null : error > 0 ? 'd' : 'a'
    if (next !== held) {
      if (held) await page.keyboard.up(held)
      if (next) await page.keyboard.down(next)
      held = next
    }
    if (racer.item !== null) await page.keyboard.press('Space')
    samples.push({ wallMs: Date.now() - started, ticks: o.ticks, raceSeconds: o.game['1'].elapsed, p })
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  await page.evaluate(() => window.gameHost.pause())
  const measurement = await frame.evaluate(() => {
    window.measureFrames = false
    const gl = document.querySelector('canvas').getContext('webgl2')
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return { frameTimes: window.frameTimes, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }
  })
  // Discard the first second as warm-up; report the actual rAF distribution.
  let cumulative = 0
  const deltas = measurement.frameTimes.filter(ms => { cumulative += ms; return cumulative > 1000 })
  const sorted = [...deltas].sort((a, b) => a - b)
  result = { browser: browser.version(), angle, viewport: { width: 1280, height: 720 },
    sourceSha: createHash('sha256').update(await readFile('scripts/main.js')).digest('hex'),
    sceneSha: createHash('sha256').update(await readFile('scene/scene.json')).digest('hex'),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(),
    renderer: measurement.renderer, wallSeconds: (Date.now() - started) / 1000,
    meanFps: deltas.length * 1000 / deltas.reduce((a, b) => a + b, 0),
    frameMsP50: sorted[Math.floor(sorted.length * .5)], frameMsP95: sorted[Math.floor(sorted.length * .95)],
    samples, frameTimes: measurement.frameTimes,
    note: 'Unmodified live render cadence. Interpret this measurement with the reported renderer and hardware; browser emulation does not establish physical-phone performance.' }
  await page.screenshot({ path: 'evidence/desktop-racing.png', timeout: 15000 })
  console.log(JSON.stringify({ ...result, samples: undefined, frameTimes: undefined }))
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1 }
finally {
  await writeFile('evidence/performance.json', JSON.stringify({ ...result, errors }, null, 2))
  await browser.close(); server.kill()
}
