const TAU = Math.PI * 2
const DT = 1 / 60
const LAPS = 3
const GATES = 16
const BODY = 100
const DRIVER_NAMES = ['Pip', 'Mochi', 'Crumb', 'Plum']
const ITEM_NAMES = ['Soda Rocket', 'Honking Goose', 'Jelly Wobble']
const DRIVER_COLORS = ['#ed8095', '#82bbdb', '#f1ca68', '#b2a0dc']
let race
let gameContext
const visibleModels = new Map()
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const mix = (a, b, t) => a + (b - a) * t
const wrap = (x, length = TRACK.length) => ((x % length) + length) % length
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

function courseAt(distance, lane = 0) {
  const s = wrap(distance)
  let index = TRACK.samples.findIndex((point, i) => point.s <= s && (TRACK.samples[i + 1]?.s ?? TRACK.length) > s)
  if (index < 0) index = 0
  const a = TRACK.samples[index], b = TRACK.samples[(index + 1) % TRACK.samples.length]
  const f = (s - a.s) / ((TRACK.samples[index + 1]?.s ?? TRACK.length) - a.s)
  const yaw = a.yaw + angleDelta(b.yaw, a.yaw) * f
  return { index, s, yaw, p: [mix(a.p[0], b.p[0], f) + Math.cos(yaw) * lane,
    mix(a.p[1], b.p[1], f), mix(a.p[2], b.p[2], f) - Math.sin(yaw) * lane] }
}

function projectCourse(position, hint = null) {
  let best = null
  const count = TRACK.samples.length
  const indices = hint === null ? TRACK.samples.map((_, i) => i) : Array.from({ length: 31 }, (_, i) => wrap(hint + i - 15, count))
  for (const index of indices) {
    const a = TRACK.samples[index], b = TRACK.samples[(index + 1) % count]
    const dx = b.p[0] - a.p[0], dz = b.p[2] - a.p[2]
    const t = clamp(((position[0] - a.p[0]) * dx + (position[2] - a.p[2]) * dz) / (dx * dx + dz * dz), 0, 1)
    const x = mix(a.p[0], b.p[0], t), z = mix(a.p[2], b.p[2], t)
    const error = (position[0] - x) ** 2 + (position[2] - z) ** 2
    if (best && best.error <= error) continue
    const length = (TRACK.samples[index + 1]?.s ?? TRACK.length) - a.s
    const yaw = Math.atan2(dx, dz)
    best = { index, s: wrap(a.s + length * t), yaw, error,
      lane: (position[0] - x) * Math.cos(yaw) - (position[2] - z) * Math.sin(yaw),
      height: mix(a.p[1], b.p[1], t) }
  }
  return best
}

function randomRace() {
  let x = race.random | 0
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5
  race.random = x >>> 0
  return race.random / 4294967296
}

function clearInput() { gameContext?.input.clear() }

function driveInput() {
  if (!race || !['racing', 'countdown'].includes(race.phase)) return 0
  return Number(gameContext.input.value('right')) - Number(gameContext.input.value('left'))
}

function newRace(game, start = false) {
  game.input.setPaused(false)
  clearInput()
  visibleModels.clear()
  race = { version: 1, seed: 7321, random: 7321, phase: start ? 'countdown' : 'title',
    resumePhase: null, pausedMotion: null, countdown: 3, elapsed: 0, ticks: 0, finishes: [],
    message: '', messageUntil: 0, itemSerial: 0, gooses: [], jellies: [],
    pickups: Array.from({ length: 12 }, (_, i) => ({ s: TRACK.length * (0.12 + Math.floor(i / 3) * 0.23), lane: (i % 3 - 1) * 3.1, ready: 0 })),
    racers: [], camera: null, events: [] }
  for (let i = 0; i < 4; i++) {
    const distance = i === 0 || i === 3 ? -9.5 : -6
    const location = courseAt(distance, i % 2 ? 1.65 : -1.65)
    const racer = { id: i, name: DRIVER_NAMES[i], distance, s: location.s, index: location.index,
      lane: i % 2 ? 1.65 : -1.65, heading: location.yaw, speed: 0, steer: 0,
      nextGate: 0, lap: 0, item: null, boostUntil: 0, slowUntil: 0, jellyUntil: 0,
      immuneUntil: 0, bumpUntil: 0, recoverUntil: 0, stuck: 0, recoveries: 0,
      aiUseAt: 0, finished: null, wheel: 0, p: location.p.map((v, k) => k === 1 ? v + 0.76 : v) }
    race.racers.push(racer)
    game.updateEntity(BODY + i, { transform: { position: racer.p, rotation: [0, 0, 0] }, rigidBody: { type: 'kinematic', linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] } })
  }
  updateVisuals(game, true)
  updateUi()
  reportRace(game)
}

