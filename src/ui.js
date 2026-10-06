let uiRoot = null
let uiStyle = null
let uiController = null
let audio = null
let muted = false
const ITEM_ICONS = ['🥤', '🪿', '🍮']

function focusCanvas() { if (typeof document !== 'undefined') document.querySelector('canvas')?.focus() }
function uiAudio() {
  if (typeof window === 'undefined') return
  const Audio = window.AudioContext || window.webkitAudioContext
  if (!Audio) return
  audio ||= new Audio()
  if (audio.state === 'suspended') audio.resume().catch(() => {})
}
function uiBeep(kind) {
  if (!audio || muted || audio.state !== 'running') return
  const notes = { count: [360], use: [440, 620], pickup: [520, 780], honk: [220, 180], bonk: [100, 75], lap: [440, 554, 660], finish: [523, 659, 784, 1046] }[kind] || [400]
  notes.forEach((frequency, i) => {
    const oscillator = audio.createOscillator(), gain = audio.createGain(), time = audio.currentTime + i * 0.11
    oscillator.type = kind === 'honk' ? 'sawtooth' : 'sine'
    oscillator.frequency.setValueAtTime(frequency, time)
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.07, time + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18)
    oscillator.connect(gain); gain.connect(audio.destination)
    oscillator.start(time); oscillator.stop(time + 0.2)
  })
}

