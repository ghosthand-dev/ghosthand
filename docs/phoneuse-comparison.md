---
title: phoneuse vs ghosthand
description: How lxe/phoneuse drives an iPhone (AirPlay screen + Bluetooth HID), how it compares to ghosthand, and which ideas are worth copying.
---

# phoneuse vs ghosthand

[lxe/phoneuse](https://github.com/lxe/phoneuse) (MIT, Python, ~5.4k lines, read from `master` on
Nov 7 2026, a few days old) is the **same input idea** as ghosthand: the computer is a Bluetooth
Classic HID mouse + keyboard, and AssistiveTouch turns the pointer into touches. The **screen** is
different: it comes over AirPlay Screen Mirroring (Wi-Fi), not USB. It runs on one Linux box
(BlueZ, Hyprland, GStreamer, NVIDIA optional), for one iPhone 17 Pro on iOS 26.

```
                AirPlay H.264 (Wi-Fi)                                Bluetooth HID (BlueZ, root)
 iPhone ──────────────────────────▶ UxPlay ──RTP──▶ hub.py ───────────────▶ hid_daemon.py ──────▶ iPhone
                                                  decode once,     ▲  /run/phoneuse-hid.sock
                                                  re-encode with   │  "a X Y B", "m DX DY W B", "k MODS KEYS"
                                                  keyframe on join │
                      ┌──────────────────────────┼──────────────┐ │
                      ▼                          ▼              ▼ │
                window.py (GTK)          web.py (WebCodecs)  frames.py ── settle, screenshots
                + mirror_input.py         browser mirror        │
                      │                   + Take over           ▼
                      └──── pointer.py ────────┘          cli.py / mcp_server.py ──▶ vision.py
                            live hover / drag / wheel                              (RapidOCR + GoClick)
```

## How it works

### HID daemon (`phoneuse/hid_daemon.py`, `sdp_record.xml`)

- Registers a HID profile with BlueZ and **owns PSM 17/19 directly**. `install.sh` disables
  bluetoothd's `input` and `hostname` plugins (the PC can no longer use Bluetooth mice itself).
- Report map: 1 keyboard, 2 relative mouse (8-bit dx/dy/wheel), 3 absolute pointer (0..32767),
  4 consumer **Eject** (one bit). Eject toggles the iPhone's on-screen keyboard while a hardware
  keyboard is connected.
- Line protocol on a unix socket: `a FX FY BTN`, `m DX DY WHEEL BTN`, `k MODS CODES`, `type`, `eject`.
- **Link tuning:** after every connect it sends raw HCI commands: Write Link Policy (role switch
  only, **no sniff**) and **QoS Setup with 8 ms latency**, repeated every 20 s. Their note: the
  iPhone, as link master, otherwise polls the device only every ~50 ms (~20 pointer updates/s);
  with QoS it drops to ~2 ms, like a real mouse.
- Reconnect: pages paired phones with backoff 5 s up to 30 s. Their reason: paging without pauses
  keeps the radio busy and misses the iPhone's own connection attempts.
- Trust on first use: the first address that connects is written to `/etc/phoneuse/allowed`;
  everything else is rejected. Always discoverable, "Just Works" pairing.

### Touches (`phoneuse/touch.py`, `phoneuse/pointer.py`)

Measured on iOS 26 (iPhone 17 Pro), matching most of what we found on iOS 18:

| Fact | phoneuse | ghosthand |
|---|---|---|
| Absolute report lands exactly | yes | yes (`bluetooth-hid.swift` report 1) |
| Button counts only from absolute | yes | we send the button in report 1 **and** 7 (`absoluteButtons`), iOS 18 reads report 7 |
| Absolute move while held ends the touch | after ~90 ms | same finding: drags use relative motion |
| Drag = abs press, relative motion, abs release | yes | yes (`sendDrag`) |
| Pause between jump and press | 0.1 s (0.2 s from unknown position) | 80 ms, 60 ms for flicks, 100 ms relative |
| Relative report pacing | **one report every 8 ms, empty ones too**; faster reports are dropped | flicks go out in **one burst** (gap 0); "time plays no part" measured on SE2 iOS 18.6 |
| Report size to distance | lookup table `DRAG_PTS`, rounded down so it never overshoots | quadratic `DragCurve` fitted **per phone and per connection** from frame diffs |
| Mouse wheel | "iOS ignores it", wheel becomes a drag | works, with a 2-report lead-in (`docs/scroll.md`) |

