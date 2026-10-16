---
title: TapKit promo video breakdown
description: Storyboard, script, footage list, cut plan and improvements for the TapKit launch video by @tj_littlejohn. Use to make a ghosthand video in the same format.
---

Source: https://x.com/tj_littlejohn/status/2104614327802282271
Local copy: `~/Downloads/tapkit-tj-littlejohn.mp4` (3840x2160, 30 fps, 46.25 s, 1 voice track + music, no sfx found)

## Format in one line

Talking head on brick wall + 3D desk render + side-by-side screen demo + one real 3-phone shot + black logo end card. 7 shots, ~45 s, voice carries everything.

## Script (whisper small, timestamps checked)

| Time | Line |
|---|---|
| 0.0 | All these apps are being used by agents on these iPhones. |
| 4.4 | This is TapKit. |
| 5.6 | TapKit is a Mac app that lets agents use your iPhone. |
| 9.5 | You can tell it to do anything. |
| 11.1 | Like "order me a Waymo to the restaurant that Tom sent in the group chat", |
| 16.1 | and your agent will just use the apps on your phone like you do. |
| 20.0 | You are not limited to one device. |
| 22.2 | Your agent can use multiple iPhones at the same time. |
| 26.4 | This one is booking you a flight on JetBlue. |
| 29.5 | This one is doing market research on Reddit, |
| 33.0 | and this one is making a reservation on OpenTable. |
| 36.5 | Anything that you do on your phone, your agent can do. |
| 40.0 | You can download the app today at tapkit.ai. |

~100 words in 43 s = ~140 wpm. Short sentences, one idea each. Hook line is the payoff, said first.

## Storyboard (cuts from scene detection: 4.3, 9.4, 18.9, 23.5, 36.6, 43.2)

| # | Time | Visual | Type | Origin |
|---|---|---|---|---|
| 1 | 0.0-4.3 | Desk, brick wall, 6 phones on stands (2 left, 2 right), Studio Display showing 4 phone mirrors, Mac mini, keyboard, trackpad. App icons float above phones: WhatsApp, Hinge, Reddit, OpenTable. Slow push-in. | 3D render + 2D icons | **Code / CGI** |
| 2 | 4.3-9.4 | Presenter (black hoodie, blue cap, beard), brick wall + plant, medium close-up. TapKit blue icon pops top right at 5.4. At ~7 s four cartoon agent avatars pop top left. | Talking head + 2D pop-ins | **Record** + code overlays |
| 3 | 9.4-18.9 | White bg. Titles "TapKit on your Mac" (left) / "Your iPhone" (right), rounded panels. Left: Mac app, phone mirror + agent chat (prompt bubble, Tap, Tap, Wait 2s, reply). Right: real phone, same screen, on stand. Footer "Elapsed time 0:08 / 0:38 (3x speed)" counts up. Flow: Messages group chat (Hog Island Oyster Co.) then Waymo, choose dropoff, Apple Pay $15.67. | Split screen | **Record** (screen + phone), **code** for frame/labels/timer |
| 4 | 18.9-23.5 | Back to presenter, same framing. | Talking head | **Record** |
| 5 | 23.5-36.6 | 3 phones in a row on black stands, wood table, brick wall, dark grade. Left JetBlue (SFO to JFK), middle Reddit search, right OpenTable (Wayfare Tavern, party size). Soft gray touch dot shows taps. Slow camera drift. | Hero shot | **Record or render** (looks like real footage with a CGI-clean look; wall and wood are very uniform) |
| 6 | 36.6-43.2 | Presenter again. App icons orbit/pop at edges: Airbnb, Hinge, Spotify, Gmail, UberEats, TikTok, LinkedIn, Slack, Instagram. | Talking head + 2D | **Record** + code overlays |
| 7 | 43.2-46.2 | Black, centered blue icon + "tapkit" wordmark + "tapkit.ai" small gray. Music fades. | End card | **Code** |

Note: shots 2, 4, 6 are probably one continuous take, cut up and re-ordered. Same framing, same light. Cuts happen at sentence ends, so the voice is the edit grid.

## Footage list (what you need to own)

**Record IRL**
1. Presenter A-roll, one 4K take of the whole script, 16:9, fixed camera, face + hoodie, brick or plant background. Do 2 takes. Wide shot at chest height.
2. Real phone clip for shot 3: one phone on a stand, running the Waymo task. Same take as the screen recording, so taps match.
3. Screen recording of the Mac app for shot 3 (phone mirror + agent log), same run. 38 s real time, shown at 3x.
4. Shot 5: 3 phones running 3 tasks at once. Film at 60 fps, 4K, macro lens, shallow focus, dark room, same background. Add a 10 s margin of footage.

