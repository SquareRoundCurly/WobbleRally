import { spawn } from 'node:child_process'
export async function startServer() {
  const server = spawn(process.execPath, ['tools/server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.kill(); reject(Error('Game test server did not start')) }, 10000)
    server.stdout.on('data', data => { if (String(data).includes('Wobble Rally:')) { clearTimeout(timer); resolve() } })
    server.on('error', error => { clearTimeout(timer); reject(error) })
    server.once('exit', code => { clearTimeout(timer); reject(Error(`Game test server exited: ${code}`)) })
  })
  return server
}
