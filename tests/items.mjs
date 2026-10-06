// Saved-state fixtures isolate composed interactions; these are not race demos.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { startServer } from './server.mjs'

const track = JSON.parse(await readFile('src/track.json', 'utf8'))
const sourceSha = createHash('sha256').update(await readFile('scripts/main.js')).digest('hex')
const server = await startServer()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
const checks = [], errors = []
page.on('pageerror', error => errors.push(error.message))
const step = n => page.evaluate(count => window.gameHost.step(count), n)
const snapshot = () => page.evaluate(() => window.gameHost.snapshot())
const state = save => save.scripts.find(script => script.entity === 1).state
const observe = () => page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103, 200, 201, 400, 420, 450, 451, 460] }))
const check = (name, evidence) => { checks.push({ name, evidence }); console.log('PASS', name) }
function point(distance) {
  const s = (distance % track.length + track.length) % track.length
  const index = track.samples.findIndex((p, i) => p.s <= s && (track.samples[i + 1]?.s ?? track.length) > s)
  const a = track.samples[index], b = track.samples[(index + 1) % track.samples.length]
  const t = (s - a.s) / ((track.samples[index + 1]?.s ?? track.length) - a.s)
  return { index, s, p: a.p.map((x, k) => x + (b.p[k] - x) * t), yaw: Math.atan2(b.p[0] - a.p[0], b.p[2] - a.p[2]) }
}
let baseline
function fixture(distances, items) {
  const save = structuredClone(baseline), value = state(save), race = value.race
  race.phase = 'racing'; race.resumePhase = null; race.pausedMotion = null
  race.elapsed = 10; race.ticks = 600; race.events = []; race.gooses = []; race.jellies = []
  race.pickups.forEach(pickup => { pickup.ready = 999 })
  race.racers.forEach((racer, id) => {
    const q = point(distances[id]), p = [q.p[0], q.p[1] + .73, q.p[2]]
    Object.assign(racer, { distance: distances[id], s: q.s, index: q.index, lane: 0,
      heading: q.yaw, speed: 8.5, steer: 0, nextGate: Math.floor(distances[id] / track.length * 16) + 1,
      lap: 0, item: items[id] ?? null, aiUseAt: 10, boostUntil: 0, slowUntil: 0, jellyUntil: 0,
      immuneUntil: 0, recoverUntil: 0, bumpUntil: 0, recoveries: 0, stuck: 0, finished: null, p })
    value.bodies[id] = { type: 'dynamic', position: p, velocity: [Math.sin(q.yaw) * 8.5, 0, Math.cos(q.yaw) * 8.5] }
  })
  return save
}
async function load(save) {
  await page.evaluate(value => window.mountTestGame(value), save)
  await page.frameLocator('iframe').getByRole('button', { name: 'Back to the race' }).click()
}
try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  baseline = await snapshot()

  await load(fixture([12, 24, 36, 48], [0, 0, 0, 0]))
  await page.keyboard.press('Space'); await step(40)
  let observation = await observe(), value = state(await snapshot())
  assert.ok(value.race.racers.every(r => r.boostUntil > value.race.elapsed && r.item === null))
  assert.ok(observation.scene.entities.filter(body => body.id >= 100 && body.id <= 103)
    .every(body => Math.hypot(body.rigidBody.linearVelocity[0], body.rigidBody.linearVelocity[2]) > 10.5))
  assert.equal(observation.scene.entities.find(e => e.id === 450).canvas.bitmask, 2)
  check('Player and all AI use Soda Rocket with native acceleration and visible bottles', observation)
  const boostSave = await snapshot()
  await load(boostSave)
  assert.deepEqual(state(await snapshot()).race.racers, state(boostSave).race.racers)
  await step(125)
  value = state(await snapshot())
  assert.ok(value.race.racers.every(r => r.boostUntil < value.race.elapsed))
  check('Active boost survives save/resume and expires at the saved simulation time', value)

  await load(fixture([35, 46, 22, 9], [1, null, 1, null]))
  await page.keyboard.press('Space'); await step(1)
  value = state(await snapshot())
  assert.deepEqual(value.race.gooses.map(g => [g.owner, g.target]), [[0, 1], [2, 0]])
  const gooseSave = await snapshot()
  await load(gooseSave)
  assert.deepEqual(state(await snapshot()).race, state(gooseSave).race)
  await step(75)
  observation = await observe(); value = state(await snapshot())
  assert.ok(value.race.events.some(e => e.kind === 'hit' && e.owner === 0 && e.racer === 1 && e.item === 1))
  assert.ok(value.race.events.some(e => e.kind === 'hit' && e.owner === 2 && e.racer === 0 && e.item === 1))
  assert.ok(value.race.racers[0].slowUntil > value.race.elapsed)
  assert.ok(Math.hypot(...[0, 2].map(i => observation.scene.entities.find(e => e.id === 101).rigidBody.linearVelocity[i])) < 8)
  check('Player and AI geese target ahead and cause native slowdown on rivals', observation)

  await load(fixture([50, 43, 36, 12], [2, 2, null, null]))
  await page.keyboard.press('Space'); await step(1)
  const deployed = await observe()
  assert.equal(deployed.scene.entities.find(e => e.id === 420).canvas.bitmask, 2)
  const jellySave = await snapshot()
  await load(jellySave)
  assert.deepEqual(state(await snapshot()).race, state(jellySave).race)
  await step(48)
  value = state(await snapshot()); observation = await observe()
  assert.ok(value.race.events.some(e => e.kind === 'hit' && e.owner === 0 && e.racer === 1 && e.item === 2))
  assert.ok(value.race.events.some(e => e.kind === 'hit' && e.owner === 1 && e.racer === 2 && e.item === 2))
  assert.equal(value.race.racers[0].jellyUntil, 0)
  assert.ok(value.race.racers[1].jellyUntil > value.race.elapsed)
  assert.equal(value.race.events.filter(e => e.kind === 'hit' && e.racer === 1).length, 1)
  check('Player and AI jelly traps visibly deploy, hit rivals once, and spare their owners', { deployed, after: observation })

  await load(fixture([45, 30, 15, 0], [1, null, null, null]))
  await page.keyboard.press('Space'); await step(1)
  assert.equal(state(await snapshot()).race.gooses[0].target, null)
  await step(241)
  assert.equal(state(await snapshot()).race.gooses.length, 0)
  check('No-target goose travels and expires')

  const disrupted = fixture([50, 60, 70, 80], [])
  for (const body of state(disrupted).bodies) body.position[1] -= 12
  await load(disrupted); await step(6)
  value = state(await snapshot()); observation = await observe()
  assert.ok(value.race.racers.every(r => r.recoveries === 1))
  assert.ok(value.race.racers.every((r, id) => r.distance <= [50, 60, 70, 80][id]))
  assert.ok(observation.scene.entities.filter(e => e.id >= 100 && e.id <= 103).every(e => e.transform.position[1] > 1))
  check('Shared recovery returns all four fallen native bodies without advancing progress', observation)

  await load(fixture([50, 53, 43, 12], [null, 2, 1, null]))
  await step(55)
  value = state(await snapshot())
  assert.equal(value.race.events.filter(e => e.kind === 'hit' && e.racer === 0).length, 1)
  assert.ok(value.race.racers[0].immuneUntil > value.race.elapsed)
  check('Overlapping AI goose and jelly cannot repeatedly stun the native player body', await observe())

  const finishSave = fixture([track.length * 3 - 1.5, 110, 90, 70], [0, null, null, null])
  const finishRacer = state(finishSave).race.racers[0]
  finishRacer.lap = 2; finishRacer.nextGate = 48
  await load(finishSave); await page.keyboard.press('Space'); await step(30)
  const completed = state(await snapshot())
  assert.equal(completed.race.phase, 'finished')
  assert.equal(completed.race.racers[0].lap, 3)
  assert.ok(completed.race.racers[0].boostUntil > completed.race.elapsed)
  await step(120)
  assert.equal(state(await snapshot()).race.racers[0].finished, completed.race.racers[0].finished)
  check('A native boosted finish crosses the last gate once and freezes the result', await observe())

  const wallSave = fixture([80, 110, 140, 170], [0, null, null, null])
  const wallState = state(wallSave), q = point(80), lane = track.width / 2 - 1
  wallState.bodies[0].position[0] += Math.cos(q.yaw) * lane
  wallState.bodies[0].position[2] -= Math.sin(q.yaw) * lane
  wallState.race.racers[0].p = [...wallState.bodies[0].position]
  wallState.race.racers[0].heading += .65
  await load(wallSave); await page.keyboard.press('Space'); await step(45)
  value = state(await snapshot()); observation = await observe()
  assert.ok(value.race.events.some(e => e.kind === 'bump' && e.racer === 0))
  assert.ok(observation.scene.entities.find(e => e.id === 100).physics.contacts.some(c => Math.abs(c.normal[1]) < .5))
  assert.ok(value.race.racers[0].boostUntil > value.race.elapsed)
  assert.equal(value.race.racers[0].recoveries, 0)
  assert.ok(Math.abs(value.race.racers[0].lane) < track.width / 2)
  check('A Soda Rocket wall impact produces a native side contact and keeps the kart on course', observation)
  errors.push(...await page.evaluate(() => window.hostErrors))
  assert.deepEqual(errors, [])
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1 }
finally {
  await writeFile('evidence/shared-inputs/browser-items.json', JSON.stringify({ sourceSha, browser: browser.version(), fixtureNotice: 'Explicitly arranged saved states, not natural-race or recording evidence.', checks, errors }, null, 2))
  await browser.close(); server.kill()
}
