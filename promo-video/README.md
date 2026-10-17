# ghosthand promo video

28 s motion design promo rendered from plain HTML. **No Remotion**: `src/video.ts` builds the DOM once and `seek(t)` sets every style from `t`, so headless Chrome can screenshot any frame.

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
| 0.0 | title, hex icon cluster, dots hop between icons | `sceneTitle` |
| 3.8 | chat panel + Claude Code terminal | `sceneChat`, `terminal()` |
| 8.0 | terminal swaps to Codex | `sceneChat` |
| 12.0 | one hub, six agent cards, particles on links | `sceneWorld` |
| 15.9 | camera zooms out, cards morph to tiles, teammate hub | `CAM_KEYS` |
| 18.8 | camera zooms out to the team mesh | `CAM_KEYS` |
| 21.4 | tiles turn into hexes, scatter, honeycomb, collapse, logo | `sceneOutro` |

Headers are in `init()`. Every timing is a plain number in seconds next to the element it moves.

## Rules

- **Pure function of time.** No CSS transitions, no `requestAnimationFrame`, no `Math.random()`. Use `random(seed)` for scatter and particles.
- **Fonts are inlined** from `@fontsource-variable` as data URLs, so renders do not depend on installed fonts.
- Characters (orb, blob, bean) are drawn in `art`; the ghost comes from `website/public/logo-ink.svg`.
