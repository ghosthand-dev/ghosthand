---
title: Scrolling with the HID mouse wheel
description: How `iphonectl scroll` sends wheel reports, what iOS does with them, and the numbers measured on an iPhone XR (iOS 18.7).
---

# Scrolling with the HID mouse wheel

`iphonectl scroll down 5` scrolls **like a real mouse wheel**. It does not drag.

```
scroll down 5
   │
   ├─ move pointer to --at (default: screen center), wait 100 ms
   ├─ 2 lead-in reports   ──▶ iOS drops them (start of the scroll gesture)
   ├─ 5 reports, wheel=+3, one every 16 ms  ──▶ ~100 pt each
   └─ wait 200 ms
```

## Why not swipe

**A drag on a list row is a tap.** In Settings lists and pickers (UITableView), `swipe` taps the row where it starts. In the Clock city picker a swipe added a city. The wheel scrolls these lists.

## The report

**No descriptor change.** Report id 7 (relative mouse) already has a signed 8-bit Wheel field (Generic Desktop 0x38, logical -127...127):

```
report 7: [buttons, dx lo, dx hi, dy lo, dy hi, wheel]
wheel:    [0,       0,     0,     0,     0,     +3]    positive = content further down
```

`HIDDevice.sendWheel` clamps to -127...127 (-128 is outside the logical range). The absolute report 1 has no wheel; iOS still scrolls from report 7 while it uses the absolute pointer.

## Measured (iPhone XR, iOS 18.7, Bluetooth Classic)

Wait 3.5-4 s after each scroll, then compare `screentext` y positions of the same lines.

| settings | ticks: movement |
| --- | --- |
| value 1, 16 ms, no lead | 1-3: **0 pt**; 4: 55; 5: 116; 6: 186 |
| value 1, 50 ms, no lead | 1-3: 0; 4: 31; 5: 80 |
| value 3, 16 ms, no lead | 1-2: **0**; 3: 91; 4: 195; 5: 305 |
| value 3, 32 ms, no lead | 2: 0; 3: 88; 4: 181 |
| value 6, 16 ms, no lead | 2: 0; 3: 118; 4: 259 |
| **value 3, 16 ms, lead 2 (shipped)**, Safari | 1: 90-97; 2: 193-199; 3: 301-304; 4: 421; 5: 520-546 |
| same, Clock city list (UITableView) | 1: 127; 2: 248; 3: 339; 5: 580-585 |

- **iOS drops the first reports of every scroll**: 2 with value 3 or more, 3 with value 1. `scroll` sends 2 lead-in reports so every tick counts.
- **Direction**: raw positive wheel shows content further down. `up` moves the same distance back.
- **Timing matters** (acceleration): slower reports move less. Keep 16 ms.
- **Link state can change the scale.** One run before a daemon restart moved 380 pt for 5 ticks with value 1; after the restart the same command moved 116 pt. Value 3 with lead 2 gave the same numbers across three daemon restarts.
- One outlier: `scroll down 2` once moved 99 pt instead of ~195.
- Not measured: more than ~6 ticks in one call (the shift is larger than the screen, so the same lines are not on both screenshots). Acceleration makes later ticks a little longer (~110 pt at 5 ticks).

## What iOS does with a wheel report

