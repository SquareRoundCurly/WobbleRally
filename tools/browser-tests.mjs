import { spawn } from 'node:child_process'
const requested = process.argv.slice(2)
for (const name of requested.length ? requested : ['browser', 'items', 'drive', 'replay']) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/${name}.mjs`], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) process.exit(code || 1)
}
