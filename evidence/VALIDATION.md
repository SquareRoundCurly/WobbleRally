# Wobble Rally validation

2026-10-01. The game and independent release package are implemented and have
passed the functional checks below. The 68-second gameplay preview and eight-second touch video have been decoded
and visually reviewed. Live performance on the intended recording device is still unverified.

## Exact build and environment

- Script SHA-256: `4b6fc18a06670254c137da262b4785d02c02085edb5206db1255051113ac74af`.
- Scene SHA-256: `477a2c0d89a2e2a211d6db0dedcd6ade43b718ae33ef59d64fe7664062d388fd`.
- Atlas runtime: `2fc2f81246d85e8ffa164bc1fa4805ccad19bc771ad167eda99dda73590dfcf9`.
- Chromium 151.0.7922.34, Playwright 1.62.0, Linux container.
- Intel Xeon 2.20 GHz, two reported logical CPUs, about 4 GB RAM, Vulkan
  SwiftShader software rendering. No hardware-accelerated desktop or physical
  phone has been measured.

## Functional evidence

| Check | Result and retained evidence |
| --- | --- |
| Rules | Eleven tests pass in `tests/rules.test.mjs`: ordered laps, reverse crossings, off-course/teleport rejection, recovery, targeting, immunity, item retention, key repeat and saved RNG. |
| Desktop and touch | Eleven actual-browser checks pass in `browser-mechanics.json`: A/D, opposing holds, real multi-touch steering/use, release outside, cancellation, focus loss, pause/resume, fresh saves, restored audio and reachable controls after resize. |
| Items and contacts | Nine native-browser checks pass in `browser-items.json`: all items for player and AI, saved boosts/geese/jelly, no-target expiry, overlapping-hit immunity, four-racer recovery, boosted finish and a boosted wall impact. Fixtures are explicitly identified. |
| Complete race | `drive.json` retains real keyboard inputs, native body paths, observations and the full result save. The player wins at 111.100 seconds. Crumb finishes at 117.417, Plum at 119.700 and Mochi at 120.950. All four complete three laps with zero recoveries and no runtime errors. |
| Independent progress | Native position samples establish more than three complete circuits for every body: 3.033, 3.017, 3.022 and 3.033 circuits respectively. The driver never sets game state or teleports a kart. |
| Replay and rematches | `replay.json` passes a full input replay and three consecutive rematches. Native positions/velocities and the complete saved race—including RNG, pickups, effects and camera—match exactly after JSON's negative-zero normalization. |
| Same-release saves | Active and paused saves are checked in a fresh sandbox, including explicit resume. Goose, jelly and boost saves retain their state. The finished result round-trips exactly in the replay check. |
| Release package | Public SDK 0.2.0 builds byte-identical archives and validates the release. `package-browser.json` independently loads every payload byte from the ZIP in the public browser host, observes all four karts moving and contacting the course, and records no runtime errors. |

The final winning driver and replay runs retain every native 60 Hz physics tick
but reduce presentation frequency for the long software-rendered checks. The
replay batches steps differently and compares full state. `close-race.json`
also retains a fully rendered race using the same driving rules before the
sound-resume repair: the player finished second by 0.983 seconds. Its script
digest distinguishes that revision. Neither fixed-step run establishes live FPS.

The release is `dist/wobble-rally-0.1.0.zip`: 553,742 bytes, 13 payload files.
Its content digest is
`f97aa481743b85b12abd969f818b9a7132bb1e7f505894c9dd1da3dba610473d`;
archive SHA-256 is
`c418bcb2f941f5f6d1f657148c37e4656eef3240ac3356dd9523a55a9cbd0ffd`.
The module uses the existing sandbox and save contract. It has no platform game
imports, model calls, credentials or dedicated game compute. It has not been
committed. Version 0.1.0 was published on 2026-10-01 through the public API;
`deployment.json` records the successful operation, and `published-module.json`
records public visibility and the selected immutable release.

- Deployment: `7433d627-92a8-410e-9695-81c9c78c17ce`.
- Module: `995db5ed-c126-4ebf-a564-043975d3edeb`.
- Release: `4e074fdb-3e91-420a-b6be-2f28df152fca`.

