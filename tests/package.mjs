// Load the exact ZIP bytes through the public browser host, independently of
// the working-tree payload. Python's standard library only reads the archive.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { startServer } from './server.mjs'

const project = JSON.parse(await readFile('pocketrealms.json', 'utf8'))
const releasePath = `dist/${project.module}-${project.version}`
const release = JSON.parse(await readFile(`${releasePath}.json`, 'utf8'))
const archive = await readFile(`${releasePath}.zip`)
assert.equal(createHash('sha256').update(archive).digest('hex'), release.archive_digest)
const files = JSON.parse(execFileSync('python3', ['-c',
  "import base64,json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))", `${releasePath}.zip`],
  { maxBuffer: 16 * 1024 * 1024 }).toString())
const manifest = JSON.parse(Buffer.from(files['pocketrealms.package.json'], 'base64'))
delete files['pocketrealms.package.json']
const server = await startServer()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 740, height: 420 } })
const errors = [], requested = new Set()
const contactSamples = [], contacted = new Set()
page.on('pageerror', error => errors.push(error.message))
let observation
try {
  await page.route('http://127.0.0.1:4194/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1)
    if (name === 'files.json') return route.fulfill({ json: Object.keys(files) })
    if (name === 'pocketrealms.json') return route.fulfill({ json: { runtime: manifest.runtime } })
    if (Object.hasOwn(files, name)) {
      requested.add(name)
      return route.fulfill({ body: Buffer.from(files[name], 'base64'), contentType: 'application/octet-stream' })
    }
    return route.continue()
  })
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  assert.deepEqual([...requested].sort(), Object.keys(files).sort())
  await page.frameLocator('iframe').getByRole('button', { name: "Let's race" }).click()
  await page.evaluate(() => window.gameHost.step(180))
  for (let sample = 0; sample < 5; sample++) {
    await page.evaluate(() => window.gameHost.step(30))
    const observed = await page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103] }))
    contactSamples.push(observed)
    for (const body of observed.scene.entities) if (body.physics.contacts.length) contacted.add(body.id)
  }
  observation = await page.evaluate(() => window.gameHost.observe({ entities: [100, 101, 102, 103, 10, 200, 201, 202, 203] }))
  assert.equal(observation.game['1'].phase, 'racing')
  assert.equal(observation.game['1'].racers.length, 4)
  assert.ok(observation.game['1'].racers.every(racer => racer.distance > -6))
  // A kart can briefly hop during a bump. Require physical contacts over a
  // window of native ticks, rather than continuous grounding at one instant.
  assert.deepEqual([...contacted].sort(), [100, 101, 102, 103])
  await page.screenshot({ path: 'evidence/shared-inputs/packaged-game.png', timeout: 30000 })
  errors.push(...await page.evaluate(() => window.hostErrors))
  assert.deepEqual(errors, [])
  console.log(`PASS Validated release ZIP loads all ${Object.keys(files).length} payload files and races in the public browser host`)
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1 }
finally {
  await writeFile('evidence/shared-inputs/package-browser.json', JSON.stringify({ release, browser: browser.version(), loadedFiles: [...requested], observation, contactSamples, errors }, null, 2))
  await browser.close(); server.kill()
}
