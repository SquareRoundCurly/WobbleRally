import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const { runtime: { build } } = JSON.parse(await readFile(path.join(root, 'pocketrealms.json')))
if (!/^[a-f0-9]{64}$/.test(build)) throw new Error('Pin a supported Atlas runtime in pocketrealms.json')
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const base = `https://pocketrealms.ai/runtimes/${build}/`
async function download(name) {
  const response = await fetch(base + name)
  if (!response.ok) throw new Error(`Runtime download ${name}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
const raw = await download('runtime.json')
const manifest = JSON.parse(raw)
if (manifest.build !== build || sha256(JSON.stringify(manifest.files)) !== build) throw new Error('Runtime manifest checksum failed')
const directory = path.join(root, '.runtime', build)
await mkdir(directory, { recursive: true })
for (const file of manifest.files) {
  if (!['runtime.js','runtime.css','host.js','test-runtime.js','THIRD_PARTY_NOTICES.md','inputs.d.ts','INPUTS.md'].includes(file.path)) throw new Error('Unexpected runtime artifact')
  const bytes = await download(file.path)
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error('Runtime file checksum failed')
  await writeFile(path.join(directory, file.path), bytes)
}
await writeFile(path.join(directory, 'runtime.json'), raw)
console.log(`Verified Atlas runtime ${build}`)
