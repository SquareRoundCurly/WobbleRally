export default {
  start(game) {
    gameContext = game
    mountUi()
    newRace(game)
  },
  reset(game) { uiAudio(); newRace(game, true) },
  update(dt, game) { tickRace(dt, game) },
  onControl(event, game) {
    if (event.type !== 'press') return
    if (event.input === 'start') {
      if (race.phase === 'title') startRace()
      else if (race.phase === 'paused') resumeRace()
      else if (race.phase === 'finished') game.reset()
    }
    if (event.input === 'pause') pauseRace()
    if (event.input === 'mute') { muted = !muted; game.input.present('mute', { label: muted ? 'Unmute sound' : 'Mute sound', icon: muted ? '×' : '♪' }); focusCanvas() }
    if (event.input === 'use') { useItem(race.racers[0]); updateUi() }
  },
  snapshot(game) { return snapshotRace(game) },
  restore(saved, game) { restoreRace(saved, game) },
  dispose() { clearInput(); disposeUi(); if (audio) { audio.close().catch(() => {}); audio = null } },
}
