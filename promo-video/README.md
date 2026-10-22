# ghosthand promo videos

Motion design videos rendered from plain HTML and WebGL. **No Remotion**: each entry in `src/` builds the page once and `seek(t)` sets every style, mesh and camera from `t`, so headless Chrome can screenshot any frame.

| Entry | Video | Length |
| --- | --- | --- |
| `src/video.ts` | bots (Grok, a dot) use real iPhones through ghosthand, flat 2D | 36 s |
| `src/launch.ts` | launch: "Give your agent a phone", toon-shaded 3D setup steps, then the real agent demo | 62 s |

```
src/<entry>.ts ──esbuild──> one HTML page ──headless Chrome, N pages──> PNG per frame ──ffmpeg──> out/<entry>.mp4
                                │                                                          ▲
                                └── window.video.seek(t), .duration, .sounds ─── audio mix ┘
```

## Render

```bash
pnpm tsx scripts/render.ts                              # out/video.mp4, 60 fps
pnpm tsx scripts/render.ts --entry launch               # out/launch.mp4, 60 fps, about 18 min
pnpm tsx scripts/render.ts --entry launch --fps 30      # draft, about 9 min
pnpm tsx scripts/render.ts --entry launch --stills 6,22 # PNGs in out/stills/ to check single frames
pnpm tsx scripts/render.ts --entry launch --preview     # out/launch-preview.html with play button and scrubber
```

`launch` plays `demo-video/out/tiktok.mp4`: render it first in `demo-video/` (see its README).

## Launch video

| Time | Scene |
| --- | --- |
| 0.0 | hook title |
| 3.4 | 01 a Mac mini drops in |
| 8.4 | 02 an iPhone pops in on a stand, lock screen turns on |
| 13.0 | 03 the USB cable draws from the Mac to the iPhone |
| 18.0 | 04 close-up: passcode, Trust This Computer, Bluetooth pairing, checklist |
| 26.0 | how it works: Bluetooth arc carries mouse + keyboard, USB cable carries screen frames |
| 36.5 | 05 CLI, MCP and API cards fan out of the Mac |
| 42.5 | circle reveal from the iPhone screen into the real demo |
| 57.1 | end card |

- **`src/launch-3d.ts`**: models built from code (1 unit = 1 cm), `MeshToonMaterial` with a 4-step ramp, and an ink pass: Sobel edges on normals + depth draw dark outlines, silhouettes get a thin indigo rim, with line boil (8 fps wobble) and light grain.
- **Dark theme**: `PALETTE` in `src/launch-3d.ts`. The accent is the website's primary `#4f46e5` (`website/docs.jsonc`); `accentLight` is used for small text on the dark background.
- **`src/launch-screens.ts`**: iOS screens drawn with Canvas 2D in iPhone SE points, used as the screen texture.
- **`src/launch.ts`**: timeline, camera keyframes (`cameraRig`), HTML text and overlays positioned with `world.project()`, sounds.
- **Text left, objects right**: `camera.setViewOffset` shifts the 3D frame right by `shift` px, so the text column never covers the models.
- **Sounds** are the synthesized `demo-video/public/sfx/*.wav` plus the demo clip's own audio, mixed by ffmpeg from `window.video.sounds`.

## Scenes

| Time | Scene | Code |
| --- | --- | --- |
| 0.0 | title, square icon cluster, dots hop between icons | `sceneTitle` |
| 3.8 | Grok chat + iPhone mockup posting a TikTok clip | `sceneChat`, `chatPanel()`, `phone()` |
| 11.9 | chat swaps to a dot, iPhone warms up the account | `SWAP_AT` |
| 19.8 | one hub, six iPhone cards, particles on links | `sceneWorld`, `NET_AT` |
| 23.7 | camera zooms out, cards morph to tiles, teammate hub | `CAM_KEYS` |
| 26.6 | camera zooms out to the team mesh | `CAM_KEYS` |
| 29.2 | tiles turn into squares, scatter, cluster, collapse into the logo tile | `sceneOutro`, `SHAPES_AT` |

Scene starts are constants at the top of `video.ts`; every other time is relative to one of them. Headers are in `init()`.

## iPhone clips

The iPhone SE mockup (CSS, 16:9 screen, home button) plays `demo-video/public/*/phone.mp4` (listed in `CLIPS` in `src/shared.ts`). The render script extracts them once to `out/clips/<name>/00001.jpg...` (delete the folder to extract again). `seek(t)` swaps the `<img>` frame and waits for it to decode. Tap ripples and the caption under the phone come from the clip's `timeline.json`.

## Rules

- **Pure function of time.** No CSS transitions, no `requestAnimationFrame`, no `Math.random()`. Use `random(seed)` for scatter and particles. Shared math and DOM helpers live in `src/shared.ts`.
- **WebGL runs on the GPU** in headless Chrome (ANGLE Metal). The canvas renders at 2x and is scaled down, so outlines stay smooth.
- **Fonts are inlined** from `@fontsource-variable` as data URLs, so renders do not depend on installed fonts.
- Characters (orb, blob, bean) are drawn in `art`; the ghost comes from `website/public/logo-ink.svg`.
