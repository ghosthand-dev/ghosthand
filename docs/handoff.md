---
title: iphonectl handoff
description: Goal, current state, feedback loop and next steps for iPhone USB screen capture and BLE tap control
---

# iphonectl: continue from previous session

Previous session: ses_f26b3c358ffeY52MQpY6mggmaD (Discord thread 1553073786402898031).

## Goal

A Swift CLI `iphonectl` (this repo, `~/Documents/GitHub/iphone-usb-control`) that:

1. **Gets frames (screenshots) of USB-connected iPhones.** This is the core feature. It must work first.
2. Taps, swipes and types on the iPhone **without XCTest**. It uses a Bluetooth HID mouse and keyboard that the Mac emulates, plus iOS AssistiveTouch.
3. Later: many phones at once.

## Hard requirements from Tommy

- **Swift only.** No Python, no Go and no Node in the runtime. No dependencies if possible.
- **No XCTest, no WebDriverAgent, no agent-device.** Do not use the agent-device skill or CLI.
- The CLI follows goke-style help and options (see `printRootHelp` / `printHelp` in `main.swift`). Load the `goke` skill for style.
- The CLI stays one-shot where nothing must stay open (`screenshot`, `list`). Use the background daemon only where state must stay alive (BLE peripheral). The daemon must start implicitly on first `tap`/`key`/`swipe`/`type`.
- Pairing is detected automatically. On the first run, print step-by-step pairing instructions to stderr.
- Slow operations print progress logs to stderr, so the user can see what happens.
- Decide if pointer calibration is really needed. If it is, run it implicitly after pairing.
- **Validate everything yourself with screenshots.** Tommy will NOT look at the iPhone to report what happens. Every action must be verified by grabbing a frame and reading the PNG with the Read tool.
- Final demo task: swipe down to open Search, open Messages, and send `ciao` to the contact **"elisa sorellina"**.

## Reference repos (already researched)

