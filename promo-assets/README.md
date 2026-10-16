# ghosthand promo assets

Assets to recreate the TapKit promo (see `../docs/tapkit-video-breakdown.md`) for ghosthand. Silent clips only; cut, captions, voice and music happen in post.

```
ref/               original TapKit video + reference frames
frames/gpt/        start frames made with gpt-image-2 (3:2, cropped to 16:9)  <- use these
frames/*.png       older nano-banana frames (weaker, kept as extras)
clips/             Grok Imagine video clips, 480p drafts, 6s unless named 10s
clips/manifest.jsonl  prompt, source frame, size, seconds for every clip
motion-graphics/   Remotion renders: alpha webm overlays + solid cards
jobs/              job lists (batch1..3) fed to scripts/run-grok.js
scripts/           run-grok.js, gpt-frames.sh, review.sh (frame montage), sheet.sh
```

## Storyboard shot -> assets

| Shot | Use |
| --- | --- |
| 1 Desk hook (0-4s) | `clips/g-desk-hero-*`, `g-desk-hero-edit-*`, `g-studio-wide-*`; overlay `gfx-icon-row.webm` |
| 2 Presenter + logo (4-9s) | `g-presenter-woman-talk*`, `g-presenter-man-talk*`; overlays `gfx-logo-pop.webm`, `gfx-agent-chips.webm` |
| 3 Split-screen demo (9-19s) | `motion-graphics/gfx-split-frame.mp4` frame + real ghosthand recording (`demo-video/`), `gfx-prompt-card.mp4`, `gfx-tap-dot.webm` |
| 4 Presenter (19-23s) | `g-presenter-*-talk2`, `g-presenter-gesture-*` |
| 5 Three phones (23-36s) | `g-three-phones-*`, `g-three-agents-*` (10s variants), `g-phone-rack-*` |
| 6 Presenter + icons (36-43s) | `g-presenter-*-talk-10s`; overlay `gfx-icon-orbit.webm` |
| 7 End card (43-46s) | `gfx-end-card.mp4` |
| B-roll | `g-phone-closeup-*`, `g-terminal-mac-*`, `g-hands-typing`, `t2v-*`, `phone-portrait-*` (9:16) |

## Findings

- GPT Image 2 start frames give far better videos than nano-banana: UI on screens stays readable, hardware looks real.
- Image-to-video holds the camera well when the prompt says "locked-off tripod, rock steady, no morphing". Plain "dolly" zooms too much.
- Screens animate plausibly (feeds scroll, chats fill) but text on phones morphs between frames. Use wide shots; replace close screens with real ghosthand recordings.
- Presenter clips are usable. Lip sync is not tied to the script: record audio later and cover mismatches with cutaways, or lip-sync in post.
- Grok rejects bursts above ~5 parallel generations (empty responses); 5 workers works. A 6s 480p clip takes 20-40s.
- `egaki` < 0.11 fails `gpt-image-2` with a ChatGPT login; update to 0.11.
- Motion graphics tiles are text labels, not real app icons. Swap in real logos before use.

## Rebuild

```bash
promo-assets/scripts/gpt-frames.sh                       # frames
playwriter -s <id> -e 'state.jobsFile = "batch3"' && playwriter -s <id> --timeout 3000000 -f promo-assets/scripts/run-grok.js
cd demo-video && pnpm tsx scripts/render-promo-graphics.ts   # motion graphics
```
