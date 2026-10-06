import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { startServer } from './server.mjs'
import { setRenderCadence, presentFrame } from './render-cadence.mjs'
const recorded = JSON.parse(await readFile('evidence/shared-inputs/drive.json', 'utf8'))
const sourceSha = createHash('sha256').update(await readFile('scripts/main.js')).digest('hex')
assert.equal(sourceSha, recorded.sourceSha, 'Regenerate the full-race trace after changing gameplay')
assert.equal(createHash('sha256').update(await readFile('scene/scene.json')).digest('hex'), recorded.sceneSha,
  'Regenerate the trace after changing native scene configuration')
const server = await startServer()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 480, height: 300 } })
const checks = [], errors = []
page.on('pageerror', error => errors.push(error.message))
const step = n => page.evaluate(count => window.gameHost.step(count), n)
const observe = () => page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103] }))
const snapshot = () => page.evaluate(() => window.gameHost.snapshot())
const state = save => save.scripts.find(script => script.entity === 1).state
try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  await setRenderCadence(page)
  for (let run = 0; run < 4; run++) {
    await page.frameLocator('iframe').locator('canvas').focus()
    await page.keyboard.press('Space') // Title once, then the actual rematch control.
    let ticks = 0
    for (const action of recorded.trace) {
      if (action.tick > ticks) { await step(action.tick - ticks); ticks = action.tick }
      if (action.type === 'keydown') await page.keyboard.down(action.key)
      else if (action.type === 'keyup') await page.keyboard.up(action.key)
      else await page.keyboard.press(action.key)
    }
    while (ticks < recorded.final.ticks) {
      const count = Math.min(300, recorded.final.ticks - ticks)
      await step(count); ticks += count
    }
    await page.keyboard.up('a'); await page.keyboard.up('d')
    const observation = await observe()
    await presentFrame(page)
    assert.equal(observation.game['1'].phase, 'finished')
    assert.ok(observation.game['1'].racers.every(r => r.finished !== null))
    assert.deepEqual(observation.game['1'], recorded.final.game['1'])
    assert.deepEqual(JSON.parse(JSON.stringify(state(await snapshot()))), state(recorded.finalSave),
      'Full saved race, RNG, pickups, effects, camera and native motion must match')
    for (const body of observation.scene.entities) {
      const expected = recorded.final.scene.entities.find(e => e.id === body.id)
      // The recorded JSON normalizes IEEE negative zero. Compare the same JSON
      // representation while retaining exact positions and velocities.
      assert.ok(body.transform.position.every(Number.isFinite))
      assert.deepEqual(JSON.parse(JSON.stringify(body.transform)), expected.transform)
      assert.deepEqual(JSON.parse(JSON.stringify(body.rigidBody.linearVelocity)), expected.rigidBody.linearVelocity)
    }
    checks.push({ run, observation, rendering: await page.frames()[1].evaluate(() => window.testRendering) })
    console.log('PASS', run === 0 ? 'Fixed-seed input replay matches native motion and complete race state' : `Complete rematch ${run} matches without stale state`)
    if (run === 0) {
      const save = await snapshot()
      await writeFile('evidence/shared-inputs/finished-save.json', JSON.stringify(save, null, 2))
      await page.evaluate(value => window.mountTestGame(value), save)
      await setRenderCadence(page)
      assert.deepEqual(state(await snapshot()), state(save))
      console.log('PASS Finished result round-trips through a fresh sandbox')
    }
  }
  errors.push(...await page.evaluate(() => window.hostErrors))
  assert.deepEqual(errors, [])
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1 }
finally {
  await writeFile('evidence/shared-inputs/replay.json', JSON.stringify({ sourceSha, browser: browser.version(), checks, errors }, null, 2))
  await browser.close(); server.kill()
}