`pointer.py` streams live input: hover sends absolute reports (max 250/s), press touches down
**where the phone pointer already is** (so the press carries no position change), then a tick
every 8 ms sends the mouse delta as a relative report with carry-over, and release lifts at the
touch position. A wheel step starts a short drag at the pointer and lifts 50 ms after the wheel
stops; more wheel steps extend the same drag. Presses on the bezel start at the nearest edge.

Scripted gestures (`cli.py`): `back` = swipe from x=0, `control-center` and `notifications` =
slow 0.6 s swipe from the top corners (fast top swipes are ignored), `switcher` = slow swipe up +
hold, `dismiss` = fast swipe from the bottom, `home` = Cmd+H, `open APP` = home, Cmd+Space, type,
Enter, each step waiting for settle.

### Screen and settle (`phoneuse/hub.py`, `phoneuse/frames.py`)

- iOS sends one keyframe when mirroring starts, then none. `hub.py` decodes once, keeps the last
  frame, and re-encodes it (NVENC or x264, no B-frames) with a fresh keyframe whenever a viewer
  joins. Viewers restart freely; only the hub needs mirroring restarted.
- `nvh264dec compliance=flexible`: a default H.264 decoder held each frame until the next one
  (200 ms) because iOS sends frames only on change.
- `frames.py` decodes **every frame** and keeps a counter `seq` of meaningful changes:
  - luma thumbnail (every 16th pixel), a cell differs at >12, a change is >0.4% of cells;
  - **per-cell motion history:** a cell moving without a 0.6 s pause for over 1 s is
    "dynamic" (video, animated banner), grown by 3 cells, and **ignored**;
  - a change ≥5% of the picture is "big".
- `settle SINCE`: wait up to 0.6 s for the first change after `SINCE` (the `seq` taken right
  before the first HID command, after any OCR lookup), then until 0.1 s with no change. After
  0.4 s only big motion keeps it waiting; small endless motion is "ambient". Event driven
  (condition variable), no polling, hard limit 3 s. The reply says `still`, `ambient` and the
  share ignored, and the CLI turns that into a note for the agent.

### Agent front ends (`phoneuse/cli.py`, `phoneuse/mcp_server.py`, `phoneuse/vision.py`)

- MCP (stdio) actions return a **strip** by default: frames at +0.1, +0.4 and +0.8 s side by side
  in one JPEG (identical ones dropped, ~625 tokens), plus OCR text of the last one. No settle wait;
  the agent sees motion and calls `wait(seconds)` if needed. `look="both"` gives a settled shot.
- `text`: RapidOCR (PP-OCRv6 small, ONNX, ~0.18 s GPU / 1.2 s CPU), drops the status bar and
  glyph-only lines, maps the back chevron to `[back]`, and adds **`[switch on]` / `[switch off]`**
  from green/grey pill detection (dark mode only).
- `tap-on WHAT`: exact OCR line, then unique prefix, then fuzzy match (ratio ≥0.85 and clearly
  ahead of the next). Non-visual words not on screen are refused. Visual words ("gear icon") go to
  **GoClick-Large** (Florence-2 grounding, ~50 ms warm); it always answers, so a tap in the status
  bar is refused (Dynamic Island = Stop Mirroring).
- `type` replaces the field by default (Cmd+A first). Typing refuses on the lock screen.
- **Interference note:** if the frame counter moved since the agent's last look and the agent did
  not act, the next action says "someone may be using the phone".

### Browser mirror (`phoneuse/web.py`, `phoneuse/web/index.html`)

- WebSocket H.264 to WebCodecs, localhost only, same-origin checks on POSTs.
- Every agent action POSTs `/api/agent/act`: the page **glows**, shows a **dot where the agent
  points** (from every absolute report), and ignores page input while the agent drives.
- **Take over** makes the agent's next action fail (409) with "the user took over; stop and wait"
  until the user clicks Resume agent. `end_session` hands control back at once; otherwise 20 s idle.