1. **IOHIDEventService** marks a service with a Wheel (or Z) usage as a scroll device and sets a default scroll resolution of 9 when the element has no physical units. [IOHIDEventService.cpp](https://github.com/apple-oss-distributions/IOHIDFamily/blob/IOHIDFamily-1787.140.2/IOHIDFamily/IOHIDEventService.cpp) (parseSupportedElements, `kHIDUsage_GD_Wheel`, `kDefaultScrollFixedResolution`)
2. **IOHIDPointerScrollFilter** matches Mouse and Pointer services and passes each scroll event with its timestamp to `IOHIDScrollAccelerator`. [IOHIDPointerScrollFilter.cpp](https://github.com/apple-oss-distributions/IOHIDFamily/blob/IOHIDFamily-1787.140.2/IOHIDEventSystemPlugIns/IOHIDPointerScrollFilter.cpp) (`filter`, `setupScrollAcceleration`)
3. **IOHIDScrollAccelerator::accelerate** explains the measurements. [IOHIDAcceleration.cpp](https://github.com/apple-oss-distributions/IOHIDFamily/blob/IOHIDFamily-1787.140.2/IOHIDEventSystemPlugIns/IOHIDAcceleration.cpp), constants in [IOHIDAcceleration.hpp](https://github.com/apple-oss-distributions/IOHIDFamily/blob/IOHIDFamily-1787.140.2/IOHIDEventSystemPlugIns/IOHIDAcceleration.hpp):

   ```
   SCROLL_CLEAR_THRESHOLD_MS  500   gap > 500 ms or direction change: history is cleared
   SCROLL_EVENT_THRESHOLD_MS  150   a gap longer than this counts as 150 ms (slow)
   SCROLL_EVENT_AVARAGE_LENGHT  9   velocity = average of the last 9 reports
   eventCount > 2                   velocity *= sqrt(16 * count) / 4   (boost from report 3)
   ```

   - A gap over 150 ms stops the averaging, and one over 500 ms clears the history. Between two `scroll` calls about 300 ms pass (200 ms end wait + 100 ms pointer settle), so back-to-back calls mostly start fresh; this is why the same command usually moves about the same distance (not guaranteed: one `scroll down 2` moved 99 pt instead of ~195).
   - The first report sees a 150 ms gap: minimum velocity, almost no movement. The boost starts at the third report. This matches the 2 reports iOS "drops", so `scroll` sends 2 lead-in reports.
   - Faster, evenly spaced reports give a higher velocity: 50 ms moved less than 16 ms.
   - iOS 18.2 ships the same code with the same constants (500, 150, 67): [decompiled IOHIDPointerScrollFilter from the iPhone restore image](https://github.com/EthanArbuckle/iPhone17-1_18.2_22C152_Restore/blob/main/System/Library/HIDPlugins/IOHIDPointerScrollFilter.plugin/IOHIDPointerScrollFilter.m).
   - The Bluetooth link groups reports, so iOS timestamps can differ from our 16 ms spacing. This can explain the scale change after a daemon restart.
4. UIKit then turns the events into scrolling (not open source).

Horizontal scroll would be AC Pan (Consumer page 0x0238). Report 7 has no AC Pan field; adding one needs a descriptor change, so the user must forget the Mac on the iPhone and pair again. [HID Usage Tables](https://usb.org/document-library/hid-usage-tables-15)

## Other implementations

- [yoyicue/glassbox picokvm_ipad_wheel.md](https://github.com/yoyicue/glassbox/blob/main/docs/reference/picokvm_ipad_wheel.md): USB gadget (PicoKVM) on iPad, wheel-only report id 2 next to an absolute report id 1: 9/9 scrolled. One tick is barely visible; use batches of 5-10+, 40 ms apart. Wheel was ignored until the gadget re-enumerated once (unexplained "activation"). Adding Wheel to the absolute report made iPad reject the device. iPhone 17: 30 ticks moved a fixed ±599 px after warm-up.
- [egarl004/mirrordeck BluetoothHID.swift](https://github.com/egarl004/mirrordeck/blob/main/Sources/MirrorDeck/BluetoothHID.swift): the same design as iphonectl (Mac as Bluetooth Classic HID, iPhone with AssistiveTouch). Absolute report 2 without wheel, relative report 3 with Wheel (0x38, -127...127); `scroll()` sends the wheel on the relative report. It forwards live Mac scroll events (`scrollingDeltaY / 8` notches, [InputController.swift](https://github.com/egarl004/mirrordeck/blob/main/Sources/MirrorDeck/InputController.swift)), so the continuous stream hides the dropped first reports.
- [T-vK/ESP32-BLE-Mouse](https://github.com/T-vK/ESP32-BLE-Mouse/blob/master/BleMouse.cpp): BLE mouse, one report with buttons, X, Y, Wheel (0x38) and AC Pan (0x0238), each signed 8-bit.
