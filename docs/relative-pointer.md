---
title: Relative pointer on iOS 15
description: How iOS 15 moves the AssistiveTouch pointer for relative HID mouse reports, the measurements that prove it, and the timing rules iphonectl follows.
---

# Relative pointer on iOS 15

**One relative report moves the pointer a fixed distance.** The distance depends only on the size of that report. iphonectl computes the reports for any move and lands within 0.2 pt.

```
BLE report (dx, dy) ──▶ IOHIDPointerScrollFilter ──▶ AssistiveTouch ──▶ pointer
                           v    = floor(sqrt(dx² + dy²))
                           move = (dx, dy) · table(v) / v        points, clamped at edges
```

Code: `Sources/iphonectl/relative-pointer.swift`. Tests: `Tests/iphonectlTests/relative-pointer-tests.swift`.

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

## Findings log

Found in opencode session `ses_f183f876dffeunVOl7gtSaEhIW` (Discord thread 1554090899112468580), on 2026-09-28.

**Rejected ideas:**

| Idea | Why not |
|---|---|
| IOHIDFamily parametric `HIDAccelCurves` | Off by 25% to 3x on the phone. iOS uses `defaultAccelTable` |
| Constant 10-unit steps every 16 ms (old code) | Correct but slow (1-3 s) and quantized: up to half a step (~3.4 pt) off per move |
| One huge report to home | Capped at 214.9 pt per report; homing needs several |
| Declare a higher resolution in the descriptor | Changes only the unit, not the curve (`IOHIDEventService.cpp` resolution math) |
| Turn acceleration off | No setting on iPhone; a device cannot set `NoAcceleration` over BLE |
| Absolute or digitizer reports | iOS 15 AssistiveTouch drops them; absolute works from iOS 17 |
| Closed loop: check each tap with a frame | Not needed: open loop lands within the measuring limit (0.25 pt) |

**Bluetooth pairing trap (seen while testing):** after the phone was reset, the Mac still had a bond ("iPhone", `Peer removed pairing information` in the daemon log) and pairing failed. Removing the Mac's bond (`blueutil --unpair <address>`) fixed it. Do it only once: running it again after the phone re-paired deleted the new bond, and the phone showed "Connesso" but never subscribed.

**Open issue:** `iphonectl lock` (Control-Command-Q) did not lock the iPhone 6s on iOS 15.8.4 in this session. Not investigated.

Experiment script: `tmp/phase0.py` (git-ignored). It used a temporary `/debug/pointer` daemon route that sent raw reports and saved frames; the route was removed after the measurements.