**Generate with code** (Remotion, see `demo-video/`)
1. Shot 1 desk scene (Blender/Three.js render, or one nano-banana / GPT image still + slow push-in, then composite real screens).
2. All app icons pop-ins, spring in with overshoot, soft shadow.
3. Agent avatars pop-in.
4. Split-screen frame: titles, rounded corners, elapsed timer (`frame / fps * 3`), speed-up of recorded clips.
5. Captions (none in the original, see improvements).
6. End card + music fade.

**Music**: one upbeat electronic loop, ducked under voice, about -20 dB under voice. No sfx.

## Cut plan

```
0 ─────── 4.3 ────── 9.4 ───────────── 18.9 ─ 23.5 ──────────── 36.6 ──── 43.2 ─ 46.2
 [1 render] [2 face ] [3 split screen   ] [4 face] [5 3 phones      ] [6 face ] [7 card]
 voice:     hook→name  what it does+demo   multi    3 tasks           close+CTA   silence
```

Rules observed:
- Cut on sentence ends, never mid sentence. Cuts: 4.3, 9.4, 18.9, 23.5, 36.6, 43.2.
- Face shots are short (4-5 s, 4 s, 7 s). B-roll takes the long beats (10 s, 13 s).
- B-roll narrates what voice says: "multiple iPhones" lines up with 3 phones; "Waymo" with the Waymo screen.
- Overlays (icons) enter 0.2-0.5 s after the word they refer to. Icon pops land on the beat of "TapKit".
- Hard cuts only, no crossfades. The end card is a hard cut to black.
- Presenter face returns every ~10 s so the viewer does not lose the human.

## How to make the same video for ghosthand

Ghosthand is the same product class, but with a hardware angle (USB + Bluetooth, no app on the phone). Reuse `demo-video/` (Remotion) and record with `ghosthand record start` + `log.jsonl`.

| Shot | Ghosthand version |
|---|---|
| 1 | Render or generate image of Mac + 4-6 iPhones on stands, icons floating. Code it as a Remotion scene. |
| 2 | Record presenter. Pop in ghosthand logo + agent avatars (Claude Code, Codex, OpenCode, Cursor logos). |
| 3 | Left: terminal / Claude Code running `ghosthand` commands (not a GUI chat). Right: real phone. Timer 3x. Reuse `demo-video` split layout. |
| 5 | 3 phones, each with its own lease (`ghosthand acquire`), 3 tasks in parallel. Real footage. |
| 6 | Icon orbit: same idea. |
| 7 | End card with `npx ghosthand` / ghosthand.dev. |

## Improvements

1. **Captions.** The original has none. 85% of X autoplay is muted. Burn in word-level captions (whisper word timestamps, 2-3 words per line, bold, bottom third).
2. **Hook in the first 1.5 s.** Start with the Waymo order, running, not a desk. "Watch an agent order a Waymo with no API." Then the desk.
3. **Proof of real, not render.** Shot 1 and 5 look CGI. Viewers on X distrust it. Use real phones, one continuous unedited shot of the 3 phones with the screen counter on.
4. **Show the result.** The original never shows the Waymo arriving or the booking confirmed. End the demo with a "done" frame or a real notification.
5. **Prompt on screen.** In shot 3, make the prompt bigger and type it live. The viewer must read it in 2 s.
6. **Cut the "doing it by hand" part.** Show the agent hands-free: phone untouched, no human finger. A zoom on the phone with a tap dot proves it.
7. **Add sfx.** Soft taps for icon pops, a whoosh on the cut to the end card. Original has none, so it feels flat.
8. **Vertical cut.** Make a 9:16 version for TikTok, Reels, Shorts. Shots 2, 4, 6 crop well; shot 3 needs a stacked layout (phone top, terminal bottom).
9. **End on CTA with the install command**, not only a URL. Hold 3 s with a QR code.
10. **Tighter script.** Drop "You can tell it to do anything." and "Anything that you do on your phone, your agent can do." for a 35 s version. Keep only one claim per shot.

## Pipeline (all CLI)

```
whisper (mlx_whisper, word timestamps) ──> captions.json ──┐
ghosthand record + log.jsonl ──> prepare.ts (speedup) ─────┼──> Remotion composition ──> mp4
presenter 4K take ──> trim by sentence times ──────────────┤     (overlays, timer, end card)
Blender/AI still ──> push-in ──────────────────────────────┘
```

Tools used for this analysis: yt-dlp (download), ffmpeg (audio, scene detect at 0.15, frame sheet), mlx_whisper `whisper-small-mlx` (large-v3-turbo weights failed to load, corrupt cache), Gemini video describe (shot list). No API keys from Sigillo were needed.
