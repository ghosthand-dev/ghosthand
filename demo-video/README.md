# ghosthand demo videos

Remotion package for 16:9 promo videos: a **real iPhone recording** on the left, an animated **Claude Code style terminal** on the right, synced to the commands the agent ran.

```
tmp/demo-x/recording.mp4 ─┐                    public/x/phone.mp4 ───┐
tmp/demo-x/start.txt ─────┼── scripts/prepare.ts ──>                  ├──> <AgentDemo> ──> out.mp4
tmp/demo-x/log.jsonl ─────┘   (speed ramp)      public/x/timeline.json┘   (src/scene.tsx)
```

## Make a video

1. **Record** with ghosthand while the agent works. Save `start.txt` (unix seconds right after `record start`) and append one line per command to `log.jsonl`:

   ```json
   {"t": 1791911812.4, "tEnd": 1791911813.1, "thought": "Opening TikTok with Spotlight.", "cmd": "ghosthand key cmd+space", "result": "pressed cmd+space"}
   ```

   Add `"error": true` to show a failed command with a red dot.

2. **Prepare**: speed up the recording and write the timeline.

   ```bash
   pnpm tsx scripts/prepare.ts --input ../tmp/demo-tiktok --out public/tiktok \
     --prompt 'upload this video to tiktok' --final 'Done. The video is posted on TikTok.'
   ```

   Remove popups or a dull ending with `--cut <start>-<end>` (raw recording seconds, repeatable). Steps that start inside a cut are dropped.

3. **Register** the timeline in `src/root.tsx` (`demos` list), then preview and render:

   ```bash
   pnpm studio
   pnpm exec remotion render src/root.tsx tiktok out/tiktok.mp4
   ```

## Speed ramp

`buildSegments` in `src/timeline.ts` gives every command and every pause its own speed. **Pauses** (the agent thinking, a still screen) shrink to about 1 s; **commands** play at about 2x so taps stay readable. Tune `defaultSpeedRules`. Every segment is encoded with an exact frame count, so chat events never drift from the video.

## Components

| Component | File | What it does |
| --- | --- | --- |
| `AgentTerminal` | `src/terminal.tsx` | Transcript of `ChatItem`s (user, text, tool) with streaming text, spinner, input box, smooth scroll |
| `PhoneMockup` | `src/phone.tsx` | Modern iPhone body in CSS (titanium band, side buttons), optional Dynamic Island |
| `TapRipple` | `src/phone.tsx` | Ring where a tap landed |
| `AgentDemo` | `src/scene.tsx` | The full scene: background image, layout, intro typing, sound cues, end card |

**Sounds** are synthesized, not sampled: `pnpm tsx scripts/make-sounds.ts` writes `public/sfx/*.wav` (keys, tool blip, tap pop, send swoosh, success chime).

<details>
<summary>Notes for agents</summary>

- The terminal never measures the DOM. Rows have a fixed height (monospace font, known column count), so the scroll offset is pure math on the frame. Keep it that way: measured layout flickers in renders.
- `remotion.config.ts` uses `chrome-for-testing` because chrome-headless-shell crashes on this Mac (`icudtl.dat not found in bundle`).
- Times in `timeline.json` are seconds of the sped-up phone video. `AgentDemo` shifts them by the intro length from `demoSchedule`.

</details>
