// Repeatable, explicitly sampled footage from the actual Atlas browser.
// Physics and input replay run at 60 Hz; capture sampling is reported separately.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { startServer } from '../tests/server.mjs'
import { setRenderCadence, presentFrame } from '../tests/render-cadence.mjs'

const input = JSON.parse(await readFile('evidence/drive.json', 'utf8'))
const track = JSON.parse(await readFile('src/track.json', 'utf8'))
const sourceSha = createHash('sha256').update(await readFile('scripts/main.js')).digest('hex')
assert.equal(input.sourceSha, sourceSha, 'Generate a race trace for this revision first')
assert.equal(input.sceneSha, createHash('sha256').update(await readFile('scene/scene.json')).digest('hex'),
  'Regenerate the race trace after changing the native scene')
const ffmpeg = process.env.WOBBLE_FFMPEG || '/ms-playwright/ffmpeg-1011/ffmpeg-linux'
const directory = 'evidence/recordings'
await mkdir(directory, { recursive: true })
const touchOnly = process.argv.includes('--touch-only')
const previousDesktop = touchOnly ? JSON.parse(await readFile(`${directory}/desktop.json`, 'utf8')) : null
const fps = Number(process.env.WOBBLE_RECORD_FPS || previousDesktop?.fps || 10), frameTicks = 60 / fps
assert.ok([10, 15, 20, 30, 60].includes(fps), 'Capture FPS must evenly divide the 60 Hz simulation')
const finishTick = 180 + Math.round(input.final.game['1'].racers[0].finished * 60)
const cuts = [[0, 1440], [1800, 3000], [finishTick - 1080, finishTick + 240]]
const server = await startServer()
const angle = process.env.ANGLE || previousDesktop?.angle || 'native'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu-watchdog',
  ...(angle === 'native' ? [] : [`--use-angle=${angle}`, '--enable-unsafe-swiftshader'])] })
const viewport = previousDesktop?.viewport || { width: Number(process.env.WOBBLE_WIDTH || 960), height: Number(process.env.WOBBLE_HEIGHT || 600) }
const page = await browser.newPage({ viewport, hasTouch: true })
page.setDefaultTimeout(60000)
const errors = [], captures = [], touchTrace = []
page.on('pageerror', error => errors.push(error.message))
page.on('crash', () => errors.push('The capture browser page crashed'))
let disconnected = false
browser.on('disconnected', () => { disconnected = true })
let encoder, encoderDone, encoderLog = '', touchSave, ticks = 0, eventIndex = 0, frames = 0

function startEncoding(name) {
  encoderLog = ''
  encoder = spawn(ffmpeg, ['-loglevel', 'error', '-f', 'image2pipe', '-r', String(fps), '-vcodec', 'mjpeg',
    '-i', 'pipe:0', '-an', '-c:v', 'libvpx', '-b:v', '1600k', '-deadline', 'realtime', '-cpu-used', '8',
    '-threads', '2', '-y', `${directory}/${name}.webm`], { stdio: ['pipe', 'ignore', 'pipe'] })
  encoder.stderr.on('data', data => { encoderLog = (encoderLog + data).slice(-4000) })
  encoder.stdin.on('error', () => {})
  encoderDone = new Promise(resolve => {
    encoder.once('error', error => resolve({ error: error.message }))
    encoder.once('exit', code => resolve({ code }))
  })
}
async function sendFrame(buffer) {
  if (!encoder.stdin.write(buffer)) await once(encoder.stdin, 'drain')
  frames++
}
async function finishEncoding() {
  encoder.stdin.end()
  const result = await encoderDone
  if (result.error || result.code !== 0) throw Error(`Video encoder failed: ${result.error || encoderLog}`)
  encoder = null
}
async function step(count) {
  while (count > 0) {
    const n = Math.min(300, count)
    await page.evaluate(value => window.gameHost.step(value), n)
    count -= n; ticks += n
  }
}
async function advance(target) {
  while (eventIndex < input.trace.length && input.trace[eventIndex].tick <= target) {
    const action = input.trace[eventIndex++]
    await step(action.tick - ticks)
    if (action.type === 'keydown') await page.keyboard.down(action.key)
    else if (action.type === 'keyup') await page.keyboard.up(action.key)
    else {
      if (!touchSave && action.key === 'Space') touchSave = await page.evaluate(() => window.gameHost.snapshot())
      await page.keyboard.press(action.key)
    }
  }
  await step(target - ticks)
}
async function capture() {
  await presentFrame(page)
  return page.screenshot({ type: 'jpeg', quality: 86, timeout: 60000 })
}
async function touch(cdp, type, points) {
  touchTrace.push({ tick: ticks, type, points })
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 9, radiusY: 9, force: 1 })) })
}