function emit(kind, data = {}) {
  race.events.push({ kind, time: Math.round(race.elapsed * 1000) / 1000, ...data })
  if (race.events.length > 70) race.events.shift()
}

function announce(text, seconds = 2) {
  race.message = text
  race.messageUntil = race.elapsed + seconds
}

function startRace() {
  if (race.phase !== 'title') return
  race.phase = 'countdown'
  race.countdown = 3
  clearInput()
  uiAudio()
  uiBeep('count')
  focusCanvas()
  updateUi()
}

function pauseRace() {
  if (!['racing', 'countdown'].includes(race.phase)) return
  race.resumePhase = race.phase
  race.phase = 'paused'
  gameContext.input.setPaused(true)
  race.pausedMotion = race.racers.map(racer => {
    const body = gameContext.getEntity(BODY + racer.id)
    gameContext.updateEntity(BODY + racer.id, { rigidBody: { type: 'kinematic', linearVelocity: [0, 0, 0] } })
    return { type: body.rigidBody.type, velocity: [...body.rigidBody.linearVelocity] }
  })
  clearInput()
  updateUi()
  reportRace(gameContext)
  gameContext.checkpoint()
}

function resumeRace() {
  if (race.phase !== 'paused') return
  uiAudio()
  race.phase = race.resumePhase || 'racing'
  gameContext.input.setPaused(false)
  race.resumePhase = null
  race.pausedMotion?.forEach((motion, i) => gameContext.updateEntity(BODY + i, { rigidBody: { type: motion.type, linearVelocity: motion.velocity } }))
  race.pausedMotion = null
  clearInput()
  focusCanvas()
  updateUi()
  reportRace(gameContext)
}

function recoverRacer(racer, game) {
  const gateDistance = Math.max(-7, (racer.nextGate - 1) * TRACK.length / GATES)
  racer.distance = Math.min(racer.distance, gateDistance + 1)
  const location = courseAt(racer.distance, (racer.id % 2 ? 1 : -1) * 1.5)
  racer.s = location.s
  racer.index = location.index
  racer.heading = location.yaw
  racer.speed = 0
  racer.stuck = 0
  racer.recoverUntil = race.elapsed + 1.3
  racer.immuneUntil = race.elapsed + 2
  racer.recoveries++
  racer.p = [location.p[0], location.p[1] + 1.1, location.p[2]]
  game.updateEntity(BODY + racer.id, { transform: { position: racer.p, rotation: [0, 0, 0] }, rigidBody: { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] } })
  emit('recovery', { racer: racer.id })
  if (racer.id === 0) announce('Back on the picnic path!')
}

