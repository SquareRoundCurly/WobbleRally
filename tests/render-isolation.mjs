// Diagnostic only: isolate rendering from gameplay with native visibility masks.
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { startServer } from './server.mjs'
const server=await startServer()
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader']})
const page=await browser.newPage({viewport:{width:640,height:400}})
const results=[]
try {
  await page.goto('http://127.0.0.1:4194/?controlled');await page.waitForFunction(()=>window.gameHost);await page.evaluate(()=>window.gameHost.ready)
  const frame=page.frames()[1]
  const entities=await frame.evaluate(()=>JSON.parse(atlas.getSceneSource()).entities.filter(e=>e.model||e.drawable))
  for(const mode of ['full-title','sky-only','world-only']){
    await frame.evaluate(({mode,entities})=>{
      document.querySelector('#rally-ui').style.display='none'
      for(const original of entities){const e=atlas.getEntity(original.id);e.canvas.bitmask=mode==='full-title'?original.canvas.bitmask:mode==='sky-only'?(e.id===11?2:0):[10,11].includes(e.id)?2:0;atlas.setEntity(e)}
    },{mode,entities})
    await page.evaluate(()=>window.gameHost.resume())
    const sample=await frame.evaluate(()=>new Promise(resolve=>{
      const frames=[];const start=performance.now();let previous=start
      const record=now=>{frames.push(now-previous);previous=now;if(now-start<4000)requestAnimationFrame(record);else resolve(frames)}
      requestAnimationFrame(record)
    }))
    await page.evaluate(()=>window.gameHost.pause())
    const result={mode,meanFps:sample.length*1000/sample.reduce((a,b)=>a+b),frames:sample};results.push(result);console.log(mode,result.meanFps)
  }
}finally{await writeFile('evidence/render-isolation.json',JSON.stringify({diagnostic:true,results},null,2));await browser.close();server.kill()}