- **Unlock with approval:** the owner saves the passcode in the page (file, mode 600). `unlock`
  shows an approve/deny banner and a desktop notification; on approval it types the code once,
  never retries, max 3 per hour. The agent never sees the passcode.

### Debug tools

`touchlab/index.html` is a web page **on the phone** that shows the touch events iOS produced;
`tools/telemetry.py` records mouse events, cursor, btmon reports and a 60 fps mirror video, and
`telemetry_analyze.py` lines them up. This is how they found the 90 ms and 8 ms rules.

## Comparison

| | phoneuse | ghosthand |
|---|---|---|
| Host | Linux + BlueZ + Hyprland | macOS, signed app, npm |
| Screen | AirPlay over Wi-Fi, ~100 ms | USB capture (AVFoundation), ~60 fps |
| Cable | none | USB (also gives files, photos, apps, logs) |
| Risks of screen path | Dynamic Island tap stops mirroring; must start mirroring by hand on the phone | some system dialogs hidden from USB capture (`--native` fallback) |
| iPhones | one | many per Mac, many Macs (tunnel) |
| Input modes | Bluetooth only | Bluetooth (absolute + iOS 15 relative) and XCTest |
| Drag model | fixed table from one phone | per-phone fitted curve, rotation-aware (`PointerTurn`) |
| Motion style | straight, robotic timing | human-like: eased approach, random flick profiles |
| System UI | edge swipes | keyboard: Consumer Menu home, fn+c / fn+n / fn+up |
| Scroll | wheel turned into drags | real wheel with lead-in |
| Settle | every frame, dynamic regions masked, ~0.1 s quiet | frames 150 ms apart, video waits the full 2 s |
| Action result | strip of 3 frames + OCR (MCP default) | one settled screenshot and/or OCR, opt-in |
| OCR | RapidOCR + switch states + `[back]` | Apple Vision, with language option |
| Tap by text | exact, prefix, fuzzy; icons via grounding model | exact or contains, `--index` for duplicates |
| Concurrency | browser "Take over", 20 s agent session | leases with reasons, wait, idle timeout |
| Remote | none (localhost) | remote MCP with OAuth, API tokens |
| Unlock | owner approves each unlock; agent never sees the code | agent pipes the passcode from Sigillo |
| Live user control | streamed hover, held drag, wheel, bezel edges | Take Control: discrete tap / swipe / key after the gesture |
| Phone task agent | none | `ghosthand task` on ghosthand.dev |

## Ideas worth copying, ranked

1. **Ignore video regions in settle.** Keep a per-cell "moving since" time in the thumbnail diff and
   mask cells that move without pause for over ~1 s; return early when only small motion is left
   after ~0.4 s, and report it. Today a playing video (TikTok, Reels) makes every settled
   screenshot wait the full 2 s cap after the reaction.
   Theirs: `phoneuse/frames.py` (`_changed`, `settle`). Ours: `controller.swift` `settledFrame`,
   `capture.swift` thumbnails.
2. **Bluetooth link latency (research first).** No sniff + HCI QoS Setup at 8 ms took their poll
   interval from ~50 ms to ~2 ms. Our flick code already works around ~40 ms delivery bursts. We do
   not know yet if macOS bluetoothd lets us set link policy or QoS for a Classic link from
   `Sources/ClassicBluetooth`. Theirs: `hid_daemon.py` `tune_link`. Ours: `bluetooth-hid.swift`,
   `bluetooth-driver.swift` `sendDrag` (the comment there still says BLE).
3. **Take Control pauses the agent.** While the user is in Take Control, the lease holder's next
   input fails with a clear "the user took control; stop and wait" error until Release, and the
   live view shows a dot where the agent taps. Plus their interference note: tell the agent when
   the screen changed since its last look without its own input.
   Theirs: `web.py` (`agent_acts`, `take_over`, `agent_cursor`), `cli.py` `agent_turn`.
   Ours: `control-plane.swift`, `setup-app.swift` (`/v1/phones/{id}/...`), `controller.swift` `withLease`.
