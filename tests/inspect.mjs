import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { startServer } from './server.mjs'
const server = await startServer()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } })
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.log('PAGEERROR', error.message) })
page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE', message.text()) })
try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost, { timeout: 60000 })
  await page.evaluate(() => window.gameHost.ready)
  await page.screenshot({ path: 'evidence/shared-inputs/first-title.png' })
  const before = await page.evaluate(() => window.gameHost.observe({ entities: [0, 100, 101] }))
  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: "Let's race" }).click()
  await page.evaluate(() => window.gameHost.step(300))
  await page.screenshot({ path: 'evidence/shared-inputs/first-race.png' })
  const after = await page.evaluate(() => window.gameHost.observe({ entities: [0, 100, 101] }))
  await writeFile('evidence/shared-inputs/first-browser.json', JSON.stringify({ browser: browser.version(), before, after, errors }, null, 2))
  console.log(JSON.stringify({ browser: browser.version(), before: before.game, after: after.game, errors }))
} finally { await browser.close(); server.kill() }
