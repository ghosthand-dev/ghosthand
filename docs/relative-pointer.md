---
title: Relative pointer on iOS 15
description: How iOS 15 moves the AssistiveTouch pointer for relative HID mouse reports, the measurements that prove it, the timing rules ghosthand follows, how drags work on iOS 17+, and the 90° pointer turn.
---

# Relative pointer on iOS 15

**One relative report moves the pointer a fixed distance.** The distance depends only on the size of that report. ghosthand computes the reports for any move and lands within 0.2 pt.

```
HID report (dx, dy) ──▶ IOHIDPointerScrollFilter ──▶ AssistiveTouch ──▶ pointer
                           v    = floor(sqrt(dx² + dy²))
                           move = (dx, dy) · table(v) / v        points, clamped at edges
```

Code: `daemon/Sources/ghosthand/relative-pointer.swift`. Tests: `daemon/Tests/ghosthandTests/relative-pointer-tests.swift`.

## The table

`table` is `defaultAccelTable` in IOHIDFamily, curve for acceleration 1.0. Points are 16.16 fixed values; x is scaled by 400 dpi / 67 and y by 96 / 67:

| Report speed v | Pointer moves | Slope |
|---|---|---|
| 0 to 2.6 | 0 to 0.54 pt | 0.20 pt per unit |
| 2.6 to 25.7 | 0.54 to 23.6 pt | 1.0 |
| 25.7 to 71.6 | 23.6 to 136 pt | 2.45 |
| 71.6 to 137 | 136 to 199 pt | 0.97 |
| 137 to 206 | 199 to 214.9 pt | small |
| 206 and more | **214.9 pt** (cap) | 0 |