try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  await setRenderCadence(page, 1000000)
  let desktopFrames
  if (touchOnly) {
    assert.equal(previousDesktop.sourceSha, sourceSha)
    assert.equal(previousDesktop.fps, fps)
    assert.equal(previousDesktop.sha256, createHash('sha256').update(await readFile(`${directory}/wobble-rally-preview.webm`)).digest('hex'))
    touchSave = JSON.parse(await readFile(`${directory}/touch-take-save.json`, 'utf8'))
    desktopFrames = previousDesktop.desktopFrames
    captures.push(...previousDesktop.captures)
  } else {
    startEncoding('wobble-rally-preview')
    const title = await capture()
    await page.screenshot({ path: `${directory}/title.png` })
    for (let i = 0; i < fps * 2; i++) await sendFrame(title)
    await page.frameLocator('iframe').locator('canvas').focus()
    await page.keyboard.press('Space')
    for (const [begin, end] of cuts) {
      console.log(`Capture native ticks ${begin}–${end}`)
      for (let tick = begin; tick < end; tick += frameTicks) {
        await advance(tick)
        await sendFrame(await capture())
        if ((tick - begin) % 120 === 0) console.log(JSON.stringify({ tick, encodedFrames: frames }))
      }
      const observation = await page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103] }))
      captures.push({ endTick: ticks, observation })
    }
    assert.equal(captures.at(-1).observation.game['1'].racers[0].finished, input.final.game['1'].racers[0].finished)
    assert.equal(captures.at(-1).observation.game['1'].order[0], 0)
    await page.screenshot({ path: `${directory}/finish.png` })
    await finishEncoding()
    desktopFrames = frames
    await writeFile(`${directory}/desktop.json`, JSON.stringify({ sourceSha, viewport, angle, fps, desktopFrames, captures,
      sha256: createHash('sha256').update(await readFile(`${directory}/wobble-rally-preview.webm`)).digest('hex') }, null, 2))
  }

  // A separate touch take begins at a naturally collected item from this race.
  assert.ok(touchSave, 'The race must contain a real collected item for the touch take')
  await writeFile(`${directory}/touch-take-save.json`, JSON.stringify(touchSave, null, 2))
  await page.setViewportSize({ width: 740, height: 420 })
  await page.evaluate(save => window.mountTestGame(save), touchSave)
  await setRenderCadence(page, 1000000)
  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: 'Back to the race' }).click()
  const centers = {}
  for (const [key, name] of [['a', 'Steer left'], ['d', 'Steer right'], ['use', 'Use power-up']]) {
    const box = await frame.getByRole('button', { name }).boundingBox()
    centers[key] = [box.x + box.width / 2, box.y + box.height / 2]
  }
  const cdp = await page.context().newCDPSession(page)
  startEncoding('wobble-rally-touch')
  let held = null, used = false
  const leftFrames = Math.ceil(fps * .3)
  const combinedFrame = Math.max(1, Math.ceil(6 / frameTicks) - 1)
  ticks = 0; frames = 0
  for (let i = 0; i < fps * 8; i++) {
    const observation = await page.evaluate(() => window.gameHost.observe({ entities: [100] }))
    const racer = observation.game['1'].racers[0], p = observation.scene.entities[0].transform.position
    let nearest = 0, best = Infinity
    track.samples.forEach((q, index) => {
      const d = (q.p[0] - p[0]) ** 2 + (q.p[2] - p[2]) ** 2
      if (d < best) { best = d; nearest = index }
    })
    const target = track.samples[(nearest + 7) % track.samples.length].p
    const angle = Math.atan2(target[0] - p[0], target[2] - p[2]) - racer.heading
    const error = Math.atan2(Math.sin(angle), Math.cos(angle))
    // Briefly hold left while using the item, then follow the course by touch.
    const next = i < leftFrames ? 'a' : Math.abs(error) < .085 ? null : error > 0 ? 'd' : 'a'
    if (i === leftFrames && used) {
      await touch(cdp, 'touchEnd', [])
      held = null
    }
    if (next !== held) {
      if (held) await touch(cdp, 'touchEnd', [])
      if (next) await touch(cdp, 'touchStart', [[1, ...centers[next]]])
      held = next
    }
    if (i === 1) {
      await touch(cdp, 'touchStart', [[1, ...centers[held]], [2, ...centers.use]])
      used = true
    }
    await step(frameTicks)
    if (i === combinedFrame) {
      const combined = await page.evaluate(() => window.gameHost.observe({ entities: [100, 450] }))
      assert.equal(combined.game['1'].controls.steer, -1)
      assert.equal(combined.game['1'].racers[0].item, null)
      assert.ok(combined.game['1'].racers[0].boostUntil > combined.game['1'].elapsed)
      captures.push({ take: 'touch', observation: combined })
    }
    await sendFrame(await capture())
  }
  if (held) await touch(cdp, 'touchEnd', [])
  await page.screenshot({ path: `${directory}/touch.png` })
  await finishEncoding()
  errors.push(...await page.evaluate(() => window.hostErrors))
  assert.deepEqual(errors, [])
  await writeFile(`${directory}/recording.json`, JSON.stringify({ sourceSha, runtime: JSON.parse(await readFile('pocketrealms.json', 'utf8')).runtime,
    browser: browser.version(), viewport, angle, fps, desktopFrames, desktopSeconds: desktopFrames / fps, touchSeconds: frames / fps,
    desktopRecovery: previousDesktop?.recoveryNotice || null,
    cuts: cuts.map(([begin, end]) => ({ beginTick: begin, endTick: end, beginSeconds: begin / 60, endSeconds: end / 60 })),
    notes: [`Actual Atlas frames from fixed-tick replay of recorded keyboard inputs; silent ${fps} FPS preview.`,
      'Desktop edit contains three selected race segments and a two-second title hold.',
      'Touch video is a separate take restored at a naturally collected item, using trusted browser multi-touch events.',
      'The capture browser disables its GPU watchdog to allow slow offline software rendering.',
      'Capture sampling does not measure real-time frame rate; use the separate performance report.'], captures, touchTrace, errors }, null, 2))
} catch (error) {
  errors.push(error.stack)
  await writeFile(`${directory}/capture-failure.json`, JSON.stringify({ sourceSha, ticks, frames, disconnected, errors, encoderLog }, null, 2))
  throw error
} finally {
  encoder?.kill('SIGTERM')
  await browser.close(); server.kill()
}