function updateProgress(racer, location, game) {
  const delta = wrap(location.s - racer.s + TRACK.length / 2) - TRACK.length / 2
  racer.index = location.index
  racer.lane = location.lane
  racer.s = location.s
  // Reject teleports and progress from outside the course corridor.
  if (Math.abs(delta) > 4 || Math.abs(location.lane) > TRACK.width / 2 + 0.8) return
  const before = racer.distance
  racer.distance += delta
  const gate = racer.nextGate * TRACK.length / GATES
  if (delta > 0 && before < gate && racer.distance >= gate) {
    racer.nextGate++
    if (racer.nextGate > 1 && (racer.nextGate - 1) % GATES === 0) {
      racer.lap++
      emit('lap', { racer: racer.id, lap: racer.lap })
      if (racer.id === 0) { uiBeep('lap'); announce(racer.lap === 2 ? 'Final lap. Make it silly!' : 'One lap down. Snacks ahead!'); game.checkpoint() }
      if (racer.lap >= LAPS) {
        racer.finished = race.elapsed
        race.finishes.push(racer.id)
        emit('finish', { racer: racer.id, position: race.finishes.length })
        if (racer.id === 0) { race.phase = 'finished'; clearInput(); uiBeep('finish'); game.checkpoint(); updateUi() }
      }
    }
  }
}

function aiSteer(racer) {
  let lane = racer.distance < 10 ? (racer.id % 2 ? 1.65 : -1.65) : Math.sin(racer.distance / 38 + racer.id * 2) * 1.6
  const ahead = race.racers.find(other => other.id !== racer.id && other.distance > racer.distance && other.distance - racer.distance < 9 && Math.abs(other.lane - racer.lane) < 1.8)
  if (ahead && racer.distance >= 10) lane = ahead.lane > 0 ? -2.5 : 2.5
  const target = courseAt(racer.distance + 6 + racer.speed * 0.55, lane)
  const angle = Math.atan2(target.p[0] - racer.p[0], target.p[2] - racer.p[2])
  return clamp(angleDelta(angle, racer.heading) * 2.6, -1, 1)
}

function useItem(racer) {
  if (!['racing', 'finished'].includes(race.phase) || racer.finished !== null || racer.item === null) return false
  const item = racer.item
  racer.item = null
  if (item === 0) racer.boostUntil = race.elapsed + 2.5
  if (item === 1) {
    const candidates = race.racers.filter(other => other.id !== racer.id && other.finished === null && other.distance > racer.distance && other.distance - racer.distance < 50)
      .sort((a, b) => a.distance - b.distance)
    if (race.gooses.length >= 8) race.gooses.shift()
    race.gooses.push({ serial: ++race.itemSerial, owner: racer.id, target: candidates[0]?.id ?? null,
      distance: racer.distance + 2.5, lane: racer.lane, expires: race.elapsed + 4 })
  }
  if (item === 2) {
    if (race.jellies.length >= 8) race.jellies.shift()
    race.jellies.push({ serial: ++race.itemSerial, owner: racer.id, distance: racer.distance - 2.7,
      lane: racer.lane, expires: race.elapsed + 9 })
  }
  emit('use', { racer: racer.id, item })
  if (racer.id === 0) { uiBeep(item === 1 ? 'honk' : 'use'); announce(ITEM_NAMES[item] + '!') }
  return true
}

function hitRacer(racer, item, owner) {
  if (racer.finished !== null || racer.immuneUntil > race.elapsed) return false
  racer.slowUntil = race.elapsed + (item === 1 ? 1.2 : 1.7)
  if (item === 2) racer.jellyUntil = race.elapsed + 1.7
  racer.immuneUntil = race.elapsed + 2.1
  emit('hit', { racer: racer.id, owner, item })
  if (racer.id === 0) { announce(item === 1 ? 'HONK. That was personal.' : 'A wobble in the road!'); uiBeep('bonk') }
  return true
}

