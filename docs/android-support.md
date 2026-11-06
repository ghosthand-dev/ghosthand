---
title: Android support (research)
description: How ghosthand could drive Play Store apps on Android phones next to iPhones. Control paths compared on detection, setup and speed, what stays the same in the daemon, and a recommended design. Research only, nothing is built or tested on a device yet.
---

**Recommendation: adb plus the unmodified scrcpy server, with touch sent as a virtual
hardware touchscreen (UHID).** scrcpy's `UHID_CREATE` control message takes any HID report
descriptor, name and VID/PID from the client, so the daemon creates a multitouch touchscreen
and sends finger reports with `UHID_INPUT`. Touches then reach apps as a real finger on a real
input device, like our Bluetooth HID on iPhone. The same server gives the H.264 stream. No
helper of our own, no app, no accessibility, no MediaProjection.

```
ghosthand CLI / MCP ──> daemon ──> Controller (leases, OCR, settle, waitText)  unchanged
                                      │
                ┌─────────────────────┼───────────────────────────┐
                v                     v                           v
         BluetoothDriver         XCTestDriver               AndroidDriver (new)
         iPhone, HID             iPhone, WDA                      │ adb (USB, Wi-Fi optional)
                                                                  v
                              phone: scrcpy-server.jar (pinned) via app_process, user `shell`
                                ├─> control: UHID_CREATE touchscreen + keyboard, UHID_INPUT
                                │            keycodes (home, back), clipboard, START_APP
                                └─> video:   MediaCodec H.264 ──> VideoToolbox ──> OCR, settle,
                                                                    preview, record
```

**Simplest possible start:** plain adb commands, like mobile-mcp: `adb exec-out screencap -p`
and `adb shell input tap|swipe|text|keyevent`. No jar, works in an afternoon. But screenshots
take 200-500 ms, text is ASCII only, and every tap is an injected event (deviceId -1). Good
for a spike, not to ship.

The XCTest setup cannot be reused: Xcode, WebDriverAgent, usbmux and Developer Mode are
Apple only. The pattern carries over: a pinned helper started by the Mac and supervised,
input as 0...1 fractions, frames from the driver.

## Why UHID touch

Android tags every event injected by software. `InputDispatcher::injectInputEvent` rewrites
`deviceId` to `VIRTUAL_KEYBOARD_ID` (-1) for all injected events, so any app can tell. A UHID
device goes through the kernel `hid-multitouch` driver and InputReader like the built-in
panel: real device id, finger tool type, pressure and size from our reports, historical
samples from our report timing.

| Control path                     | App sees                                               | Needs adb | Setup                  |
| -------------------------------- | ------------------------------------------------------ | --------- | ---------------------- |
| `adb shell input tap`            | deviceId -1, size 1.0, DOWN and UP in the same ms      | yes       | none                   |
| `injectInputEvent` (scrcpy, Appium, Maestro, mobilecli) | deviceId -1, virtual device; scrcpy sends size 0 | yes | push jar or APK |
| Accessibility `dispatchGesture`  | deviceId -1, flag 0x800, `TOOL_TYPE_UNKNOWN`; service is listed; Play Integrity `*_CONTROLLING` | no | app + accessibility |
| **UHID touchscreen** (8.1+)      | real InputDevice, finger, our name and VID/PID         | yes       | push jar               |
| AOA v2 HID touchscreen (USB)     | real USB InputDevice, VID/PID `HID_ANY_ID`             | no        | libusb on the Mac      |
| Bluetooth HID touchscreen        | real Bluetooth InputDevice (inferred, untested)        | no        | pairing                |

- **Permission:** adbd gives the shell the `uhid` group and SELinux allows `uhid_device`
  since Android 8.1. `/dev/uinput` works the same since Android 10. `sendevent` to
  `/dev/input/event*` is blocked.
- **Display:** a `BUS_VIRTUAL` device maps to the built-in screen with no IDC file. A
  `BUS_USB` or `BUS_BLUETOOTH` one counts as external and also maps there when no external
  display exists; external touches also wake the screen.