Play at [PocketRealms](https://pocketrealms.ai): sign in and choose
**New session → Wobble Rally → Create**.
On phones, press **Collapse sidebar** in the platform's upper left before
playing. The expanded 248-pixel sidebar leaves too little room at a 390-pixel
viewport; its existing collapse control reduces it to 42 pixels. The retained
`production-expanded-phone-sidebar.json` and screenshot show this limitation.

`production-browser.json` passes five checks against the actual hosted PWA and
API as a separate, disposable player: public catalog discovery, all 13 release
files downloaded and independently matched to the ZIP, four native karts moving,
an exact saved-race reload followed by resumed motion, and reachable touch
controls at 390×844 with the sidebar collapsed. No page or API errors occurred.
`production-desktop.png` and `production-phone-layout.png` are reviewed captures.
These are software-rendered deployment checks, not recording-device benchmarks.
The test session was deleted after the check.
`deployment-operations.json` records the successful bounded test-account cleanup,
removal of the encrypted workflow artifact and local login copies, and the
final selected-release check. No persistent publisher key was created.

The first production probe reached the title screen but Chromium discarded ten
streamed response bodies before its debugging protocol could return them.
`production-cdp-response-body-failure.json` retains that harness failure. The
final check records the PWA's successful downloads and independently hashes the
immutable server bytes; no published game files changed during this repair.

## Visual review and performance limit

Actual desktop (1280×720), touch landscape (740×420) and portrait (390×844)
captures have been inspected. The course edges, four kart silhouettes, teapot,
roadside props and pickups are legible. The finish gate clears the chase camera.
All three driving buttons remain visible and reachable. `packaged-game.png`
shows the independently loaded release.

The final unmodified live benchmark, run with no other browser job active,
measured **1.105 FPS** at 1280×720, with a 950 ms median frame interval.
`performance.json` records the renderer, native progress and frame timestamps.
This is a substantial shortfall from the 60 FPS desktop target. The 30 FPS
physical-phone target is unverified. Touch emulation establishes layout and
input behavior only. A sampled recording cannot stand in for this measurement.

Measure the intended GPU desktop and phone before calling the module ready for
the application recording. `HEADLESS=0 npm run measure` supports an ordinary
hardware-backed desktop browser without forcing SwiftShader. The recording
route and capture disclosures are in [RECORDING.md](RECORDING.md).

The preview now provides `/?benchmark=desktop` and `/?benchmark=phone` for that
remaining check. A thirty-second observer runs inside the live game sandbox,
with two simulation seconds of warm-up. It exports the named device, renderer,
viewport, every measured frame interval, native progress, and payload/probe
hashes. It does not alter simulation, input or render cadence, and it preserves
the normal preview's local save.

`device-benchmark-harness.json` verifies the probe against a separately installed
browser animation-frame observer, rejects a frozen host clock, checks the
downloaded JSON and checks phone control reachability. These four checks pass.
`device-benchmark-software.json` is explicitly a Linux SwiftShader harness test;
it does not satisfy the missing recording-device measurements. The packaged
game files and release ZIP remain byte-identical to the validated release.

## Retained failures and repairs

1. Initial glTF load rejected non-indexed triangles. Generator now writes indices.
2. The next glTF load required texture coordinates. Generator now writes UVs.
3. A long browser run lost its external server. Test runners now own server
   lifecycles, avoiding an expiring interactive shell.
4. The first full-race attempt timed out while taking an intermediate screenshot.
   A subsequent software-rendered run reached 30 seconds with all four racers
   advancing and no recoveries, but was stopped for test-rendering diagnosis.
   These partial runs are not evidence of a completed race.
5. The own-trap rule test failed because a rival was standing on the trap and
   correctly consumed it. The fixture now separates rivals; the rerun passes.
6. The original pause overlay allowed physics drift. Karts now become stationary
   kinematic bodies during pause and restore their saved motion on resume.
   Actual browser freeze and resume checks pass.
7. Multi-touch release testing incorrectly sent remaining points with CDP
   `touchEnd`, contrary to its protocol. Simultaneous steering and use passed;
   the malformed release ended steering before the drag check. Corrected to
   move both contacts and release with an empty touch list. All checks now pass.
   Retained failure: `browser-mechanics-failed-touch.json`.
8. Visual inspection found a washed-out palette, ungrounded props and low finish
   bunting. Switched to original toon-shaded glTF, added lawn/embankments and
   raised the gate. Touch captures show the repaired presentation.
9. Profiling found avoidable costs in the module: 720 static course bodies and
   repeated updates to invisible effect pools. The current course uses 240
   static bodies, two physics substeps, and updates effect visibility on changes.
   Original art now uses a palette texture and one draw call per model.
10. A race starting behind the field exposed pickup starvation: the five-second
    refill let front runners consume almost every box. Refill is now 1.5 seconds
    for everyone. The player has a small fixed pace advantage for forgiving
    play; no AI pace depends on rank. The new race won at 111.100 seconds, with all three AI finishing and no
    recoveries. A separate center-line drive finished second by 0.983 seconds.

11. Fresh saved games resumed without initializing audio on desktop. Resume and
    rematch now initialize audio from their user gesture. The fresh-sandbox
    browser check observes a running native AudioContext after resume.
12. The first exact native replay comparison rejected IEEE negative zero after
    JSON serialization normalized it. Native transforms now use the same JSON
    representation on both sides. Exact motion/state and three rematches passed;
    `replay-negative-zero-failure.json` retains the original assertion.

13. The ZIP smoke check initially required every kart to touch a collider on one
    exact tick. Mochi was briefly airborne after a bump. The check now samples
    native contacts over 150 ticks and passes for all four bodies. The original
    observation is in `package-browser-transient-contact-failure.json`.
14. The first recording attempt was stopped because software frame readback was
    too slow. A smaller concurrent attempt lost its browser during capture. Both
    partial captures and failure reports are retained. The final attempt runs
    alone, with browser diagnostics and the GPU watchdog disabled for offline
    rendering. The live benchmark retains its original, unmodified cadence.

15. The completed desktop capture was retained after the touch recorder sent a
    redundant `touchEnd` with no contacts remaining. The script now releases only
    an active contact and checkpoints the completed desktop take. The separate
    touch retake passes, with 19 trusted CDP input events retained.
    `recordings/touch-finalization-failure.json` retains the failed finalization;
    `recordings/recording.json` discloses the recovered desktop metadata.

## Delivered recordings

- `recordings/wobble-rally-preview.webm`: 68 seconds, 640×400, 10 FPS, silent.
- `recordings/wobble-rally-touch.webm`: 8 seconds, 740×420, 10 FPS, silent.
- `recordings/review.json`: verified durations, digests and nine decoded frames.
  All nine frames were inspected, including the close pass, soda bottle and
  fizz, flying goose, winning result and simultaneous touch steering/use.

These are fixed-tick gameplay captures from real browser inputs, with two
forward cuts in race time and a separately restored touch take. They are review
artifacts; live performance on recording hardware remains the open goal gate.
