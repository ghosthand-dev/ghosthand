# ghosthand promo video

36 s motion design promo rendered from plain HTML: bots (Grok, a dot) use real iPhones through ghosthand. **No Remotion**: `src/video.ts` builds the DOM once and `seek(t)` sets every style from `t`, so headless Chrome can screenshot any frame.

```
src/video.ts ──esbuild──> one HTML page ──headless Chrome, N pages──> PNG per frame ──ffmpeg──> out/video.mp4
                              │
                              └── window.video.seek(t), window.video.duration
```

## Render

```bash
pnpm tsx scripts/render.ts                        # out/video.mp4, 60 fps, about 35 s
pnpm tsx scripts/render.ts --stills 1.5,6,14      # PNGs in out/stills/ to check single frames
pnpm tsx scripts/render.ts --preview              # out/preview.html with play button and scrubber
```

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

The iPhone SE mockup (CSS, 16:9 screen, home button) plays `demo-video/public/*/phone.mp4` (listed in `src/clips.ts`). The render script extracts them once to `out/clips/<name>/00001.jpg...` (delete the folder to extract again). `seek(t)` swaps the `<img>` frame and waits for it to decode. Tap ripples and the caption under the phone come from the clip's `timeline.json`.

## Rules

- **Pure function of time.** No CSS transitions, no `requestAnimationFrame`, no `Math.random()`. Use `random(seed)` for scatter and particles.
- **Fonts are inlined** from `@fontsource-variable` as data URLs, so renders do not depend on installed fonts.
- Characters (orb, blob, bean) are drawn in `art`; the ghost comes from `website/public/logo-ink.svg`.
