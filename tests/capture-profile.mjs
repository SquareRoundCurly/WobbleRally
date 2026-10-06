// Capture transport diagnostic only; this is not a live frame-rate benchmark.
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { startServer } from './server.mjs'
import { setRenderCadence, presentFrame } from './render-cadence.mjs'
const server = await startServer()
const softwareCompositor = Boolean(process.env.WOBBLE_SOFTWARE_COMPOSITOR)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
  ...(softwareCompositor ? ['--disable-gpu'] : [])] })
const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
const timings = []
try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(() => window.gameHost)
  await page.evaluate(() => window.gameHost.ready)
  await setRenderCadence(page, 1000000)
  const cdp = await page.context().newCDPSession(page)
  for (const viewport of [{ width: 960, height: 600 }, { width: 640, height: 400 }]) {
    await page.setViewportSize(viewport)
    for (const method of ['playwright', 'cdp']) {
      const start = Date.now()
      await presentFrame(page)
      const rendered = Date.now()
      if (method === 'playwright') await page.screenshot({ type: 'jpeg', quality: 86 })
      else await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, captureBeyondViewport: false, optimizeForSpeed: true })
      const timing = { viewport, method, renderMs: rendered - start, captureMs: Date.now() - rendered }
      timings.push(timing); console.log(timing)
    }
  }
} finally {
  await writeFile(`evidence/capture-profile${softwareCompositor ? '-software-compositor' : ''}.json`, JSON.stringify({ diagnostic: true, softwareCompositor, timings }, null, 2))
  await browser.close(); server.kill()
}
