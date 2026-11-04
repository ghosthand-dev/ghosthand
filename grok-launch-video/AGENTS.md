# HyperFrames Composition Project

This folder is a [HyperFrames](https://hyperframes.heygen.com) video: HTML, CSS and seekable
animations (GSAP by default) that the `hyperframes` CLI previews in the browser and renders to
MP4.

## Skills — read these first

**Invoke the relevant skill before writing or modifying compositions.** Skills encode framework-specific patterns (e.g., `window.__timelines` registration, `data-*` attribute semantics, shader-compatible CSS rules) that generic web docs don't cover, so compositions written without them break.

**Doing anything with HyperFrames?** Start at `/hyperframes`. Make any video by asking for it; the `/hyperframes` skill carries the contract and the references (each kind of film, story, motion, look, sound, review, captions, overlays). Read it first, especially when there's no project context to orient you.

- `/hyperframes` — read first for any request to make, edit, animate or render a video, motion graphic, captions or overlays. Holds the render contract and the work loop.
- `/hyperframes-cli` — the CLI by job: scaffold, check, look at frames, edit the timeline, preview, render, publish, project history.
- `/hyperframes-registry` — ready-made blocks and components installed as editable source. Search it before hand-building any named visual.
- `/media-use` — get or make any media (music, sound effects, images, voiceover, avatar and generated video, transcripts, cutouts, colour grades) and mix placed audio.
- `/figma` — bring a Figma design, frame, logo or brand into a video.
- `/slideshow` — a presentation or pitch deck. Output is a navigable deck, not a rendered MP4.
- `/remotion-to-hyperframes` — bring existing video code or footage into HyperFrames (Remotion first; also Motion Canvas, Lottie, Three.js, canvas, or renders from other tools) and verify it frame by frame against the original.

**Changing how real footage or images look or reveal?** Load `/media-use` and read its `references/media-treatments.md` before editing, even when the request only says dark, flat, boring, retro, private, or “make the reveal cooler.” It governs how footage is treated, never whether media may be used. Use canonical media treatments and seek-safe motion; do not improvise equivalent CSS/SVG filters or overlays.

> **Tailwind v4 projects** (`hyperframes init --tailwind`): see `hyperframes-cli/references/init-and-scaffold.md` (Tailwind).

> **Using a HyperFrames plugin?** Load skills from that installed bundle and follow
> its `hyperframes/references/plugin-installation.md` execution rules. Update via
> the plugin manager, not the standalone commands below.
>
> **Standalone skill missing or stale?** Run `npx hyperframes skills update <name>` to install/refresh
> the specific skill you need, or bare `npx hyperframes skills update` to refresh the core set plus
> everything already installed — neither pulls the full set. Restart the agent session so
> newly installed skills load.

## Commands

```bash
npm run dev          # human-operated foreground preview (blocks until stopped)
npx hyperframes preview --background  # agent-safe persistent Studio preview
npx hyperframes preview --status      # verify the persistent preview is listening
npx hyperframes preview --stop        # stop it when review is finished
npm run check        # lint + runtime + layout + motion + contrast (one command)
npx hyperframes snapshot --at 1,3,5  # PNG frames at those seconds, to look at before rendering
npm run render       # render to MP4
npm run publish      # publish and get a shareable link
npx hyperframes lint --verbose  # include info-level findings
npx hyperframes lint --json     # machine-readable output for CI
npx hyperframes docs <topic> # reference docs in terminal
```

> **Agents must use `npx hyperframes preview --background` for Studio handoff.** Do not rely
> on a shell/tool `run_in_background` wrapper around `npm run dev`: that foreground process
> remains owned by the invoking session and can disappear while the browser stays open,
> leaving refreshes at `ERR_CONNECTION_TIMED_OUT`. Verify with `preview --status`, keep it
> alive through review, and stop it explicitly with `preview --stop` afterward.

> **Back from the desktop app.** Once this project was opened in the HyperFrames desktop app, run `npx hyperframes catch-up` before your next change here: it lists what the person asked Framey in the app and which files changed since.

> **Pinned CLI version.** These scripts pin an exact `hyperframes@X.Y.Z` so this project re-renders identically over time. Weeks later that pin lags fixes shipped since. To move up: `npx hyperframes@latest upgrade --project . --check` (shows the delta), then `npx hyperframes@latest upgrade --project .` to rewrite the pins. Always unpinned — the pinned script re-runs the old version against itself.

## Documentation

**For quick reference**, use the local CLI docs command (no network required):

```bash
npx hyperframes docs <topic>
```

Topics: `data-attributes`, `gsap`, `compositions`, `rendering`, `examples`, `troubleshooting`

**For full documentation**, discover pages via the machine-readable index — do NOT guess URLs:

```
https://hyperframes.heygen.com/llms.txt
```

## Project Structure

- `index.html` — main composition (root timeline)
- `compositions/` — sub-compositions referenced via `data-composition-src`
- `meta.json` — project metadata (id, name)
- `transcript.json` — whisper word-level transcript (if generated)

## Linting — ALWAYS RUN AFTER CHANGES

After creating or editing any `.html` composition, **always** run the full check before considering the task complete:

```bash
npm run check
```

Fix all errors before presenting the result. Warnings should be reviewed before rendering.

Then look at what you changed: `npx hyperframes snapshot --at <seconds>` (or `--range START,END`, `--composition <id>`) at the moments you edited, and read the frames before you reply. A passing check does not show how it looks.

## Key Rules

1. Every timed element needs `data-start` and a duration. `data-start` is what marks it as timed; `data-track-index` is an optional Studio display lane the render never reads
2. Give timed visual elements `class="clip"`. The framework keys visibility off `data-start`, not the class, but the shared `.clip` CSS is what gives a scene its full-frame box, and `lint` warns without it
3. Register one paused root timeline per composition on `window.__timelines`:
   ```js
   window.__timelines = window.__timelines || {};
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   ```
   Scene timelines manually added to this root must not be paused. A paused
   child does not advance when the root is seeked. The runtime activates
   registered composition siblings, not arbitrary nested scene timelines.
4. A video with sound keeps it on the `<video>` (`data-has-audio="true"`, no `muted`). Use a separate `<audio>` for music, voiceover, replacement audio, J/L cuts, or audio detached in Studio. Silent footage and b-roll: `muted`.
5. Sub-compositions use `data-composition-src="compositions/file.html"` to reference other HTML files
6. Only deterministic logic — no `Date.now()`, no `Math.random()`, no network fetches

# This project: Ghosthand x Grok Bot launch video

Music: assets/music.m4a is promo-video/assets/launch-music.mp3 (114.2 BPM, Kit.BEAT = 0.5253),
cut to the video length with a 6-beat fade out. Every scene lasts a whole number of beats
(Kit.stretchTo slows its reading spans to fit), so every cut lands on a beat. Built on the frame-matched rebuild of https://x.com/allophonesystem/status/2115793573589258279
(kept outside the repo): same tracked mascot motion and scene order, new Ghosthand content.
Every scene is authored in the source's 1280x720 space inside a `*-stage` div scaled 1.5x.

```
index.html  three.js, MASCOT_CONFIG (accessory "phone"), shared scripts, scene hosts, music
 ├─ compositions/intro.html  0.0-6.3    the ghosthand + iPhone flies on, "Give your [bot] an iPhone", "Opens any [apps] app"
 ├─ compositions/apps.html   6.3-9.73   iPhone rises, bot jumps in as the pointer, taps TikTok, real caption recording
 ├─ compositions/chat.html   9.73-12.87 mirrored "On it!" bubble, then the chat: request, TikTok post card, follow-up
 ├─ compositions/demo.html  (15 beats)  the real iPhone recording next to the Grok Bot chat, camera always moving
 ├─ compositions/inbox.html  12.87-15.87 dark Grok Bot window, camera dives into the WhatsApp follow-up
 └─ compositions/outro.html  15.87-20.29 ghosthand icon + wordmark, "Connect ghosthand to [bot] Grok Bot", ghosthand.dev

assets/app-icons.js           AppIcons.fill(root): real brand glyphs (simple-icons) on brand tiles for [data-app]
assets/tiktok-caption.mp4     real recording (demo-video/public/tiktok/phone.mp4, 15.35-17.17 s), status bar cropped
assets/tiktok-post.jpg        crop of the posted TikTok from the same recording
assets/demo-phone.mp4         the same recording cut and sped up (parts listed in demo.html PARTS)
assets/wordmark-white.svg     ghosthand wordmark from website/public/logo-white.svg
assets/kit.js                 keyframes(), trackPose(), popWord(), everyFrame(), random()
assets/mascot/mascot.js       three.js mascot: Mascot.create({canvas}) -> stage.add() -> head.pose(s)
assets/mascot/accessories.js  accessory builders (headset, cap, crown, phone); MascotAccessories[name]() -> THREE.Group
assets/data/mascot-tracks.js  generated: per-frame mascot pose tracked from the source video
tools/                        tracking scripts that generate mascot-tracks.js
```

- **Swap the accessory**: set `MASCOT_CONFIG.accessory` in `index.html`. To add one, register a
  builder in `assets/mascot/accessories.js` that returns a `THREE.Group` in head units (radius 1,
  x right, y down, z toward the viewer). A glTF model works the same way once loaded and scaled.
- **Mascot pose** `{ x, y, R, yaw, pitch, roll, blink, accessory, detached? }`: canvas px for
  position and radius, radians for rotation (Rz·Rx·Ry). `detached` places the accessory on its
  own (the headset flying in during the intro).
- Materials are unlit (`MeshBasicMaterial`) with an orthographic camera, so the 3D mascot keeps
  the source's flat vector look. Eyes are clipped to the head with the stencil buffer.
- Measured tables (`[frame, ...values]`, source frames at 30 fps) live next to the scene that uses
  them and are read with `Kit.keyframes`. Scenes keep a `F0` (first source frame) and `lt(frame)`.
- **Regenerate tracks** (only when the motion source changes): extract frames with
  `ffmpeg -i source.mp4 -vf fps=30 -start_number 0 f30/f30_%03d.jpg`, then run
  `tools/track.py` and `tools/fit.py` per segment and `tools/gen-tracks.py` (Python with
  pillow, numpy, scipy). Segments and anchor frames are listed in `gen-tracks.py`.

## Media cut from the TikTok recording

`assets/demo-phone.mp4` and `assets/tiktok-caption.mp4` are gitignored, like their source
`demo-video/public/tiktok/phone.mp4`. Recreate them from the repo root:

```bash
P=demo-video/public/tiktok/phone.mp4; A=grok-launch-video/assets
ffmpeg -y -ss 15.35 -t 1.82 -i $P -vf "crop=750:1294:0:40,scale=854:1474:flags=lanczos,fps=30,tpad=stop_mode=clone:stop_duration=2.1" -an -c:v libx264 -crf 16 -pix_fmt yuv420p $A/tiktok-caption.mp4
ffmpeg -y -i $P -filter_complex "[0:v]trim=0:3.4,setpts=(PTS-STARTPTS)/4.5[a];[0:v]trim=4.2:13.2,setpts=(PTS-STARTPTS)/5[b];[0:v]trim=13.2:16.4,setpts=(PTS-STARTPTS)/2.2[c];[0:v]trim=16.4:17.6,setpts=(PTS-STARTPTS)/3[d];[0:v]trim=24.6:27.0,setpts=(PTS-STARTPTS)/1.2[e];[a][b][c][d][e]concat=n=5:v=1:a=0,fps=30,tpad=start_mode=clone:start_duration=0.5:stop_mode=clone:stop_duration=1.2[v]" -map "[v]" -an -c:v libx264 -crf 16 -pix_fmt yuv420p $A/demo-phone.mp4
```

The parts in the second command must match `PARTS` in `compositions/demo.html`.