| Repo | Why it matters |
|---|---|
| [danielpaulus/quicktime_video_hack](https://github.com/danielpaulus/quicktime_video_hack) | Reverse-engineered QuickTime USB screen protocol (vendor control `0x40, 0x52, 0, 2` to enable the hidden USB config, then SYNC/ASYN/FEED packets with H264). **Broken on macOS 26**: issue #162 says claiming the USB interface needs Apple's private `com.apple.coremedia.valeria.allow` entitlement. Use it only as protocol reference. |
| [danielpaulus/go-ios](https://github.com/danielpaulus/go-ios) | `ios screenshot` uses DTX instruments `com.apple.instruments.server.services.screenshot` (`takeScreenshot`). Needs Developer Mode + DDI (iOS < 17) or tunnel (17+). Fallback pull-based screenshot path. `ios/hid` has CoreDevice HID touch injection, but only for iOS 27+. |
| [doronz88/pymobiledevice3](https://github.com/doronz88/pymobiledevice3) | Python, not allowed at runtime. Useful as a protocol reference for DVT screenshot and lockdown. |
| [jqssun/darwin-bt-remote](https://github.com/jqssun/darwin-bt-remote) | **Key reference for the BLE HID.** Mac as a BLE HID mouse+keyboard (HOGP) through CoreBluetooth. Read `BTRemote/LowEnergy/HIDPeripheral.swift`, `HIDProfile.swift`, `HIDReports.swift`. AGPL: copy structure, write our own code. Read the README "iOS (HOGP)" constraints. |
| [VKCOM/devicehub](https://github.com/VKCOM/devicehub) | Production iPhone farm that taps with an ESP32 BLE mouse. Homing to the corner, then fixed-size relative steps (±1/±4/±8, 15 ms apart), with pixels per step measured by hand. See `lib/units/ios-device/plugins/touch/`. |
| [T-vK/ESP32-BLE-Mouse](https://github.com/T-vK/ESP32-BLE-Mouse) | Hardware fallback if Mac-as-BLE-HID cannot be made to work. |

Fetch sources with `opensrc path owner/repo`.

## Current state of the code

```
Package.swift                      SwiftPM, macOS 14, embeds Info.plist (Camera + Bluetooth usage strings)
Sources/iphonectl/Info.plist       needed so TCC accepts camera/bluetooth for a bare CLI binary
Sources/iphonectl/capture.swift    CoreMediaIO flag + AVCaptureSession frame grabbing
Sources/iphonectl/mouse.swift      BLEMouse: CBPeripheralManager HOGP peripheral, mouse report 1, keyboard report 2, LED 3
Sources/iphonectl/controller.swift homing, move, click, drag, keyboard typing, request handler
Sources/iphonectl/daemon.swift     unix socket daemon (~/.iphonectl/daemon.sock), auto-spawn with setsid, log streaming
Sources/iphonectl/main.swift       CLI parsing + goke-style help
tmp/probe.swift, tmp/grab.swift    first standalone experiments
```

Build: `swift build` and run `.build/debug/iphonectl --help`. Daemon log: `~/.iphonectl/daemon.log`. State: `~/.iphonectl/state.json`.

### What worked

- **Screenshots worked once.** `.build/debug/iphonectl screenshot -o tmp/x.png` gave a correct 828x1792 PNG of the Home Screen (iPhone XR, iOS 18). The mechanism: set `kCMIOHardwarePropertyAllowScreenCaptureDevices = 1` on the CMIO system object, and the iPhone appears as `AVCaptureDevice` (deviceType `.external`, mediaType `.muxed`, name "Morse's iPhone (2)", modelID "iOS Device"). Camera TCC is granted to the process chain.
- The Mac advertised "iphonectl mouse". The iPhone paired, and it reconnects in about 1s on each daemon start. The iPhone subscribes to the mouse report, the keyboard report and the battery level.

### What did NOT work yet

- **Mouse clicks, swipes and keyboard (`cmd+space`) had no visible effect** in the screenshots. Possible causes, not yet proven:
  1. The iPhone cached the first GATT/report map (mouse-only) from the first pairing. The keyboard was added later. I added a Service Changed trigger (`refreshGATT`), but the iPhone did not re-read the report map. A full "Forget This Device" and re-pair is probably needed.
  2. AssistiveTouch may be off (no floating button in the screenshots, but the capture may hide it).
  3. The AssistiveTouch pointer does **not** show in the USB screen capture (tested once, about 1s after moving). This matters for calibration.
- In the last step, the iPhone disappeared from USB (it showed as disconnected). The cause is unknown; possibly the BLE or the capture session. Tommy reconnected it.

## Step 1: make screenshots reliable (DO THIS FIRST)

### Check that the iPhone is connected

Run these in order. Do not continue until all of them pass.

```bash
# 1. USB level: the phone must be on the bus
ioreg -p IOUSB -l -w0 | grep -i '"USB Product Name" = "iPhone"'

# 2. CoreDevice view (the State column may say "unavailable" even when capture works; that is OK)
xcrun devicectl list devices

# 3. Capture level: the iPhone must appear as a muxed AVCaptureDevice
.build/debug/iphonectl list
```

If step 1 fails: ask Tommy to replug the cable and unlock the phone. If step 3 fails but step 1 passes: the CMIO flag, TCC camera permission, or the `iOSScreenCaptureAssistant` process (`pgrep -fl ScreenCapture`) can be the cause.

### Feedback loop for screenshots

```bash
swift build 2>&1 | grep -E 'error|Build complete'
.build/debug/iphonectl screenshot -o tmp/shot.png   # must print "tmp/shot.png  828x1792"
```

Then **Read `tmp/shot.png`** with the Read tool and look at it. A correct result is the real current iPhone screen: it is not black, not stale, and the clock matches the time.

Make it robust:
- Run it 5 times in a row. Each run must succeed in under about 3s.
- Check that it does not break the USB connection. After the runs, `ioreg` must still show the iPhone.
- Check that it works while the daemon also has a capture session open. The daemon `probe` command opens a long-lived `FrameStream`. Two sessions on the same device may conflict. This may be the cause of the disconnect. Consider having the CLI ask the daemon for frames when the daemon runs, so only one session exists.
- Error messages must tell the user how to fix the problem (locked phone, no Trust, no camera permission).

## Step 2: make input work, verified by screenshots

Feedback loop: **action, then screenshot, then Read the PNG, then compare.**

1. `iphonectl status` must show the mouse and the keyboard as connected.
2. Test the keyboard first. It does not need AssistiveTouch or calibration:
   `iphonectl key cmd+space`, then take a screenshot. The Search UI must be open. `iphonectl key cmd+h` must return to Home.
3. If nothing happens: stop the daemon (`iphonectl stop`), set `{"paired":false}` in `~/.iphonectl/state.json`, and ask Tommy to **Forget "iphonectl mouse"** in iPhone Settings > Bluetooth and re-pair. Only Tommy can do this physical step. Ask once, clearly, with exact steps.
4. Mouse: AssistiveTouch must be ON (ask Tommy once). Test `tap` on a big target, for example the Messaggi folder at about (700, 830) in the 828x1792 frame. Take a screenshot and check that the folder opened.
5. Calibration: iOS mouse input is relative only, with acceleration. With a constant step size (4) and interval (15 ms), pixels per report is constant. The pointer is probably not visible in the capture, so measure with a hover or tap effect, or tap known targets and adjust. Decide whether calibration can run automatically after pairing. Store it in `state.json`.
6. Swipe: `iphonectl swipe 414 700 414 1300` (drag down on the Home Screen) should open Search. Verify with a screenshot.

## Step 3: demo

Open Search (swipe down, or `cmd+space`), then `type Messages` (the phone UI is Italian: the app may be "Messaggi"), then `key enter`. Find "elisa sorellina", open the chat, `type ciao`, then `key enter`. Verify each step with a screenshot. Show the final screenshot.

## Rules

- Use the **opus** agent.
- Load the `goke` and `errore`-free Swift style; keep comments short. No Python.
- Report to Tommy in concise Simplified Technical English. Show screenshots in chat as progress proof.
- Never commit unless Tommy asks.
