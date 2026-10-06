# Recording Wobble Rally

The reproducible route uses the actual Atlas browser, native kart physics and
the keyboard trace in `drive.json`. The driver reads native kart positions,
steers with A/D and presses Space for collected items. It does not assign a
winning position or move karts directly.

## Preview edit

`recordings/wobble-rally-preview.webm` is a silent, sampled gameplay preview,
approximately 68 seconds long. `recordings/recording.json` records the precise
segments, source digest, browser and capture rate. The delivered capture uses
10 frames per second at 640×400 with offline sampling because this workspace
renders in software. The simulation
still advances at 60 fixed ticks per second. This video does **not** demonstrate
live rendering performance or the skill of a human driver.

| Preview time | Scene |
| --- | --- |
| 0–2 seconds | Title and picnic setting. |
| 2–26 seconds | Countdown, a close opening pack, Soda Rocket and the pass into first. |
| 26–46 seconds | A later section of the first lap, Honking Goose and the lap transition. |
| 46–68 seconds | Final-lap scenery, another item use and the winning finish. |

There are two jumps forward in race time. The skipped intervals are still
simulated with their original inputs. The editor does not change the outcome.
The full race and all three opponents' finish times are retained in `drive.json`.

`recordings/wobble-rally-touch.webm` is a separate eight-second take. It resumes
a save made immediately before the first naturally collected item is used.
Trusted browser touch events hold steering and press Use with a second contact,
then steer around the bend. Its trace and starting save are retained alongside
the video. This establishes browser touch behavior, not physical-phone frame rate.

## Record on the intended device

Run the preview as described in the repository README and open `/?fresh`.
Play a warm-up lap, then record an ordinary race with the device's screen
recorder. Keep the countdown, a pass, two different items and the finish in
the edit. Retain the uncut recording and disclose any cuts or separate takes.
Landscape gives the course and both thumbs the most room on a phone.

Check ordinary live performance on the recording device first. The software
renderer in this workspace is below the 60 FPS desktop target, and no physical
phone has been measured. A sampled preview must not be presented as a smooth
real-time performance demonstration. The game has generated sound effects;
the sampled preview is silent because it does not capture wall-clock audio.

The local preview has a direct device check: open `/?benchmark=desktop` or
`/?benchmark=phone`, name the device, and play normally for the thirty-second
measurement. Download the JSON result afterward. On a phone, open the serving
computer's LAN address or the usual development port-forward URL. The test
retains raw frame intervals and identifies the renderer and exact game files.
The [README](../README.md#measure-the-recording-devices) explains the procedure.

For a reproducible higher-frame-rate preview on a suitable desktop, install
FFmpeg and the matching Playwright browser, then run:

```sh
WOBBLE_FFMPEG=/absolute/path/to/ffmpeg WOBBLE_RECORD_FPS=30 \
  WOBBLE_WIDTH=1280 WOBBLE_HEIGHT=720 npm run record
```

This replaces the preview files with a new fixed-tick capture. It remains a
sampled replay. `HEADLESS=0 npm run measure` runs the separate, unmodified live
browser benchmark and reports its actual graphics renderer. Do not force
SwiftShader when measuring a hardware-accelerated recording device.

For the software-only container capture used here:

```sh
docker run --rm --ipc=host --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/game" --workdir /game \
  -e ANGLE=swiftshader-webgl -e WOBBLE_WIDTH=640 -e WOBBLE_HEIGHT=400 \
  mcr.microsoft.com/playwright:v1.62.0-noble node tools/record.mjs
```

After a completed desktop take, `npm run record -- --touch-only` repeats just
the touch take, preserving the desktop video and its digest. The capture checks
reject a changed game revision. `tools/review-recordings.mjs` decodes the final
WebMs with FFmpeg and records their duration, dimensions, digests and sample
frames. Earlier capture failures remain in `evidence/`.