function updateItems(dt) {
  for (const pickup of race.pickups) {
    if (pickup.ready > race.elapsed) continue
    for (const racer of race.racers) {
      if (racer.finished !== null || racer.item !== null) continue
      const along = wrap(racer.s - pickup.s + TRACK.length / 2) - TRACK.length / 2
      if (Math.abs(along) < 1.65 && Math.abs(racer.lane - pickup.lane) < 1.35) {
        racer.item = Math.floor(randomRace() * 3)
        racer.aiUseAt = race.elapsed + 0.7 + randomRace() * 1.7
        pickup.ready = race.elapsed + 1.5
        emit('pickup', { racer: racer.id, item: racer.item })
        if (racer.id === 0) { announce(ITEM_NAMES[racer.item] + ' · ready!'); uiBeep('pickup') }
        break
      }
    }
  }
  race.gooses = race.gooses.filter(goose => {
    goose.distance += 23 * dt
    const target = race.racers[goose.target]
    if (target) goose.lane = mix(goose.lane, target.lane, dt * 5)
    for (const racer of race.racers) {
      if (racer.id === goose.owner || Math.abs(racer.distance - goose.distance) > 2 || Math.abs(racer.lane - goose.lane) > 1.5) continue
      if (hitRacer(racer, 1, goose.owner)) return false
    }
    return goose.expires > race.elapsed
  })
  race.jellies = race.jellies.filter(jelly => {
    for (const racer of race.racers) {
      const gap = wrap(racer.distance - jelly.distance + TRACK.length / 2) - TRACK.length / 2
      if (racer.id !== jelly.owner && Math.abs(gap) < 1.9 && Math.abs(racer.lane - jelly.lane) < 1.9 && hitRacer(racer, 2, jelly.owner)) return false
    }
    return jelly.expires > race.elapsed
  })
}

function tickRace(dt, game) {
  if (race.phase === 'paused' || race.phase === 'title') return
  race.ticks++
  if (race.phase === 'countdown') {
    const old = Math.ceil(race.countdown)
    race.countdown -= dt
    if (Math.ceil(race.countdown) !== old) uiBeep('count')
    if (race.countdown <= 0) {
      race.phase = 'racing'
      for (const racer of race.racers) game.updateEntity(BODY + racer.id, { rigidBody: { type: 'dynamic' } })
      announce('GO! Picnic rules apply.'); emit('start')
    }
  }
  const running = race.phase === 'racing' || race.phase === 'finished'
  if (running) race.elapsed += dt
  for (const racer of race.racers) {
    const body = game.getEntity(BODY + racer.id)
    racer.p = [...body.transform.position]
    const location = projectCourse(racer.p, racer.index)
    if (running && racer.finished === null) {
      updateProgress(racer, location, game)
      if (Math.abs(location.lane) > TRACK.width / 2 + 4 || racer.p[1] < location.height - 4 || racer.stuck > 3.5) {
        recoverRacer(racer, game)
        continue
      }
    }
    let steer = racer.id === 0 ? driveInput() : aiSteer(racer)
    if (!running || racer.finished !== null || racer.recoverUntil > race.elapsed) steer = 0
    racer.steer = mix(racer.steer, steer, Math.min(1, dt * 12))
    const desired = running && racer.finished === null ? (racer.id === 0 ? 9.5 : 9 + racer.id * 0.1) : 0
    const boosted = racer.boostUntil > race.elapsed
    const slow = racer.slowUntil > race.elapsed
    const jelly = racer.jellyUntil > race.elapsed
    const recovering = racer.recoverUntil > race.elapsed
    const speedTarget = desired * (boosted ? 1.48 : 1) * (slow ? 0.53 : 1) * (recovering ? 0 : 1) * (1 - Math.abs(racer.steer) * 0.12)
    racer.speed = mix(racer.speed, speedTarget, Math.min(1, dt * (speedTarget > racer.speed ? 2.1 : 5)))
    racer.heading += racer.steer * dt * 1.65 * Math.min(1, racer.speed / 3) * (jelly ? 0.6 : 1)
    const v = body.rigidBody.linearVelocity
    const grip = running ? dt * (jelly ? 2.1 : 11) : 1
    const vx = mix(v[0], Math.sin(racer.heading) * racer.speed, Math.min(1, grip))
    const vz = mix(v[2], Math.cos(racer.heading) * racer.speed, Math.min(1, grip))
    game.updateEntity(BODY + racer.id, { rigidBody: { linearVelocity: [vx, v[1], vz] } })
    if (running && racer.finished === null && !recovering) racer.stuck = Math.hypot(v[0], v[2]) < 1 ? racer.stuck + dt : 0
    const sideContact = body.physics?.contacts.some(contact => Math.abs(contact.normal[1]) < 0.5)
    if (sideContact && racer.bumpUntil < race.elapsed && running && racer.finished === null) {
      racer.bumpUntil = race.elapsed + 0.35
      racer.speed *= 0.72
      emit('bump', { racer: racer.id })
      if (racer.id === 0) uiBeep('bonk')
    }
    if (racer.id > 0 && racer.item !== null && racer.aiUseAt <= race.elapsed && running) useItem(racer)
    racer.wheel += Math.hypot(v[0], v[2]) * dt / 0.38
  }
  if (running) updateItems(dt)
  updateVisuals(game)
  if (race.ticks % 6 === 0) { updateUi(); reportRace(game) }
}

