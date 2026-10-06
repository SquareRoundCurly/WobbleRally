// Decode the delivered WebMs and extract representative frames for visual QA.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = 'evidence/recordings'
const record = JSON.parse(await readFile(`${root}/recording.json`, 'utf8'))
const ffmpeg = process.env.WOBBLE_FFMPEG || '/ms-playwright/ffmpeg-1011/ffmpeg-linux'
await mkdir(`${root}/review`, { recursive: true })
const results = []
for (const [name, seconds, times] of [
  ['wobble-rally-preview', record.desktopSeconds, [12, 22, 25, 32, 50, 65]],
  ['wobble-rally-touch', record.touchSeconds, [.1, 4, 7]],
]) {
  const path = `${root}/${name}.webm`
  const bytes = await readFile(path)
  const images = []
  let duration
  for (const time of times) {
    const image = `${root}/review/${name}-${String(time).replace('.', '-')}.png`
    const decoded = spawnSync(ffmpeg, ['-hide_banner', '-ss', String(time), '-i', path,
      '-frames:v', '1', '-y', image], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
    assert.equal(decoded.status, 0, decoded.stderr)
    const match = decoded.stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/)
    assert.ok(match, 'The finalized WebM must expose its duration')
    duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    assert.equal(duration, seconds)
    assert.match(decoded.stderr, new RegExp(`\\b${record.fps} fps`))
    const png = await readFile(image)
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    images.push({ time, path: image, width: png.readUInt32BE(16), height: png.readUInt32BE(20) })
  }
  results.push({ path, seconds: duration, fps: record.fps, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), frames: images })
}
await writeFile(`${root}/review.json`, JSON.stringify({ sourceSha: record.sourceSha,
  note: 'Representative frames decoded from the delivered WebMs for visual inspection; sampling is not a live performance benchmark.',
  results }, null, 2))
console.log('PASS Both recorded WebMs decode at all nine selected review timestamps')
