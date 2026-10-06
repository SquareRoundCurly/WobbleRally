# Wobble Rally

A small 3D kart racer for PocketRealms. Race three goofy rivals around an
oversized picnic, collect a soda rocket, unleash an indignant goose, and leave
a jelly surprise for someone else.

One course, three laps, automatic acceleration. Hold **A / D** to steer and
press **Space** to use an item. Phones have **Left / Right / Use** buttons;
steering and using an item work with separate fingers. Pause and sound controls
sit above the course. Losing focus pauses the race.

Version **0.1.0** is published on [PocketRealms](https://pocketrealms.ai).

The local **0.2.0** release uses Atlas shared input contract 1. `inputs.json`
declares the buttons and keyboard/widget mappings; game scripts consume
`game.input` and `onControl`. The existing styled HUD mounts the platform's
button widgets. No game-specific pointer bookkeeping is required. Its pinned
runtime and CLI 0.3.0 must be published before releasing this game version.
Validation for this migration is retained under `evidence/shared-inputs/`.
Sign in, choose **New session → Wobble Rally → Create**, then **Let's race**.
On phones, use **Collapse sidebar** in the upper left to give the game enough
room for all three driving controls.

## Run locally

Requires Node 22+, Python 3.12+, and a browser with WebGL 2.

```sh
npm ci
npm run runtime
npm run build
npm run dev
```

Open <http://localhost:4194>. The preview uses the checksum-verified public Atlas
runtime inside the same opaque sandbox as a published game. It stores local
checkpoints in this browser. Use `/?fresh` to start without loading the current
checkpoint. The game itself uses PocketRealms' synchronous snapshot/restore and
checkpoint contract; the published platform owns storage and authorization.

## Source and validation

- `src/race.js`: fixed-tick rules, physical steering, AI, items, progress, saves.
- `src/ui.js`: responsive touch HUD and generated audio within the sandbox.
- `tools/scene.py`: reproducible original glTF art and native Box3D colliders.
- `tools/build.mjs`: assembles the self-contained Atlas lifecycle script.
- `pocketrealms.json`: independent module, pinned runtime, payload and save schema.

```sh
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

The long-race driver reads native kart positions and sends real keyboard events.
It does not teleport karts or inject a finish condition. Mechanics tests also
use explicitly identified saved-state fixtures for isolated interactions.
`evidence/` retains browser observations, input traces, captures and failures.
Long physics runs use a smaller render surface on software-only test machines;
separate desktop and touch captures check presentation.
`SPARSE_RENDER=1 npm run test:race` can also reduce presentation frequency for
the long physics check. Every native simulation tick still runs. Evidence
reports this setting; the live performance benchmark never uses it.

If browser system dependencies are unavailable on the host, the matching
Playwright image can run the same tests:

```sh
docker run --rm --ipc=host --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/game" --workdir /game \
  mcr.microsoft.com/playwright:v1.62.0-noble node tools/browser-tests.mjs
```

Each browser runner starts and stops its own local server. Avoid running multiple
browser runners on the same network namespace at once.

## Package

```sh
python3 -m venv .venv
.venv/bin/python tools/install-cli.py
npm run package
```

This verifies the pinned public CLI, builds a ZIP, validates its contents and
checks that a second build is byte-identical. Outputs go into `dist/`. No
platform source, authoring Pod, model call or provider credential is needed.
The repository is an independent module. To publish a validated release, set
`POCKETREALMS_API_KEY` to a publisher key in the calling environment, then run
`.venv/bin/pocketrealms --json deploy . --visibility public`.
`npm run test:package` mounts the exact ZIP payload in the public browser host.

## Demo recording

See [the recording route](evidence/RECORDING.md) for the approximately 68-second
gameplay edit and a separate touch demonstration. The retained preview is a
silent fixed-tick capture, with cuts and sampling disclosed. It does not prove
live frame rate. Use the device benchmark below before making the application
recording.

## Measure the recording devices

With `npm run dev` running, open `/?benchmark=desktop` on the recording computer
or `/?benchmark=phone` on the physical phone. For a phone on the same network,
use the serving computer's LAN address, such as
`http://<computer-address>:4194/?benchmark=phone`.

Enter the device model and browser, start a race, and play normally for thirty
seconds after the warm-up. Then choose **Download result**. The JSON includes
raw frame intervals, renderer, viewport, native kart progress and hashes of the
game files. Pausing, hiding the page, resizing or a frozen simulation restarts
the measurement. The preview's existing saved race is preserved.

The desktop target is 60 FPS and the physical-phone target is 30 FPS. This page
uses ordinary live rendering; it does not sample fixed-tick footage. Its small
observational probe is local preview instrumentation and is excluded from the
published module. `npm run test:device-benchmark` checks it against a second
independent animation-frame observer in the actual browser. Software-rendered
and emulated results remain identified as such.

`HEADLESS=0 npm run measure` also provides a desktop-only Playwright benchmark.

Current acceptance status is tracked in `evidence/VALIDATION.md`. Browser
emulation validates layout and input; it does not establish physical-phone
performance.