function standings() {
  return [...race.racers].sort((a, b) => {
    if (a.finished !== null && b.finished !== null) return a.finished - b.finished
    if (a.finished !== null) return -1
    if (b.finished !== null) return 1
    return b.distance - a.distance
  })
}

function visible(game, id, enabled) {
  if (visibleModels.get(id) !== enabled) {
    game.updateEntity(id, { canvas: { bitmask: enabled ? 2 : 0 } })
    visibleModels.set(id, enabled)
  }
  return enabled
}

function updateVisuals(game, instant = false, advanceCamera = true) {
  for (const racer of race.racers) {
    const yaw = racer.heading * 180 / Math.PI
    const slope = courseAt(racer.distance + 2).p[1] - courseAt(racer.distance - 2).p[1]
    const pitch = -Math.atan2(slope, 4) * 180 / Math.PI
    const wobble = racer.jellyUntil > race.elapsed ? Math.sin(race.elapsed * 24) * 9 : 0
    game.updateEntity(200 + racer.id, { transform: { position: [racer.p[0], racer.p[1] - 0.69, racer.p[2]], rotation: [pitch, yaw, -racer.steer * 5 + wobble] } })
    const ground = courseAt(racer.distance).p[1]
    game.updateEntity(240 + racer.id, { transform: { position: [racer.p[0], ground + .035, racer.p[2]], rotation: [-90 + pitch, yaw, 0] } })
    const boost = racer.boostUntil > race.elapsed
    if (visible(game, 450 + racer.id, boost)) game.updateEntity(450 + racer.id, { transform: {
      position: [racer.p[0] - Math.sin(racer.heading) * 1.5, racer.p[1] - .3, racer.p[2] - Math.cos(racer.heading) * 1.5], rotation: [0, yaw, 0] } })
    for (let b = 0; b < 4; b++) {
      const dust = !boost && Math.abs(racer.steer) > .65 && racer.speed > 6 && racer.finished === null
      if (!visible(game, 460 + racer.id * 4 + b, boost || dust)) continue
      const phase = (race.elapsed * 2 + b / 4) % 1, length = 1.9 + phase * 2.8, scale = .24 * (1 - phase) + .07
      game.updateEntity(460 + racer.id * 4 + b, { transform: {
        position: [racer.p[0] - Math.sin(racer.heading) * length + Math.cos(b * 8) * phase * .4, racer.p[1] + (dust ? -.55 : phase * .7), racer.p[2] - Math.cos(racer.heading) * length],
        scale: [scale, scale, scale], rotation: [race.elapsed * 250, b * 70, 45] } })
    }
    for (let w = 0; w < 4; w++) {
      const x = w % 2 ? 0.92 : -0.92, z = w < 2 ? 0.78 : -0.8
      game.updateEntity(220 + racer.id * 4 + w, { transform: {
        position: [racer.p[0] + Math.cos(racer.heading) * x + Math.sin(racer.heading) * z, racer.p[1] - 0.38 + (z * slope / 4), racer.p[2] - Math.sin(racer.heading) * x + Math.cos(racer.heading) * z],
        rotation: [racer.wheel * 180 / Math.PI, yaw + (w < 2 ? racer.steer * 15 : 0), 0] } })
    }
  }
  const me = race.racers[0]
  const look = courseAt(me.distance + 12)
  const targetYaw = race.phase === 'title' ? me.heading - 0.22 : me.heading
  const target = [me.p[0] - Math.sin(targetYaw) * 9.4, me.p[1] + 5.3, me.p[2] - Math.cos(targetYaw) * 9.4]
  if (!race.camera || instant) race.camera = [...target]
  else if (advanceCamera) race.camera = race.camera.map((v, i) => mix(v, target[i], 0.1))
  game.updateEntity(0, { transform: { position: race.camera }, camera: {
    target: [mix(me.p[0], look.p[0], 0.4), me.p[1] + 1, mix(me.p[2], look.p[2], 0.4)] } })
  race.pickups.forEach((pickup, index) => {
    if (!visible(game, 300 + index, pickup.ready <= race.elapsed)) return
    const point = courseAt(pickup.s, pickup.lane).p
    game.updateEntity(300 + index, { transform: {
      position: [point[0], point[1] + 1.05 + Math.sin(race.elapsed * 3 + index) * 0.2, point[2]], rotation: [12, race.elapsed * 45 + index * 30, 12] } })
  })
  for (let i = 0; i < 8; i++) {
    const goose = race.gooses[i], jelly = race.jellies[i]
    if (visible(game, 400 + i, Boolean(goose))) {
      const q = courseAt(goose.distance, goose.lane)
      game.updateEntity(400 + i, { canvas: { bitmask: 2 }, transform: { position: [q.p[0], q.p[1] + 1.1, q.p[2]], rotation: [0, q.yaw * 180 / Math.PI, Math.sin(race.elapsed * 25) * 12] } })
    }
    if (visible(game, 420 + i, Boolean(jelly))) {
      const q = courseAt(jelly.distance, jelly.lane)
      game.updateEntity(420 + i, { canvas: { bitmask: 2 }, transform: { position: [q.p[0], q.p[1] + 0.07, q.p[2]] } })
    }
  }
}

