// Independent driver: reads native position and course geometry, sends real keys.
// It never edits game state, teleports a kart or injects a finishing condition.
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { startServer } from './server.mjs'
import { setRenderCadence, presentFrame } from './render-cadence.mjs'
const server = await startServer()
const track = JSON.parse(await readFile('src/track.json', 'utf8'))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
// Small render surface for long physics runs on the software-only test host.
// Separate full-size captures establish visual quality.
const page = await browser.newPage({ viewport: { width: 480, height: 300 } })
const sourceSha = createHash('sha256').update(await readFile('scripts/main.js')).digest('hex')
const sceneSha = createHash('sha256').update(await readFile('scene/scene.json')).digest('hex')
const errors = [], trace = [], samples = [], nativePath = []
const rememberBodies = (observation, tick) => nativePath.push({ tick,
  p: observation.scene.entities.find(e => e.id === 100).transform.position,
  positions: [100, 101, 102, 103].map(id => observation.scene.entities.find(e => e.id === id).transform.position) })
page.on('pageerror', error => errors.push(error.message))
const start = Date.now()
try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  if (process.env.SPARSE_RENDER) await setRenderCadence(page)
  await page.frameLocator('iframe').locator('canvas').focus()
  await page.keyboard.press('Space')
  await page.evaluate(() => window.gameHost.step(180))
  let held = null, state, ticks = 180, passing = null
  for (let i = 0; i < 2000; i++) {
    const observation = await page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103, ...Array.from({ length: 12 }, (_, i) => 300 + i)] }))
    state = observation.game['1']
    if (state.phase === 'finished') break
    const racer = state.racers[0]
    const p = observation.scene.entities.find(entity => entity.id === 100).transform.position
    rememberBodies(observation, ticks)
    let nearest = 0, distance = Infinity
    track.samples.forEach((q, index) => {
      const d = (q.p[0] - p[0]) ** 2 + (q.p[2] - p[2]) ** 2
      if (d < distance) { distance = d; nearest = index }
    })
    let target = track.samples[(nearest + 7) % track.samples.length].p
    const center = track.samples[nearest], normal = [Math.cos(center.yaw), -Math.sin(center.yaw)]
    const lane = (p[0] - center.p[0]) * normal[0] + (p[2] - center.p[2]) * normal[1]
    const rivals = observation.scene.entities.filter(e => e.id >= 101 && e.id <= 103).map(entity => {
      const q = entity.transform.position, dx = q[0] - p[0], dz = q[2] - p[2]
      return { ahead: dx * Math.sin(racer.heading) + dz * Math.cos(racer.heading),
        lane: (q[0] - center.p[0]) * normal[0] + (q[2] - center.p[2]) * normal[1] }
    })
    if ((!passing || passing.until < ticks) && rivals.some(r => r.ahead > 0 && r.ahead < 9 && Math.abs(r.lane - lane) < 2)) {
      const choices = [-3.3, 3.3].map(candidate => ({ lane: candidate, cost: Math.abs(candidate - lane) * .2
        + rivals.filter(r => r.ahead > -4 && r.ahead < 13).reduce((sum, r) => sum + Math.max(0, 3 - Math.abs(r.lane - candidate)), 0) }))
      choices.sort((a, b) => a.cost - b.cost)
      passing = { lane: choices[0].lane, until: ticks + 300 }
    }
    if (passing && passing.until >= ticks) {
      const q = track.samples[(nearest + 7) % track.samples.length]
      target = [q.p[0] + Math.cos(q.yaw) * passing.lane, q.p[1], q.p[2] - Math.sin(q.yaw) * passing.lane]
    }
    if (racer.item === null) {
      // Aim for a visible box, including an outside lane when the center is
      // empty. This uses the rendered native objects a player can see.
      const boxes = observation.scene.entities.filter(entity => entity.id >= 300 && entity.canvas.bitmask === 2)
        .map(entity => {
          const q = entity.transform.position, dx = q[0] - p[0], dz = q[2] - p[2]
          return { q, gap: Math.hypot(dx, dz), ahead: dx * Math.sin(racer.heading) + dz * Math.cos(racer.heading) }
        }).filter(box => box.gap < 15 && box.ahead > 1.5).sort((a, b) => a.gap - b.gap)
      if (boxes[0] && (!passing || passing.until < ticks || boxes[0].gap < 7)) target = boxes[0].q
    }
    const desired = Math.atan2(target[0] - p[0], target[2] - p[2])
    const error = Math.atan2(Math.sin(desired - racer.heading), Math.cos(desired - racer.heading))
    const next = Math.abs(error) < 0.085 ? null : error > 0 ? 'd' : 'a'
    if (held !== next) {
      if (held) { await page.keyboard.up(held); trace.push({ tick: ticks, type: 'keyup', key: held }) }
      if (next) { await page.keyboard.down(next); trace.push({ tick: ticks, type: 'keydown', key: next }) }
      held = next
    }
    if (racer.item !== null) { await page.keyboard.press('Space'); trace.push({ tick: ticks, type: 'press', key: 'Space' }) }
    const step = 6
    await page.evaluate(n => window.gameHost.step(n), step)
    ticks += step
    if (i % 100 === 0) {
      samples.push({ ticks, state, body: observation.scene.entities[0] })
      console.log(JSON.stringify({ ticks, time: state.elapsed, phase: state.phase, racers: state.racers.map(r => ({ id: r.id, lap: r.lap, distance: Math.round(r.distance), recoveries: r.recoveries })) }))
    }
    // Flush the software GPU regularly; retain partial evidence even on failure.
    if (i % 100 === 0) {
      await writeFile('evidence/shared-inputs/drive-progress.json', JSON.stringify({ sourceSha, sceneSha, trace, samples, nativePath, errors }, null, 2))
    }
  }
  if (held) await page.keyboard.up(held)
  for (let i = 0; i < 12; i++) {
    const observation = await page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103] }))
    rememberBodies(observation, observation.ticks)
    if (observation.game['1'].racers.every(racer => racer.finished !== null)) break
    await page.evaluate(() => window.gameHost.step(300))
  }
  const final = await page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103] }))
  rememberBodies(final, final.ticks)
  const nativeTravelByRacer = [0, 1, 2, 3].map(id => {
    let travel = 0, previous = null
    for (const sample of nativePath) {
      const p = sample.positions[id]
      const nearest = track.samples.reduce((best, q) => (q.p[0] - p[0]) ** 2 + (q.p[2] - p[2]) ** 2 < (best.p[0] - p[0]) ** 2 + (best.p[2] - p[2]) ** 2 ? q : best)
      if (previous !== null) travel += ((nearest.s - previous + track.length * 1.5) % track.length) - track.length / 2
      previous = nearest.s
    }
    return travel
  })
  const nativeTravel = nativeTravelByRacer[0]
  if (process.env.SPARSE_RENDER) await presentFrame(page)
  const finalSave = await page.evaluate(() => window.gameHost.snapshot())
  errors.push(...await page.evaluate(() => window.hostErrors))
  await writeFile('evidence/shared-inputs/drive.json', JSON.stringify({ sourceSha, sceneSha, renderStride: process.env.SPARSE_RENDER ? 16 : 1, browser: browser.version(), wallSeconds: (Date.now() - start) / 1000, trace, samples, nativePath, nativeTravel, nativeTravelByRacer, final, finalSave, errors }, null, 2))
  await writeFile('evidence/shared-inputs/finished-save.json', JSON.stringify(finalSave, null, 2))
  assert.ok(nativeTravelByRacer.every(travel => travel >= track.length * 3), 'All four native bodies must traverse at least three full circuits')
  console.log('FINAL', JSON.stringify({ state: final.game, errors, wallSeconds: (Date.now() - start) / 1000 }))
  if (final.game['1'].phase !== 'finished' || final.game['1'].racers.some(racer => racer.finished === null) || errors.length) process.exitCode = 1
} catch (error) {
  await writeFile('evidence/shared-inputs/drive-failure.json', JSON.stringify({ sourceSha, error: error.stack, trace, samples, errors }, null, 2))
  throw error
} finally { await browser.close(); server.kill() }