- **Identity:** scrcpy's UHID devices are named "scrcpy" with VID/PID 0:0. Ours needs a
  plausible name and VID/PID.
- **Proof it works:** [criipto/idura-verify-android `uhid_touch.c`](https://github.com/criipto/idura-verify-android/blob/master/example/src/androidTest/cpp/uhid_touch.c)
  uses it because the BankID PIN pad rejects injected input.
  [spence-com-au/pogo-utils](https://github.com/spence-com-au/pogo-utils/blob/master/src/tools/inventory/touchscreen.mts)
  drives Pokémon Go with it (Pixel 4 XL Android 13, Pixel 8 Pro Android 17, per its comments).
- **Gotchas:** the kernel drops an unchanged `ABS_MT_POSITION`, even across taps, so add 1
  unit of jitter. The device lives as long as its fd: if adb drops, it goes away mid-touch.
  Pace gesture reports on the phone (120-250 Hz), not per adb round trip, or flings lose
  velocity. Flutter scrollables ignored injected swipes in some versions
  ([flutter#94534](https://github.com/flutter/flutter/issues/94534)); a real finger device
  avoids that.
- **scrcpy's own client has no UHID touch** (only keyboard, mouse, gamepad;
  [#4382](https://github.com/Genymobile/scrcpy/issues/4382) open). But its server builds
  the device from whatever descriptor the client sends (`UhidManager.open(id, vendorId,
  productId, name, reportDesc)`, bus fixed to `BUS_VIRTUAL`), so our client can create a
  touchscreen with the unmodified jar.
  [bandori-ournotes-autoplay](https://github.com/YKLovePython/bandori-ournotes-autoplay)
  does exactly this. Gesture pacing then happens on the Mac, about 1 ms per report over a
  held-open socket (that project's numbers).

## What phone farms and bots use

Most open phone farms use **adb with injected input**: scrcpy, minitouch or `input tap`.
UHID touch shows up in **game bots**, which need multi-touch and input that games accept.

| Repo                                                                          | Input                              |
| ----------------------------------------------------------------------------- | ---------------------------------- |
| [barry-ran/QtScrcpy](https://github.com/barry-ran/QtScrcpy) (32k, group control) | scrcpy `injectInputEvent`      |
| [imharryzhu/AndroidControl](https://github.com/imharryzhu/AndroidControl) (2.2k) | minicap + minitouch            |
| [EasilyTest/stf](https://github.com/EasilyTest/stf) (STF group control fork)  | minitouch / STFService             |
| [rdh073/phone-remote](https://github.com/rdh073/phone-remote)                 | scrcpy-server over Tailscale adb   |
| [itaki33-bjk/telefon-ciftligi](https://github.com/itaki33-bjk/telefon-ciftligi) | `adb shell input`, scrcpy mirror |
| [spence-com-au/pogo-utils](https://github.com/spence-com-au/pogo-utils)       | UHID touchscreen (Pokémon Go)      |
| [YKLovePython/bandori-ournotes-autoplay](https://github.com/YKLovePython/bandori-ournotes-autoplay) | UHID digitizer via scrcpy-server, no root |
| [WuDi-ZhanShen/AndroidUHidPureJava](https://github.com/WuDi-ZhanShen/AndroidUHidPureJava) | UHID multitouch in pure Java, `app_process` |

Commercial cloud phones (GeeLark, DuoPlus) run rooted ARM servers with Play Integrity fixes
instead; real-phone farms (Total Control, Sigma RT) use adb plus a mirror and scripts.

## Driving Play Store apps

| Concern                   | What we found                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------- |
| USB debugging checks      | Banks, UPI, government apps, some e-wallets refuse to run. No report for TikTok, Instagram, YouTube, Reddit, Gmail. Android 17 QPR1 on Pixel hides the setting from apps (Android Authority, mechanism not found in AOSP). Apps can still read the sticky `ACTION_USB_STATE` broadcast (`adb: true`). |
| Play Integrity            | Not affected by USB debugging. Needs a real certified phone: locked bootloader, no root. Emulators, Redroid, Waydroid and most cloud phones fail. |
| Screen capture detection  | Android 14 screenshot callback, Android 15 recording callback and sensitive content hiding all key off MediaProjection or the screenshot keys. Shell capture does not trigger them. |
| `FLAG_SECURE`             | Black frames in every shell capture since Android 12 (shell cannot make secure displays). Most banking apps, password managers, some login screens. Instagram View Once media. |
| Accessibility apps        | Play bans accessibility apps that act autonomously (since 2026-01-28). Sideloaded ones need "Allow restricted settings"; Android 17 Advanced Protection revokes them; `accessibilityDataSensitive` views are hidden from them. |
| Account bans              | Public evidence says device ID reuse, IP type, action rate and fixed intervals matter most. Touch-level biometrics are used by bank anti-fraud SDKs (BioCatch, Appdome), not shown for social apps. |
| Developer verification    | 2026-2027 sideloading rules do not apply to adb installs ("ADB workflow stays the same"). A jar run with `app_process` is not an install. |

## Approaches compared

| | **A. adb + scrcpy server, UHID touch** (recommended) | B. plain adb commands | C. UiAutomator2 / Appium | D. Accessibility app | E. Bluetooth or AOA HID, no adb |
|---|---|---|---|---|---|
| Input looks like hardware | yes | no (deviceId -1) | no | no, worst | yes |
| Screen | H.264 stream, `screencap` for native stills | `screencap`, 200-500 ms | PNG per request | 333 ms min, or MediaProjection | none (capture card or camera) |
| Text | UHID keyboard (ASCII), IME for Unicode | ASCII only | `ACTION_SET_TEXT` | IME | layout-bound HID keyboard |
| On the phone | pinned scrcpy jar in /data/local/tmp | nothing | 2 APKs, instrumentation | app on Play is banned | nothing |
| Phone setup | USB debugging | USB debugging | USB debugging | restricted settings, accessibility, capture consent | Bluetooth pairing |
| Work for us | scrcpy protocol client, H.264 decode, HID descriptor | least | medium, WDA-like routes | high + distribution | Bluetooth stack reuse, no screen |
| Detectable by | adb setting | adb, injected events | adb, injected, UiAutomation | listed service, Play Integrity | Bluetooth bond only |

- **B is the simplest spike**: an afternoon, no protocol work. Then move to A.
- **C** shares code shape with the XCTest driver (W3C actions), but injected input, only one
  `UiAutomation` client per phone, no stream.
- **E is the cleanest for detection**: no adb at all. But no USB path gives frames without
  adb; DisplayPort alt mode with a capture card works on Samsung, Motorola and Pixel 8+, takes
  the USB-C port, and is black for `FLAG_SECURE` content. Keep it as a later option on top of
  the same Bluetooth stack, untested on Android.

## Screen paths

| Path                                  | Latency                 | For OCR                         |
| ------------------------------------- | ----------------------- | ------------------------------- |
| H.264 stream (scrcpy style)           | 35-70 ms (scrcpy)       | lossy, raise the bitrate        |
| Display capture in an own `app_process` helper (SurfaceControl, UiAutomation), only if stills must be faster | tens of ms (unverified) | lossless; hidden APIs change per release |
| `screencap -p`                        | 200-500 ms (unverified) | lossless, a new process per shot |
| `screencap` raw RGBA                  | faster, ~8 MB per 1080p frame | lossless, encode on the Mac |

`settledFrame` needs frames 150 ms apart; the stream sends one at least every 100 ms even on a
still screen. Use stills for OCR and `--native`, the stream for preview and `record`.

## Text input

- **ASCII and passwords:** a UHID keyboard. No clipboard, no IME switch. Attached hardware
  keyboards hide the on-screen keyboard by default.
- **Unicode:** our own IME, installed with `adb install`, that commits text received over an
  authenticated adb socket. Switch to it only while typing, then restore the user's IME. Never an
  exported broadcast receiver (ADBKeyBoard accepts text from any app).
- **Never the clipboard for `type --stdin`.** scrcpy and yadb fall back to it.

## What the user does

**Every phone:**

1. Settings > About phone > tap Build number 7 times. Developer options > USB debugging on.
2. Plug in, tap **Allow** with "Always allow from this computer".
3. Developer options: "Disable adb authorization timeout" on (else it expires after 7 days),
   Default USB configuration "No data transfer".
4. Screen lock None or swipe, or give ghosthand the PIN. Advanced Protection off.

**Per brand:**

| Brand          | Extra steps                                                                            |
| -------------- | -------------------------------------------------------------------------------------- |
| Pixel          | None.                                                                                  |
| Samsung        | Turn off Auto Blocker fully (also "Maximum restrictions"); it returns after a reset.   |
| Xiaomi, POCO   | Mi account with a SIM, "Install via USB", "USB debugging (Security settings)", reboot. Never run the Security app scan (it turns off Developer options). UHID input may work without the security toggle (one report). |
| OPPO, OnePlus  | Turn off "Disable permission monitoring"; may reset after reboot.                      |

**Phones to suggest:** used Pixel 6a-8a or Samsung A15-A35. Avoid Android Go (2 GB RAM),
Huawei (no Play), emulators and cloud phones (Play Integrity).

## Daemon impact

**Stays the same:** leases and lease prefixes, account and lease-check (the website only sees
a device hash), OCR, settle and waitText, the `after` steps, coordinate fractions, tunnel,
MCP and CLI front ends, phone tasks.

**Must change:**

- **Device identity.** A phone today is a macOS screen capture device plus a lockdown UDID;
  leases and capture slots are keyed by the capture ID. Android has an adb serial. Phones need
  a platform-neutral ID and a frame source per platform.
- **Listing and setup steps.** From adb (`host:devices-l`): `unauthorized`, `device`,
  `offline`, plus the OEM toggle errors (`INJECT_EVENTS` denied means Xiaomi or Auto Blocker).
- **Help text, MCP docs, task prompt.** They say "iPhone" everywhere.
- **USB services:**

| Feature        | iPhone today                | Android                                                         |
| -------------- | --------------------------- | --------------------------------------------------------------- |
| files          | AFC, house_arrest           | adb sync (`/sdcard`), `run-as` for debuggable apps              |
| photos         | AFC /DCIM, ImageCaptureCore | push to /DCIM + media scan: **adds to Gallery**, iOS cannot     |
| apps           | installation_proxy          | `pm list packages`, `adb install`, `am start` (launch works)    |
| info, logs     | lockdown, syslog_relay      | `getprop`, `dumpsys battery`, `logcat`                          |
| key            | home, volume, shortcuts     | home, **back**, recents, volume, power                          |
| lock, unlock   | HID keyboard types passcode | power key; `input text <PIN>` + enter works on the keyguard; some OEMs show it black, so type blind |
| stay awake     | Auto-Lock Never             | `svc power stayon usb`                                          |

## adb on the Mac

1. **Prototype:** talk to the adb server on `localhost:5037` with the `adb` binary installed.
2. **Ship:** our own adb client in Swift over USB (IOKit, RSA key in ~/.ghosthand), like
   [dadb](https://github.com/mobile-dev-inc/dadb) and
   [Tango](https://github.com/yume-chan/ya-webadb). Only one process can claim the adb USB
   interface, so use a running adb server when there is one. Whether Google's prebuilt adb may
   be bundled is not checked.

Wi-Fi: before Android 17 the wireless debugging port changes on every reboot. Android 17 with
platform-tools 37 reconnects by itself on trusted networks.

## Risks

- **OEM toggles reset silently** (Auto Blocker, Xiaomi security toggle, OTA turning off
  Developer options). Detect the error and name the toggle to fix.
- **Reboots with a PIN**: adb works while locked once authorized, but a new USB connection
  under Advanced Protection is charge-only, and its 72 h inactivity reboot needs the PIN.
- **Hidden APIs** for capture change per Android release; Android 17 had scrcpy regressions
  ([#6991](https://github.com/Genymobile/scrcpy/issues/6991),
  [#7048](https://github.com/Genymobile/scrcpy/issues/7048)). Pin and test each release.
- **Many phones per Mac:** powered USB 2.0 hubs, about 1.5 A per port. No public numbers for
  10-20 decoded streams on Apple Silicon; measure. Stills only (no stream) when no one watches.
- **USB debugging is a broad grant** (shell on the phone). Say so in setup.
- **adb detection** stays on Android 16 and older: banking and government apps will refuse.

## Plan, if we build it

1. Spike with plain adb commands (B) behind the Controller, to find the identity and listing
   changes early.
2. Pinned scrcpy server with the `adb` binary: UHID multitouch touchscreen via `UHID_CREATE`,
   check `dumpsys input`, taps, long press, fling in TikTok, a Flutter app and a Compose app.
3. H.264 decode with VideoToolbox; measure OCR on the stream vs `screencap`, and
   tap-to-settled-frame.
4. Platform-neutral phone ID in state.db and the Controller; Android listing and setup steps.
5. adb services (files, photos, apps, info, logs, power); IME for Unicode; native Swift adb.
6. Later: Bluetooth HID touchscreen for a no-adb mode, if a screen source is solved.

<details>
<summary>Sources (read November 2026)</summary>

- AOSP: [InputDispatcher.cpp](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/main/services/inputflinger/dispatcher/InputDispatcher.cpp)
  (injected deviceId), [TouchInputMapper.cpp](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/main/services/inputflinger/reader/mapper/TouchInputMapper.cpp)
  (viewport), [shell.te](https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/private/shell.te)
  (uhid), [adb main.cpp](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/daemon/main.cpp)
  (shell groups), [Shell manifest](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/packages/Shell/AndroidManifest.xml)
  (INJECT_EVENTS, READ_FRAME_BUFFER), [AOA 2.0](https://source.android.com/docs/core/interaction/accessories/aoa2).
- [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy) v5.0.1 (Apache 2.0):
  `doc/develop.md`, `server/.../video/ScreenCapture.java`, `control/UhidManager.java`,
  `app/src/usb/aoa_hid.c`, `FAQ.md`.
- [yume-chan/ya-webadb](https://github.com/yume-chan/ya-webadb) (Tango, MIT) and
  [mobile-dev-inc/dadb](https://github.com/mobile-dev-inc/dadb): adb without the adb binary.
- [mobile-next/mobilecli](https://github.com/mobile-next/mobilecli),
  [mobile-next/mobile-mcp](https://github.com/mobile-next/mobile-mcp),
  [callstack/agent-device](https://github.com/callstack/agent-device) (helper benchmarks:
  tap 52 ms, screenshot 69 ms p50 on an emulator; IME helper),
  [appium/appium-uiautomator2-server](https://github.com/appium/appium-uiautomator2-server),
  [openatx/uiautomator2](https://github.com/openatx/uiautomator2),
  [droidrun/mobilerun-portal](https://github.com/droidrun/mobilerun-portal) (AGPL-3.0,
  accessibility), [mobile-dev-inc/maestro](https://github.com/mobile-dev-inc/maestro).
- Policy: [Play accessibility policy](https://support.google.com/googleplay/android-developer/answer/10964491),
  [Play Integrity verdicts](https://developer.android.com/google/play/integrity/verdicts),
  [developer verification](https://developer.android.com/developer-verification/guides),
  [Advanced Protection USB](https://support.google.com/android/answer/16778864).
- [Samsung Auto Blocker](https://docs.samsungknox.com/admin/fundamentals/whitepaper/samsung-knox-mobile-security/system-security/samsung-auto-blocker),
  [Shizuku setup guide](https://shizuku.rikka.app/guide/setup/) (OEM toggles).

</details>
