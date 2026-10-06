import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const types = { '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.html':'text/html', '.css':'text/css', '.gltf':'model/gltf+json' }
async function list(directory) {
  const result=[]
  for(const entry of await readdir(path.join(root,directory),{withFileTypes:true})) {
    const name=path.posix.join(directory,entry.name)
    if(entry.isDirectory()) result.push(...await list(name)); else result.push(name)
  }
  return result
}
const payloadNames = async () => ['game.json', 'inputs.json', ...await list('scene'), ...await list('scripts'), ...await list('assets')]
createServer(async(request,response)=>{
  try {
    let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname)
    if(name==='/') name='/tests/host.html'
    if(name==='/files.json') {
      response.writeHead(200,{'content-type':'application/json'})
      response.end(JSON.stringify(await payloadNames()))
      return
    }
    if(name==='/benchmark-build.json') {
      const files=Object.fromEntries(await Promise.all((await payloadNames()).sort().map(async name=>[
        name,createHash('sha256').update(await readFile(path.join(root,name))).digest('hex')
      ])))
      const config=JSON.parse(await readFile(path.join(root,'pocketrealms.json'),'utf8'))
      const probeSha256=createHash('sha256').update(await readFile(path.join(root,'tests/device-benchmark.mjs'))).digest('hex')
      response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'})
      response.end(JSON.stringify({module:config.module,version:config.version,runtime:config.runtime,probeSha256,files}))
      return
    }
    if(!/^\/(?:tests\/(?:host\.html|device-benchmark\.mjs)|\.runtime\/|pocketrealms\.json|game\.json|inputs\.json|scene\/|scripts\/|assets\/)/.test(name)) throw Error('Not found')
    const filename=path.resolve(root,'.'+name)
    if(!filename.startsWith(root+path.sep))throw Error('Not found')
    const bytes=await readFile(filename)
    response.writeHead(200,{'content-type':types[path.extname(filename)]||'application/octet-stream','cache-control':'no-store'})
    response.end(bytes)
  } catch {response.writeHead(404);response.end('Not found')}
}).listen(4194,'0.0.0.0',()=>console.log('Wobble Rally: http://localhost:4194'))