function mountUi() {
  if (typeof document === 'undefined') return
  disposeUi()
  uiController = new AbortController()
  const on = (node, type, callback, options = {}) => node.addEventListener(type, callback, { ...options, signal: uiController.signal })
  uiStyle = document.createElement('style')
  uiStyle.textContent = `
    *{box-sizing:border-box}body{overscroll-behavior:none}#rally-ui{position:fixed;inset:0;pointer-events:none;color:#283e49;font-family:ui-rounded,'Arial Rounded MT Bold',system-ui,sans-serif;user-select:none;-webkit-user-select:none}
    #rally-ui button{font:inherit;cursor:pointer;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;color:inherit;border:0}
    #rally-ui button:focus-visible{outline:3px solid #517b9e;outline-offset:5px}.r-top{position:absolute;top:max(22px,env(safe-area-inset-top));left:max(25px,env(safe-area-inset-left));right:max(25px,env(safe-area-inset-right));display:flex;justify-content:space-between;align-items:flex-start;gap:15px}
    .r-brand{font-size:13px;font-weight:950;letter-spacing:2px;display:flex;align-items:center;gap:9px}.r-brand i{display:inline-block;width:15px;height:15px;background:#ef8992;border:3px solid #fff2d9;border-radius:5px;transform:rotate(-14deg)}
    .r-sub{font-size:11px;letter-spacing:2px;font-weight:750;opacity:.6;margin:5px 0 0 25px}.r-card{background:#fff5e3ef;border:1px solid #fff9ee;border-radius:20px;padding:12px 19px;box-shadow:0 4px 0 #35494b20,0 7px 30px #3142410d;backdrop-filter:blur(8px)}
    .r-stats{display:flex;gap:18px;align-items:center}.r-rank{font-size:41px;line-height:1;font-weight:950;letter-spacing:-3px}.r-rank small{font-size:17px;letter-spacing:0;margin-left:4px;opacity:.5}.r-line{width:1px;height:34px;background:#d5c9b2}.r-label{font-size:10px;letter-spacing:1.5px;font-weight:900;opacity:.65}.r-value{font-size:19px;font-weight:900;margin-top:2px;font-variant-numeric:tabular-nums}.r-time{display:flex;gap:14px;align-items:center}.r-round{width:39px;height:39px;border-radius:50%;background:#e8e6d4!important;font-size:16px!important}.r-hud{display:none}
    .r-controls{position:absolute;left:max(26px,env(safe-area-inset-left));right:max(26px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));display:flex;justify-content:space-between;align-items:flex-end}.r-steering{display:flex;gap:13px}.r-control{height:82px;min-width:88px;padding:0 22px;border-radius:25px;background:#fff5e3f2;box-shadow:0 5px 0 #33484d42,0 8px 24px #283f3d15;transition:transform .08s}.r-control:active,.r-control[data-held=true]{transform:translateY(4px);box-shadow:0 1px 0 #33484d42;background:#edc575}.r-arrow{font-size:37px;line-height:1;font-weight:950}.r-key{font-size:10px;letter-spacing:1px;margin-top:4px;font-weight:850;opacity:.55}.r-use{min-width:155px;background:#efb6b0;display:flex;align-items:center;gap:13px;text-align:left}.r-use[data-ready=true]{background:#f4ce76}.r-use-icon{font-size:33px;line-height:1}.r-use-label{font-size:14px;font-weight:950}.r-use-hint{font-size:10px;letter-spacing:.7px;opacity:.65;margin-top:5px}.r-controls[hidden]{display:none}
    .r-message{position:absolute;top:130px;left:50%;transform:translateX(-50%);font-size:15px;font-weight:850;background:#fff3dbea;padding:11px 22px;border-radius:30px;white-space:nowrap;box-shadow:0 3px 0 #33484d1c}.r-message:empty{display:none}.r-countdown{position:absolute;top:35%;left:50%;transform:translate(-50%,-50%) rotate(-8deg);font-size:128px;font-weight:1000;color:#fff0d0;text-shadow:5px 7px 0 #df777e;letter-spacing:-7px}.r-countdown:empty{display:none}
    .r-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-start;padding:6vw;background:linear-gradient(90deg,#fff0d8f5 0%,#fff0d8e3 20%,#fff0d873 49%,transparent 72%)}.r-overlay[hidden]{display:none}.r-copy{max-width:440px}.r-eyebrow{display:inline-flex;gap:9px;align-items:center;padding:9px 14px;background:#f8dab4;border-radius:30px;font-size:10px;letter-spacing:2px;font-weight:950}.r-eyebrow::before{content:'✦';font-size:14px;color:#c75b69}.r-title{margin:20px 0 15px;font-weight:1000;font-size:clamp(58px,7.7vw,106px);line-height:.82;letter-spacing:-6px;transform:rotate(-4deg);text-shadow:3px 5px 0 #fff4da}.r-title span{display:block;color:#d66f7d;font-size:1.11em;margin:4px 0 0 14px}.r-description{font-size:16px;line-height:1.55;max-width:300px;margin:26px 0;color:#516265;font-weight:550}.r-primary{padding:18px 28px;background:#2e5258;color:#fff3d9!important;border-radius:18px;box-shadow:0 5px 0 #183d45;font-size:17px!important;font-weight:850!important;display:flex;gap:30px;align-items:center}.r-primary:active{transform:translateY(3px);box-shadow:0 2px 0 #183d45}.r-instruction{font-size:11px;line-height:1.8;color:#596766;margin-top:20px}.r-instruction b{background:#fff6e8;border:1px solid #d7cdb9;border-radius:5px;padding:3px 6px;margin:0 2px}.r-footer{position:absolute;bottom:25px;left:6vw;font-size:10px;font-weight:750;letter-spacing:2px;color:#6f7b74}.r-result{font-size:19px;line-height:1.8;font-weight:700;margin:18px 0}.r-map{width:144px;height:105px;opacity:.9;margin-bottom:3px}.r-map path{fill:none;stroke:#fff0d2;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}.r-map circle{stroke:#334f53;stroke-width:2}.r-map text{font-size:9px;fill:#294b51;font-weight:800;letter-spacing:1px}
    @media(max-width:700px){.r-top{top:14px;left:14px;right:14px}.r-brand{font-size:10px;letter-spacing:1px}.r-sub{font-size:9px}.r-card{padding:8px 12px;border-radius:15px}.r-rank{font-size:31px}.r-stats{gap:11px}.r-value{font-size:15px}.r-time{gap:8px}.r-controls{left:16px;right:16px;bottom:max(16px,env(safe-area-inset-bottom))}.r-control{height:71px;min-width:72px;padding:0 16px;border-radius:22px}.r-steering{gap:9px}.r-use{min-width:126px;gap:7px}.r-use-label{font-size:11px}.r-map{display:none}.r-title{font-size:75px}.r-message{top:100px;font-size:12px;max-width:90%;white-space:normal;text-align:center}.r-description{font-size:14px;max-width:250px}.r-key{font-size:9px}}
    @media(max-height:520px){.r-overlay{padding:3vh 7vw}.r-title{font-size:66px;margin:14px 0 0}.r-description{margin:15px 0;font-size:13px}.r-eyebrow{font-size:9px;padding:5px 10px}.r-primary{padding:12px 22px}.r-instruction{margin-top:13px;font-size:10px}.r-footer{display:none}.r-controls{bottom:12px}.r-control{height:63px;min-width:77px}.r-use{min-width:144px}.r-top{top:12px}.r-countdown{font-size:94px}.r-message{top:85px}.r-map{height:85px;width:118px}}
  `
  uiStyle.textContent += `
    #rally-ui .atlas-input{--input-background:#fff5e3f2;--input-foreground:#283e49;--input-accent:#edc575;--input-radius:25px;font:inherit;font-weight:850;border:0;box-shadow:0 5px 0 #33484d42,0 8px 24px #283f3d15}
    .r-steering .atlas-input,#r-use .atlas-input{height:82px;width:88px;padding:12px}.r-steering .atlas-input-label{font-size:10px}.r-steering .atlas-input-icon{font-size:33px}#r-use .atlas-input{width:155px;--input-background:#efb6b0}#r-use[data-ready=true] .atlas-input{--input-background:#f4ce76}#r-use .atlas-input-label{font-size:12px}#r-use .atlas-input-icon{font-size:28px}.r-use-wrap{position:relative}#r-item-name{position:absolute;bottom:94px;left:0;right:0;text-align:center;font-size:11px;font-weight:850}
    #r-start .atlas-input{width:auto;min-width:200px;min-height:65px;--input-background:#2e5258;--input-foreground:#fff3d9;--input-radius:18px;display:grid;grid-template-columns:1fr auto;column-gap:26px;padding:14px 22px;box-shadow:0 5px 0 #183d45}#r-start .atlas-input-label{grid-column:1;grid-row:1;font-size:17px}#r-start .atlas-input-icon{grid-column:2;grid-row:1}#r-start .atlas-input-hint{grid-column:1/3;grid-row:2;text-align:left;justify-self:start}
    #r-mute .atlas-input,#r-pause .atlas-input{width:39px;min-height:39px;height:39px;padding:6px;--input-background:#e8e6d4;--input-radius:50%;box-shadow:none}#r-mute .atlas-input-label,#r-pause .atlas-input-label,#r-mute kbd,#r-pause kbd{display:none}#r-mute .atlas-input-icon,#r-pause .atlas-input-icon{font-size:17px}
    @media(max-width:700px){.r-steering .atlas-input{width:72px;height:71px}.r-steering{gap:9px}#r-use .atlas-input{width:126px;height:71px}#r-item-name{bottom:81px}}
    @media(max-width:330px){.r-controls{left:8px;right:8px;flex-wrap:wrap;gap:16px}.r-steering .atlas-input{width:56px;height:64px;padding:7px}.r-steering{gap:6px}#r-use .atlas-input{width:100px;height:64px;padding:7px}.r-steering .atlas-input-label,#r-use .atlas-input-label{font-size:8px}#r-item-name{bottom:74px}}
    @media(max-height:520px){.r-steering .atlas-input,#r-use .atlas-input{height:63px}#r-item-name{bottom:73px}#r-start .atlas-input{min-height:54px;padding:10px 18px}}
  `
  document.head.append(uiStyle)
  uiStyle.textContent += `.r-celebration{position:absolute;inset:0;overflow:hidden;pointer-events:none}.r-celebration[hidden]{display:none}.r-celebration i{position:absolute;left:var(--x);top:-20px;width:8px;height:14px;background:var(--color);border-radius:2px;animation:r-confetti 2.8s var(--delay) ease-out both}@keyframes r-confetti{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(85vh) rotate(490deg);opacity:0}}`
  uiRoot = document.createElement('div'); uiRoot.id = 'rally-ui'
  const mapPath = TRACK.samples.filter((_, i) => i % 4 === 0).map((p, i) => `${i ? 'L' : 'M'}${(p.p[0] * 0.64 + 72).toFixed(1)},${(p.p[2] * 0.64 + 48).toFixed(1)}`).join(' ') + 'Z'
  uiRoot.innerHTML = `<div class="r-top"><div id="r-brand"><div class="r-brand"><i></i>WOBBLE RALLY</div><div class="r-sub">PICNIC LOOP</div></div><div class="r-card r-stats r-hud" id="r-stats"><div class="r-rank"><span id="r-position">4</span><small>/ 4</small></div><div class="r-line"></div><div><div class="r-label">LAP</div><div class="r-value" id="r-lap">1 / 3</div></div></div><div class="r-card r-time"><div class="r-hud" id="r-timer"><div class="r-label">RACE TIME</div><div class="r-value" id="r-clock">0:00.0</div></div><div id="r-mute"></div><div class="r-hud" id="r-pause"></div></div></div>
    <div class="r-message" id="r-message"></div><div class="r-countdown" id="r-countdown"></div>
    <div class="r-controls" id="r-controls" hidden><div class="r-steering" id="r-steering"></div><svg class="r-map" viewBox="0 0 144 106" aria-label="Course positions"><path d="${mapPath}"/>${[0,1,2,3].map(i => `<circle id="r-dot-${i}" r="4.5" fill="${DRIVER_COLORS[i]}"/>`).join('')}<text x="72" y="102" text-anchor="middle">PICNIC LOOP</text></svg><div class="r-use-wrap"><div id="r-item-name"></div><div id="r-use"></div></div></div>
    <div class="r-overlay" id="r-overlay"><div class="r-copy"><div class="r-eyebrow" id="r-eyebrow">THE PICNIC CUP</div><h1 class="r-title" id="r-title">Wobble<span>Rally.</span></h1><p class="r-description" id="r-description">Tiny karts. Big picnic energy.<br>Three rivals. One very silly goose.</p><div class="r-result" id="r-result" hidden></div><div id="r-start"></div><div class="r-instruction" id="r-instruction">Steer with <b>A</b> <b>D</b> &nbsp; Use your item with <b>SPACE</b><br>On your phone? Three buttons. Both thumbs. Go.</div></div><div class="r-footer">ONE TRACK · THREE LAPS · ZERO SERIOUSNESS</div></div>`
  document.body.append(uiRoot)
  const celebration = document.createElement('div')
  celebration.id = 'r-celebration'; celebration.className = 'r-celebration'; celebration.hidden = true
  celebration.innerHTML = Array.from({length:24}, (_,i) => `<i style="--x:${i*4.2}%;--delay:${(i%5)*.12}s;--color:${DRIVER_COLORS[i%4]}"></i>`).join('')
  uiRoot.append(celebration)
  const $ = id => uiRoot.querySelector('#' + id)
  gameContext.input.scope(uiRoot)
  for (const [slot, ids] of [['r-steering', ['left', 'right']], ['r-use', ['use']], ['r-start', ['start']], ['r-pause', ['pause']], ['r-mute', ['mute']]]) {
    gameContext.input.mount($(slot), { ids })
  }
  on(window, 'blur', pauseRace)
  on(document, 'visibilitychange', () => { if (document.hidden) pauseRace() })
}