function reportRace(game) {
  game.report({ phase: race.phase, countdown: race.countdown, elapsed: race.elapsed, trackLength: TRACK.length,
    order: standings().map(r => r.id), controls: { steer: driveInput() },
    racers: race.racers.map(r => ({ id: r.id, p: r.p, heading: r.heading, speed: r.speed, steer: r.steer,
      distance: r.distance, lane: r.lane, lap: r.lap, nextGate: r.nextGate, item: r.item,
      recoveries: r.recoveries, finished: r.finished, boostUntil: r.boostUntil, slowUntil: r.slowUntil, jellyUntil: r.jellyUntil })),
    projectiles: race.gooses.length, traps: race.jellies.length, events: race.events.slice(-15) })
}

function snapshotRace(game) {
  return { version: 1, race: structuredClone(race), bodies: race.racers.map(r => {
    const body = game.getEntity(BODY + r.id)
    return { type: body.rigidBody.type, position: [...body.transform.position], velocity: [...body.rigidBody.linearVelocity] }
  }) }
}

function restoreRace(saved, game) {
  if (saved?.version !== 1 || saved.race?.version !== 1 || saved.race.racers?.length !== 4 || saved.bodies?.length !== 4
      || !['title', 'countdown', 'racing', 'paused', 'finished'].includes(saved.race.phase)
      || !Number.isFinite(saved.race.elapsed) || saved.race.elapsed < 0) throw Error('This is not a valid Wobble Rally save')
  for (const body of saved.bodies) for (const key of ['position', 'velocity']) {
    if (!Array.isArray(body[key]) || body[key].length !== 3 || !body[key].every(Number.isFinite)) throw Error('Invalid saved kart motion')
  }
  race = structuredClone(saved.race)
  visibleModels.clear()
  clearInput()
  saved.bodies.forEach((body, i) => {
    game.updateEntity(BODY + i, { transform: { position: body.position, rotation: [0, 0, 0] }, rigidBody: { type: body.type, linearVelocity: body.velocity, angularVelocity: [0, 0, 0] } })
  })
  updateVisuals(game, false, false)
  if (gameContext) pauseRace()
  updateUi()
  reportRace(game)
}