4. **Unlock with owner approval.** Passcode stored on the Mac (Keychain), agent calls `unlock`, the
   control plane or a macOS notification asks Unlock / Deny, the daemon types it once. The agent
   never handles the secret. Theirs: `unlock.py`, `web.py` `UnlockRequests`. Ours: `main.swift`
   `unlock`, `bluetooth-driver.swift` `unlock`.
5. **Eject key: show or hide the on-screen keyboard.** Consumer usage 0xB8 already fits our consumer
   report (0...0x174), so `key eject` needs no re-pairing. Useful for suggestions, emoji and
   checking what the field holds. Theirs: `hid_daemon.py` report 4. Ours: `bluetooth-hid.swift`
   `Keys.consumer`. Test on a phone first.
6. **Switch states in `screentext`.** OCR cannot read toggles; add `[switch on]` / `[switch off]`
   lines from pill detection (do light mode too, theirs is dark only). Also map the back chevron.
   Theirs: `screen.py` `find_switches`, `cli.py` `screen_text`. Ours: `OCR.screenText` in the daemon.
7. **A touchlab page for gesture tests.** A page on ghosthand.dev, opened in Safari on the test
   iPhone, that draws and logs every touch (start, path, end, timing). Exact ground truth for drags,
   flicks and edge swipes instead of pointer hunting in frame diffs. Theirs: `touchlab/index.html`.
   Ours: `dragCurve` and `findTurn` in `bluetooth-driver.swift`, `docs/relative-pointer.md`.
8. **Verify burst vs 8 ms pacing on iOS 26.** They measured that relative reports less than ~8 ms
   apart are dropped on iOS 26; we measured no timing effect on iOS 18.6 and send flicks in one
   burst. Check flick distance on an iOS 26 phone. Ours: `sendDrag` (`flickSampleMs`, `paced`).
9. **Optional motion strip.** A `--screenshot strip` mode returning 2-3 frames over ~0.8 s in one
   image lets an agent see transitions and loading without waiting for settle. Theirs:
   `mcp_server.py` `_strip`. Ours: `AfterInput` and `ImageFile` in the daemon, MCP tools.
10. **Fuzzy fallback for `tap --text`.** One clearly best close match (OCR dropped a letter) instead
    of "not found". Theirs: `cli.py` `text_target`. Ours: tap target resolution in `controller.swift`.
11. **`back` and `open <app>` helpers.** A left-edge swipe for Back (we say "no verified global
    Back key") and one command for Spotlight open with settle between steps. Theirs: `cli.py`
    `back`, `open_app`. Ours: `main.swift` key help.
12. **Live Take Control.** Stream hover, held drags and wheel instead of sending a swipe after the
    gesture ends. Theirs: `pointer.py`. Ours: `control-plane.swift` `PhoneInput`.
13. **Reconnect backoff.** Page every 5 s up to 30 s instead of a fixed 5 s, so the radio does not
    miss the iPhone's own reconnect. Theirs: `reconnect_loop`. Ours: `HIDDevice.reconnectEvery`.

## Where we are ahead

- **No network dependency:** USB capture needs no Wi-Fi, no manual Screen Mirroring start, no
  Stop Mirroring risk, and gives lockdown services (files, photos, apps, syslog, restart).
- **Scale:** several iPhones per Mac, several Macs, leases with reasons, remote MCP and API tokens.
- **Input coverage:** iOS 15 relative pointer with the IOHIDFamily table, per-phone drag fit,
  rotation detection, XCTest mode, keyboard system shortcuts (Home via Consumer Menu, Globe
  shortcuts for Control Center, Notification Center, App Switcher), working wheel scroll, mute
  confirmed from syslog, hidden-dialog native screenshots.
- **Human-like input:** eased approaches, random flick profiles, varied typing gaps. phoneuse
  taps hold 60 ms and moves in straight lines.
- **Product:** signed and notarized app, auto-update, setup app, control plane, task agent, Strada.

Their scroll note shows a bug we already solved: they send one wheel report per notch, and
IOHIDScrollAccelerator drops the first 2 reports after 500 ms idle, so small scrolls do nothing.
That is likely why they conclude "iOS ignores the wheel" (`docs/scroll.md`).