function updateUi() {
  if (!uiRoot || !race) return
  const $ = id => uiRoot.querySelector('#' + id)
  const player = race.racers[0]
  const overlay = ['title', 'paused', 'finished'].includes(race.phase)
  const time = player.finished ?? race.elapsed
  const clock = `${Math.floor(time / 60)}:${(time % 60).toFixed(1).padStart(4, '0')}`
  $('r-overlay').hidden = !overlay
  $('r-celebration').hidden = race.phase !== 'finished'
  $('r-controls').hidden = overlay
  for (const id of ['left', 'right']) gameContext.input.present(id, { enabled: !overlay })
  gameContext.input.present('start', { visible: overlay })
  gameContext.input.present('pause', { visible: !overlay })
  $('r-instruction').textContent = `Steer with ${gameContext.input.info('left').hints.join(' / ')} and ${gameContext.input.info('right').hints.join(' / ')}. Use your item with ${gameContext.input.info('use').hints.join(' / ')}. On your phone? Three buttons. Both thumbs. Go.`
  $('r-brand').style.display = race.phase === 'title' ? 'block' : 'none'
  $('r-stats').style.display = race.phase === 'title' ? 'none' : 'flex'
  $('r-timer').style.display = race.phase === 'title' ? 'none' : 'block'
  $('r-pause').style.display = race.phase === 'racing' || race.phase === 'countdown' ? 'block' : 'none'
  $('r-position').textContent = standings().findIndex(r => r.id === 0) + 1
  $('r-lap').textContent = `${Math.min(3, player.lap + 1)} / 3`
  $('r-clock').textContent = clock
  $('r-countdown').textContent = race.phase === 'countdown' ? Math.max(1, Math.ceil(race.countdown)) : ''
  $('r-message').textContent = !overlay && race.messageUntil > race.elapsed ? race.message : ''
  gameContext.input.present('use', { icon: player.item === null ? '✦' : ITEM_ICONS[player.item], enabled: !overlay })
  $('r-item-name').textContent = player.item === null ? 'Find a surprise' : ITEM_NAMES[player.item]
  $('r-use').dataset.ready = String(player.item !== null)
  for (const racer of race.racers) {
    const dot = $('r-dot-' + racer.id)
    dot.setAttribute('cx', racer.p[0] * 0.64 + 72); dot.setAttribute('cy', racer.p[2] * 0.64 + 48)
  }
  if (overlay) {
    $('r-instruction').hidden = race.phase !== 'title'
    $('r-result').hidden = race.phase !== 'finished'
    if (race.phase === 'paused') {
      $('r-eyebrow').textContent = 'TAKE A BREATHER'
      $('r-title').innerHTML = 'Picnic<span>break.</span>'
      $('r-description').textContent = 'Your goose can wait. The race is paused.'
      gameContext.input.present('start', { label: 'Back to the race' })
    } else if (race.phase === 'finished') {
      const position = standings().findIndex(r => r.id === 0) + 1
      $('r-eyebrow').textContent = 'PICNIC CUP · COMPLETE'
      $('r-title').innerHTML = position === 1 ? 'Sweet<span>victory!</span>' : 'Good<span>racing!</span>'
      $('r-description').textContent = position === 1 ? 'You brought the speed. And the snacks.' : 'There is always room for one more lap.'
      $('r-result').textContent = `${position}${['st', 'nd', 'rd', 'th'][position - 1]} place · ${clock}`
      gameContext.input.present('start', { label: 'Race again' })
    } else {
      $('r-eyebrow').textContent = 'THE PICNIC CUP'
      $('r-title').innerHTML = 'Wobble<span>Rally.</span>'
      $('r-description').innerHTML = 'Tiny karts. Big picnic energy.<br>Three rivals. One very silly goose.'
      gameContext.input.present('start', { label: "Let's race" })
    }
  }
}

function disposeUi() {
  uiController?.abort(); uiController = null
  uiRoot?.remove(); uiRoot = null
  uiStyle?.remove(); uiStyle = null
}
