// Local preview instrumentation, excluded from the published module. The probe
// observes ordinary animation frames inside the sandbox; it never steps the
// simulation, alters input, resizes the canvas, or changes rendering cadence.
function frameProbe(token) {
  let start = null, previous = null, lastProgress = -1, startState, dimensions
  let frameMs = [], interruptions = 0, completed = false
  let previousRaceTime = null, clockChangedAt = 0
  const send = (kind, data = {}) => parent.postMessage({ type: 'wobble.device-benchmark', token, kind, ...data }, '*')
  const nativeState = () => ({
    elapsed: race.elapsed,
    racers: [0, 1, 2, 3].map(id => ({ id,
      position: gameContext.getEntity(100 + id).transform.position,
      progress: race.racers[id].distance,
    })),
  })
  const surface = () => {
    const canvas = document.querySelector('canvas')
    return canvas ? [canvas.width, canvas.height] : [0, 0]
  }
  const reset = reason => {
    if (start !== null) { interruptions++; send('interrupted', { reason, interruptions }) }
    start = previous = null; frameMs = []; lastProgress = -1
  }
  const sample = now => {
    if (completed) return
    if (race?.elapsed !== previousRaceTime) { previousRaceTime = race?.elapsed; clockChangedAt = now }
    const clockStalled = now - clockChangedAt > 750
    const racing = race?.phase === 'racing' && race.elapsed >= 2 && !document.hidden && !clockStalled
    const size = surface()
    if (!racing) reset('The race paused, stopped advancing, or became hidden. Resume to restart the measurement.')
    else if (start !== null && (size[0] !== dimensions[0] || size[1] !== dimensions[1])) {
      reset('The viewport changed. Keep this orientation for the next measurement.')
    } else if (start === null) {
      start = previous = now; dimensions = size; startState = nativeState()
      send('started')
    } else {
      frameMs.push(now - previous); previous = now
      const elapsed = now - start
      const second = Math.floor(elapsed / 1000)
      if (second !== lastProgress) {
        lastProgress = second
        send('progress', { seconds: Math.min(30, second), fps: frameMs.length * 1000 / elapsed })
      }
      if (elapsed >= 30000) {
        completed = true
        const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2')
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
        const sorted = [...frameMs].sort((a, b) => a - b)
        send('complete', { result: {
          measuredAt: new Date().toISOString(), durationMs: elapsed, frames: frameMs.length,
          meanFps: frameMs.length * 1000 / elapsed,
          frameMsP50: sorted[Math.floor(sorted.length * .5)],
          frameMsP95: sorted[Math.floor(sorted.length * .95)], frameMs,
          renderer, softwareRenderer: /swiftshader|llvmpipe|softpipe|software/i.test(renderer),
          viewport: { width: dimensions[0], height: dimensions[1], devicePixelRatio },
          userAgent: navigator.userAgent, logicalCpus: navigator.hardwareConcurrency,
          interruptions, startState, endState: nativeState(),
          simulationRate: (race.elapsed - startState.elapsed) / (elapsed / 1000),
          note: 'Thirty continuous seconds of live sandbox requestAnimationFrame cadence after two simulation seconds of racing warm-up. No fixed stepping or render-cadence overrides.',
        } })
      }
    }
    if (!completed) requestAnimationFrame(sample)
  }
  // Visibility changes must invalidate even when rAF stops while the tab hides.
  document.addEventListener('visibilitychange', () => { if (!completed && document.hidden) reset('The page became hidden.') })
  requestAnimationFrame(sample)
}

export async function installDeviceBenchmark({ sources, container, deviceClass }) {
  const build = await (await fetch('/benchmark-build.json')).json()
  const token = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
  const original = new TextDecoder().decode(sources.get('scripts/main.js'))
  sources.set('scripts/main.js', new TextEncoder().encode(`${original}\n;(${frameProbe.toString()})(${JSON.stringify(token)});\n`))
  const style = document.createElement('style')
  style.textContent = `#device-benchmark{position:fixed;z-index:10;left:50%;bottom:116px;transform:translateX(-50%);width:min(350px,calc(100% - 32px));box-sizing:border-box;padding:10px 12px;background:#fff5e3;border:1px solid #294c53;border-radius:12px;font:12px/1.4 system-ui;color:#294c53}#device-benchmark strong{display:block}#device-benchmark label{display:flex;align-items:center;gap:7px;margin:5px 0}#device-benchmark input{width:100%;min-width:0;padding:4px;font:inherit}#device-benchmark button{font:inherit;padding:5px 10px;margin-top:5px;cursor:pointer}#device-benchmark[data-running=true] label{display:none}@media(max-width:500px){#device-benchmark{bottom:auto;top:max(86px,env(safe-area-inset-top))}}`
  document.head.append(style)
  style.textContent += `#device-benchmark[data-running=true]{top:max(12px,env(safe-area-inset-top));bottom:auto;width:230px}@media(min-width:501px) and (max-width:700px){#device-benchmark[data-running=true]{width:180px}}@media(max-width:500px){#device-benchmark[data-running=true]{top:max(86px,env(safe-area-inset-top));width:calc(100% - 32px)}}`
  const panel = document.createElement('section')
  panel.id = 'device-benchmark'
  panel.setAttribute('aria-label', 'Device benchmark')
  panel.innerHTML = `<strong>${deviceClass === 'phone' ? 'Phone · 30 FPS target' : 'Desktop · 60 FPS target'}</strong><label>Device <input id="benchmark-device" placeholder="Device model and browser" maxlength="120"></label><div id="benchmark-status" role="status">Start the race and play normally. Measurement begins after Go and a short warm-up.</div><button id="benchmark-download" hidden>Download result</button>`
  document.body.append(panel)
  const status = panel.querySelector('#benchmark-status')
  const download = panel.querySelector('#benchmark-download')
  const label = panel.querySelector('#benchmark-device')
  let result
  window.addEventListener('message', event => {
    if (event.source !== container.querySelector('iframe')?.contentWindow
        || event.data?.type !== 'wobble.device-benchmark' || event.data.token !== token) return
    const data = event.data
    if (data.kind === 'started') panel.dataset.running = 'true'
    if (data.kind === 'interrupted') {
      panel.dataset.running = 'false'; status.textContent = data.reason
    }
    if (data.kind === 'progress') status.textContent = `Measuring ${data.seconds}/30 seconds · ${data.fps.toFixed(1)} FPS`
    if (data.kind === 'complete') {
      panel.dataset.running = 'false'
      result = { format: 'wobble-device-benchmark-v1', deviceClass, targetFps: deviceClass === 'phone' ? 30 : 60,
        build, instrumentation: 'An observational rAF probe is appended only in this local benchmark preview. Published payload files are unchanged.', ...data.result }
      window.deviceBenchmarkResult = result
      status.textContent = `${result.meanFps.toFixed(1)} FPS · ${result.viewport.width}×${result.viewport.height}${result.softwareRenderer ? ' · software rendering' : ''}. Name the device and download the result. Reload to repeat.`
      download.hidden = false
    }
  })
  download.addEventListener('click', () => {
    if (!result) return
    if (!label.value.trim()) { label.setCustomValidity('Enter the device model and browser.'); label.reportValidity(); return }
    const record = { ...result, deviceLabel: label.value.trim() }
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `wobble-benchmark-${deviceClass}-${record.measuredAt.replace(/[:.]/g, '-')}.json`
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  label.addEventListener('input', () => label.setCustomValidity(''))
}
