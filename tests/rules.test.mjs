import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(new URL('../pocketrealms.json', import.meta.url)))
const { InputController } = await import(new URL(`../.runtime/${config.runtime.build}/test-runtime.js`, import.meta.url))

function fixture() {
  const source = readFileSync(new URL('../scripts/main.js', import.meta.url), 'utf8')
  const api = vm.runInNewContext(source.replace('export default {', 'const lifecycle = {') +
    ';({TRACK, lifecycle, newRace, useItem, hitRacer, updateItems, updateProgress, recoverRacer, courseAt, snapshotRace, restoreRace, randomRace, driveInput, clearInput, getRace:()=>race})',
  { structuredClone, console })
  const scene = JSON.parse(readFileSync(new URL('../scene/scene.json', import.meta.url), 'utf8'))
  const entities = new Map(scene.entities.map(entity => [entity.id, entity]))
  let checkpoints = 0
  const controls = new InputController(JSON.parse(readFileSync(new URL('../inputs.json', import.meta.url))))
  const game = {
    input: { value: id => controls.frame.values[id], clear: () => controls.clear(), setPaused: paused => controls.setPaused(paused) },
    getEntity: id => structuredClone(entities.get(id)),
    updateEntity(id, changes) {
      const current = entities.get(id)
      for (const [key, value] of Object.entries(changes)) current[key] = { ...current[key], ...value }
    },
    report() {}, checkpoint() { checkpoints++ }, reset() {},
  }
  api.lifecycle.start(game)
  const key = (code, down = true, repeat = false) => {
    controls.keyboard({ type: down ? 'keydown' : 'keyup', code, repeat })
    const frame = controls.advance(1 / 60)
    for (const event of frame.events) api.lifecycle.onControl(event, game)
  }
  return { ...api, game, key, get checkpoints() { return checkpoints } }
}

test('a race contains one player and three independently tracked opponents', () => {
  const f = fixture(), race = f.getRace()
  assert.equal(race.racers.length, 4)
  assert.equal(new Set(race.racers.map(r => r.id)).size, 4)
  assert.equal(race.racers.filter(r => r.finished !== null).length, 0)
  assert.equal(race.pickups.length, 12)
})

test('opposing steering inputs cancel and releasing either retains the other', () => {
  const f = fixture()
  f.getRace().phase = 'racing'
  f.key('KeyA')
  assert.equal(f.driveInput(), -1)
  f.key('KeyD')
  assert.equal(f.driveInput(), 0)
  f.key('KeyA', false)
  assert.equal(f.driveInput(), 1)
  f.clearInput()
  assert.equal(f.driveInput(), 0)
})

test('repeat Space cannot consume the next item', () => {
  const f = fixture(), race = f.getRace(), player = race.racers[0]
  race.phase = 'racing'; player.item = 0
  f.key('Space')
  assert.equal(player.item, null)
  player.item = 2
  f.key('Space', true, true)
  assert.equal(player.item, 2)
})

test('three laps require all gates in order, and finish crossings alone do not count', () => {
  const f = fixture(), race = f.getRace(), racer = race.racers[0]
  race.phase = 'racing'
  function project(distance) {
    const q = f.courseAt(distance)
    f.updateProgress(racer, { ...q, lane: 0 }, f.game)
  }
  for (let d = racer.distance + 0.5; d < 2; d += 0.5) project(d)
  for (let repeat = 0; repeat < 10; repeat++) {
    for (let d = 1.5; d >= -1; d -= 0.5) project(d)
    for (let d = -0.5; d <= 1.5; d += 0.5) project(d)
  }
  assert.equal(racer.lap, 0)
  assert.equal(racer.nextGate, 1)
  // Advancing along the physical circuit crosses sixteen ordered gates per lap.
  for (let d = 2; d <= f.TRACK.length * 3 + 1; d += 0.5) project(d)
  assert.equal(racer.lap, 3)
  assert.equal(race.phase, 'finished')
  assert.equal(race.finishes.length, 1)
})

test('out-of-order teleport and off-course travel cannot award progress', () => {
  const f = fixture(), racer = f.getRace().racers[0]
  const before = racer.distance
  f.updateProgress(racer, { ...f.courseAt(f.TRACK.length / 2), lane: 0 }, f.game)
  assert.equal(racer.distance, before)
  f.updateProgress(racer, { ...f.courseAt(f.TRACK.length / 2 + 1), lane: 50 }, f.game)
  assert.equal(racer.distance, before)
  assert.equal(racer.nextGate, 0)
})

test('recovery costs progress and cannot advance a checkpoint', () => {
  const f = fixture(), racer = f.getRace().racers[0]
  racer.distance = 35; racer.nextGate = 2
  f.recoverRacer(racer, f.game)
  assert.ok(racer.distance < 35)
  assert.equal(racer.nextGate, 2)
  assert.equal(racer.lap, 0)
  assert.equal(racer.recoveries, 1)
  assert.ok(racer.recoverUntil > 0)
})

test('goose selects the nearest racer ahead and a no-target goose expires', () => {
  const f = fixture(), race = f.getRace(), player = race.racers[0]
  race.phase = 'racing'
  race.racers.forEach((r, i) => { r.distance = [0, 20, 9, -5][i] })
  player.item = 1
  assert.equal(f.useItem(player), true)
  assert.equal(race.gooses[0].target, 2)
  assert.equal(f.useItem(player), false)
  race.gooses = []
  race.racers.slice(1).forEach(r => { r.distance = -50 })
  player.item = 1; f.useItem(player)
  assert.equal(race.gooses[0].target, null)
  race.elapsed = 5; f.updateItems(1 / 60)
  assert.equal(race.gooses.length, 0)
})

test('hit immunity prevents a goose and jelly from repeatedly locking a kart', () => {
  const f = fixture(), race = f.getRace(), rival = race.racers[1]
  race.phase = 'racing'
  assert.equal(f.hitRacer(rival, 1, 0), true)
  const expiry = rival.slowUntil
  assert.equal(f.hitRacer(rival, 2, 2), false)
  assert.equal(rival.slowUntil, expiry)
  race.elapsed = rival.immuneUntil + 0.01
  assert.equal(f.hitRacer(rival, 2, 2), true)
  assert.ok(rival.jellyUntil > race.elapsed)
})

test('pickups preserve an existing item and fresh own traps do not hit their owner', () => {
  const f = fixture(), race = f.getRace(), player = race.racers[0]
  race.phase = 'racing'
  player.item = 0; player.s = race.pickups[0].s; player.lane = race.pickups[0].lane
  f.updateItems(1 / 60)
  assert.equal(player.item, 0)
  // Keep rivals clear: a rival consuming the trap is valid behavior.
  race.racers.slice(1).forEach(racer => { racer.distance = 100 })
  player.item = 2; f.useItem(player)
  player.distance -= 2.7
  f.updateItems(1 / 60)
  assert.equal(player.jellyUntil, 0)
  assert.equal(race.jellies.length, 1)
})

test('seeded item randomness resumes at the saved state', () => {
  const f = fixture()
  f.randomRace(); f.randomRace()
  const saved = f.snapshotRace(f.game)
  const expected = Array.from({ length: 8 }, () => f.randomRace())
  f.restoreRace(saved, f.game)
  assert.deepEqual(Array.from({ length: 8 }, () => f.randomRace()), expected)
})

test('invalid motion saves fail explicitly', () => {
  const f = fixture(), saved = f.snapshotRace(f.game)
  saved.bodies[0].position[1] = NaN
  assert.throws(() => f.restoreRace(saved, f.game), /Invalid saved kart motion/)
})