Sources:
- [IOHIDPointerScrollFilter.cpp#L59-L74](https://github.com/apple-oss-distributions/IOHIDFamily/blob/IOHIDFamily-1787.140.2/IOHIDEventSystemPlugIns/IOHIDPointerScrollFilter.cpp#L59-L74): the table bytes
- [IOHIDAcceleration.cpp#L136-L171](https://github.com/apple-oss-distributions/IOHIDFamily/blob/IOHIDFamily-1787.140.2/IOHIDEventSystemPlugIns/IOHIDAcceleration.cpp#L136-L171): speed = floor of the vector length; time only counts when a report rate is set
- [IOHIDAccelerationAlgorithm.cpp](https://github.com/apple-oss-distributions/IOHIDFamily/blob/IOHIDFamily-1787.140.2/IOHIDEventSystemPlugIns/IOHIDAccelerationAlgorithm.cpp): table segments, flat past the last point

The parametric `HIDAccelCurves` in the same repo do **not** match the phone (off by 25% to 3x). Only the default table does.

## Measurements

iPhone 6s, iOS 15.8.4, AssistiveTouch at default Tracking Speed. Each row: home in the corner, N reports of (d, 0), pointer found in a USB frame.

| d | N | Table | Measured |
|---|---|---|---|
| 1 | 400 | 81.4 pt | 81.5 pt |
| 4 | 73 | 138.6 | 138.5 |
| 8 | 25 | 147.6 | 147.5 |
| 24 | 4 | 87.7 | 87.5 |
| 64 | 1 | 117.4 | 117.5 |
| 128 | 1 | 190.6 | 190.5 |
| 200 | 1 | 214.5 | 214.5 |

Also measured:

- **Diagonals:** (30,40) → 50.0, 66.5 pt; (3,4) × 34 → 59.0, 79.0 pt. Both as the table says.
- **Timing:** 25 × (8,0) with 0, 8, 16, 30, 60 and 100 ms gaps: 147.5 pt every time.
- **Fractions add up:** 20 × (1,0) → 4.0 pt.
- **Cap:** one (−3000,−3000) report moves 152 pt per axis, not to the corner.
- **Match gain:** 1.000 on x and y.
- **Accuracy:** 40 moves in a row, each from the last predicted spot: 0.2 pt mean error, 0.36 pt max. The pointer was found to 0.25 pt, so this is the measuring limit.

## Timing rules

| Rule | Why |
|---|---|
| Wait **150 ms** after homing | After a report hits an edge, iOS drops moves for up to ~100 ms: 3 of 8 reports lost with a 40 ms pause, none with 100 ms |
| Wait **100 ms** between the last move and a press | Presses 0 to 30 ms after a move burst were lost, and twice opened Notification Center. 60 ms and more worked every time |
| Do not home before every tap | Homing pushes into the top edge. Keep the model's position and home only when it is unknown (daemon start, reconnect, rotation, 60 s idle) |
| Keep targets inside the screen | A clamped report makes the tracked position unreliable, so the next move homes again |

## Not tested

- Tracking Speed other than the default. Matching fits a `gain` that scales the table. If another speed changes the table shape, taps miss by a few points and the match log shows different x and y gains.
- iOS 16, and iPhones other than the 6s.

## Drags on iOS 17 and later

**The AssistiveTouch finger follows only relative motion.** SE2, iOS 18.6.2, absolute pointer, Perform Touch Gestures on. With the button down, absolute reports (report 1) move the pointer but not the finger: every swipe was a long tap at its start point (Home Screen opened Music, a widget or the AssistiveTouch menu; held longer, edit mode). Report 1 buttons are ignored; report 7 carries them.

```
report 7 button down ──▶ report 7 (dx, dy) ...  ──▶ finger follows   ──▶ report 7 button up
report 1 (x, y) while down                      ──▶ pointer jumps, finger stays
```

So both pointer modes drag with report 7. ghosthand puts the pointer on the start point with report 1, drags with report 7, then sends report 1 at the end point (the pointer is exact again).

**The curve is not the iOS 15 table.** Points per report of (d, 0), hover, any gap from 0 to 50 ms:

| d | 3 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 32 |
|---|---|---|---|---|---|---|---|---|---|
| pt | 1.09 | 1.63 | 3.01 | 4.72 | 6.83 | 9.27 | 12.12 | 15.35 | 54.67 |

`distance = len · (a + b · len)` fits within 2% (a 0.226, b 0.0458 here; Tracking Sensitivity was below default). A diagonal (6, 6) moved 5.0 pt, ~4% under the model. Since `a` and `b` follow Tracking Sensitivity, `Controller.dragCurve` fits them on the first swipe of each Bluetooth connection: 12 reports of (6, 0) and 5 of (14, 0), each spot found in a frame diff on one row (3 rows tried).

**iOS ignores an absolute report equal to the last one.** After relative moves, sending the same (x, y) again does not move the pointer back.

**Drag rules found on the phone:**

| Change | Result |
|---|---|
| Reports up to length 16 (~15 pt each) | Safari read the drag as a long press (link preview); Settings did not scroll |
| Reports up to length 8 (~4.7 pt each) | Settings and Safari: 136-141 pt for a 150 pt drag, 200 to 1000 ms |
| Bell-shaped speed (slow start), 300-1000 ms | Home Screen entered edit mode |
| Steady 225 pt/s / 112 pt/s | page changed / edit mode |
| Fast start, slow end (`1 - (1 - t)^2.5`), 250 to 2000 ms | page changed |
| Start on a widget, 400-1000 ms / 200 ms | widget opened / page changed |
| No 80 ms pause before release | no clear momentum in Safari; swipes move by the drag length |

`hold-drag --hold 2500` now moves Home Screen icons with Perform Touch Gestures on (it did not with absolute drags).

## Pointer space turned 90° (iOS 17 and later)

**iOS can map every mouse report turned by 90°.** backboardd keeps its pointer space in its "last effective interface orientation": the last accelerometer orientation that was not flat, not the screen's orientation (`BKMousePointerController` reads it on `deviceOrientationMayHaveChanged`; it logs `Last effective interface orientation changed to:` only on change). A phone lying on its side, or laid flat after it was held sideways, turns the pointer while portrait-only screens (Home Screen, Settings) stay portrait. springboardservices `getInterfaceOrientation` returns the screen's orientation, so it cannot detect this. Seen on an SE2, iOS 18.6.2, a day after a landscape test: the screen was portrait (springboard orientation 1), but backboardd logged `region arrangement bounds: {{0, 0}, {667, 375}}`.

```
report (u, v) ──▶ pointer at screen (1 - v, u)        absolute reports
report (dx, dy) ──▶ pointer moves (-dy, dx)           relative reports, drags too
```

| Input | Result before the fix |
|---|---|
| tap `40,42` (back button) | pointer at `350,71`, nothing tapped |
| swipe `2,300 -> 250,300` (back gesture) | drag from `206,3` down: Notification Centre |
| first swipe of a connection | "could not measure the drag speed" (moves were vertical) |

Wheel scrolling was not turned. Only a physical turn of the iPhone resets it; AssistiveTouch off/on, Bluetooth reconnects and a daemon restart do not.

**The fix measures the turn** (`BluetoothDriver.pointerTurn`): absolute reports at 2 spots, then the newest USB frames until the pointer shows at one of the 4 places each spot lands under a turn. Exactly one turn must match both spots. Then every absolute position and relative report goes through `PointerTurn`. It runs once per lease, on the first pointer input (about 0.4 s); the iPhone is assumed not to be turned during a lease.

- **USB frames lag the report.** One frame 200 ms after the report still showed the old screen on the Home Screen. The check polls the newest frames for up to 1 s.
- **The pointer is a translucent dark disk.** On a dark wallpaper it changed gray by 17 (threshold was 24). The check uses threshold 10 (frames are lossless) and the mirror of its 2 spots with the brightest background. On a black background it can still fail; then the last known turn is used and the log says so.
- backboardd logs exact positions at debug level (`-> model point (HID abs) 133.388,74.9931`, then `Pointer 300.007,133.388 (global)`, syslog relay). Useful to debug; the fix does not depend on these log lines.

## Findings log

Found in opencode session `ses_f183f876dffeunVOl7gtSaEhIW` (Discord thread 1554090899112468580), on 2026-09-28.

**Rejected ideas:**

| Idea | Why not |
|---|---|
| IOHIDFamily parametric `HIDAccelCurves` | Off by 25% to 3x on the phone. iOS uses `defaultAccelTable` |
| Constant 10-unit steps every 16 ms (old code) | Correct but slow (1-3 s) and quantized: up to half a step (~3.4 pt) off per move |
| One huge report to home | Capped at 214.9 pt per report; homing needs several |
| Declare a higher resolution in the descriptor | Changes only the unit, not the curve (`IOHIDEventService.cpp` resolution math) |
| Turn acceleration off | No setting on iPhone; a HID device cannot set `NoAcceleration` |
| Absolute or digitizer reports | iOS 15 AssistiveTouch dropped them over BLE (not tested over Classic); absolute works from iOS 17 |
| Closed loop: check each tap with a frame | Not needed: open loop lands within the measuring limit (0.25 pt) |

**Bluetooth pairing trap (seen while testing):** after the phone was reset, the Mac still had a bond ("iPhone", `Peer removed pairing information` in the daemon log) and pairing failed. Removing the Mac's bond (`blueutil --unpair <address>`) fixed it. Do it only once: running it again after the phone re-paired deleted the new bond, and the phone showed "Connesso" but never subscribed (BLE). Over Classic, a stale bond made the iPhone reject the Mac's channels; forget the Mac on both sides and pair again.

**Open issue:** `ghosthand lock` (Control-Command-Q) did not lock the iPhone 6s on iOS 15.8.4 in this session. Not investigated.

Experiment script: `tmp/phase0.py` (git-ignored). It used a temporary `/debug/pointer` daemon route that sent raw reports and saved frames; the route was removed after the measurements.
