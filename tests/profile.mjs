import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { startServer } from './server.mjs'
const server = await startServer()
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page = await browser.newPage({viewport:{width:640,height:400}})
if(process.env.NO_MSAA)await page.addInitScript(()=>{
  const original=HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext=function(kind,options){return original.call(this,kind,kind==='webgl2'?{...options,antialias:false}:options)}
})
try {
  await page.goto('http://127.0.0.1:4194/?controlled')
  await page.waitForFunction(()=>window.gameHost)
  await page.evaluate(()=>window.gameHost.ready)
  const frame=page.frames()[1]
  const cdp=await page.context().newCDPSession(page)
  const surface=await frame.evaluate(()=>{const c=document.querySelector('canvas');return {width:c.width,height:c.height,dpr:devicePixelRatio,attributes:c.getContext('webgl2').getContextAttributes()}})
  console.log('surface',surface)
  const timings=[]
  const measure=async(name,fn)=>{const start=Date.now();await fn();timings.push({name,ms:Date.now()-start});console.log(timings.at(-1))}
  await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
  await measure('title-render',()=>page.evaluate(()=>window.gameHost.step(0)))
  await measure('title-60-ticks',()=>page.evaluate(()=>window.gameHost.step(60)))
  await page.frameLocator('iframe').locator('canvas').focus();await page.keyboard.press('Space')
  await measure('countdown-180-ticks',()=>page.evaluate(()=>window.gameHost.step(180)))
  await measure('race-60-ticks',()=>page.evaluate(()=>window.gameHost.step(60)))
  const {profile}=await cdp.send('Profiler.stop')
  for (const node of profile.nodes) if(node.callFrame.url.startsWith('data:')) node.callFrame.url='atlas.wasm'
  console.log(profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,15).map(n=>({function:n.callFrame.functionName,hits:n.hitCount,url:n.callFrame.url.slice(0,70)})))
  await writeFile(process.env.NO_MSAA?'evidence/profile-no-msaa.json':'evidence/profile.json',JSON.stringify({surface,timings,profile}))
} finally {await browser.close();server.kill()}
