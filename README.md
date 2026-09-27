# iphonectl

Control real iPhones from a Mac. **Screenshots over USB, taps over Bluetooth.** No jailbreak, no Xcode, no app on the phone.

```bash
iphonectl list
iphonectl screenshot -o home.png          # 414x896 on an iPhone XR: screen points
iphonectl tap 207 448                     # same coordinates as the screenshot
iphonectl swipe 207 700 207 300
iphonectl tap --text "Settings"          # OCR finds the text, taps its center
iphonectl type "hello" --enter
iphonectl key home                        # Home Screen, no AssistiveTouch menu
iphonectl tap 207 448 --screenshot s.png --screentext  # act, then see the result
iphonectl screentext --language it-IT     # OCR: x,y wxh text per line
IPHONECTL_PASSCODE="$(< .passcode)" iphonectl unlock
```

```
                USB (QuickTime screen capture) ──▶ screenshots
Mac ── iphonectl daemon ─┤
                Bluetooth LE HID mouse + keyboard ──▶ AssistiveTouch pointer on the iPhone
```

## Features

- **Screenshots** over USB, PNG or JPEG, about 0.1s each once the capture is open
- **Tap, swipe, key, type** through a Bluetooth mouse and keyboard served by the Mac
- **Screen points by default**: screenshots, OCR boxes and taps share one small coordinate space, sized for LLM vision
- **Screen text** with on-device OCR (Vision), boxes in screenshot coordinates
- **Unlock** a locked iPhone with its passcode, no touch; lock state in `list`
- **Lock** over the Bluetooth keyboard, verified over USB
- **Several iPhones at once**, each controlled on its own
- **HTTP API** described by OpenAPI, usable from any language
- **Remote daemon** over TCP with a bearer token and HTTPS

## Install

Needs macOS 14 or later and Swift 5.9 or later. Xcode is not needed: the Command Line Tools (`xcode-select --install`) build it too. Tested with Command Line Tools (Swift 6.1) and Xcode 26 (Swift 6.3).

```bash
git clone https://github.com/remorses/iphone-usb-control
cd iphone-usb-control
swift build -c release
cp .build/release/iphonectl /usr/local/bin/
```

The first run asks for **Camera** access (screen capture) and, on the first tap, **Bluetooth** access for your terminal.

## iOS versions

**Tested on iOS 18.7 (iPhone XR) and iOS 15.8.4 (iPhone 6s).** The iPhone sees the Mac as a normal Bluetooth LE mouse and keyboard (HID over GATT). The only difference between versions is how the **pointer** moves.

| iOS | Pointer | Tap cost | Accuracy |
|---|---|---|---|
| 18.7 | **absolute**: report 1 says "go to X, Y" | one report | exact |
| 15.8 | **relative**: iOS ignores absolute X/Y, so report 7 moves in steps | ~0.3-1 s from the last spot; ~1-3 s every 6th move (corner push to reset drift) | about 5 px, at most half a step (~9 px) |

- The mode is **found by itself** when a phone is first matched: absolute first, then relative. `list` shows it: `(bluetooth 1BAD6347, connected, relative pointer)`.
- Apple does not document absolute pointers for AssistiveTouch, and no changelog mentions them. The iOS 15 behavior was found by testing: the phone subscribes to report 1 but the pointer stays still.
- In relative mode, `swipe --duration` is ignored. Steps are always sent every 16 ms, because iOS pointer acceleration depends on step size and speed.
- A phone paired with an older iphonectl may have the old report map cached (no report 7). The log then says to forget `iphonectl` on the iPhone and pair again.
- The pairing page name can differ by iOS version. Apple's guide calls it **AssistiveTouch > Devices > Bluetooth Devices**: https://support.apple.com/en-us/111775

### Which iPhones get fast taps

**Pick an iPhone XS or XR or newer for automation.** Absolute pointers work from **iOS 17**, and iOS 17 needs an A12 chip or newer.

| iPhone | Last iOS | Pointer | Tap |
|---|---|---|---|
| 6s, 6s Plus, 7, 7 Plus, SE (1st gen) | 15 | relative | ~2-3 s, ~5 px off |
| 8, 8 Plus, X | 16 | relative | ~2-3 s, ~5 px off |
| **XS, XS Max, XR, SE (2nd gen, 2020)** and newer | 17+ | **absolute** | ~0.3 s, exact |

- iOS 15 (6s) and iOS 18 (XR) are tested. The iOS 17 cutoff comes from a vendor of ESP32 Bluetooth HID firmware, not from Apple: https://ieasyclick.net/blog/en/ios-ble-hid-no-signature/. iOS 16 and 17 are not tested here.
- An iPhone that can run iOS 17 but still runs 16 uses the relative pointer. Update it.

### Relative tap limits

A relative tap does not know where the pointer is, so each tap starts again from the corner:

```
tap 461,1240 on a 6s:
  corner push      25 reports x 16 ms      ~0.45 s
  34 steps right   10 units each           ~0.55 s
  91 steps down    x first, then y         ~1.45 s
  click + waits                            ~0.35 s
                                           ~2.8 s total
```

- **Slow:** ~2-3 s per tap, more for targets far from the top-left corner.
- **Less exact:** a tap can miss by up to half a step (~9 px on a 6s). Small buttons need care.
- **Fixed swipe speed:** `swipe --duration` is ignored.
- **First match is slower:** ~3-4 s per Bluetooth device, because the pointer is moved to 4 spots and checked in screenshots.
- Big or fast steps would be quicker, but iOS accelerates them, so the measured step size would be wrong. That is why every step is 10 units at 16 ms.

## Setup (once per iPhone)

Screenshots work after you plug in, trust, and unlock the iPhone, while its display is awake. **Taps and swipes need two steps on the iPhone first.**

### 1. Plug in and trust

Connect the iPhone over USB, unlock it, and tap **Trust**. Then check:

```bash
iphonectl list
```

### 2. Turn on AssistiveTouch

**Settings > Accessibility > Touch > AssistiveTouch: ON.**

iOS accepts a mouse only through AssistiveTouch. With it off, the iPhone shows no pointer and ignores every click (tested). Keep it on: tap and swipe need it all the time, not only during setup.

**Hide the floating button (recommended).** On the same page, turn **Always Show Menu** OFF (Italian: "Mostra sempre menu"). AssistiveTouch stays on and the pointer still works, but the round menu button no longer covers the screen. With it on, it sits over buttons (it covered the Messages send arrow in tests) and fades in and out, which is noise in screenshots. You do not need its Home action; the keyboard has one:

```bash
iphonectl key home   # Home Screen (HID consumer Menu key; tested on iOS 15.8)
```

### 3. Pair the Mac as a pointer device

Run any input command. The daemon waits for pairing and prints the steps:

```bash
iphonectl tap 100 100
```

On the iPhone, open **AssistiveTouch > Pointer Devices > Devices**, tap the Mac's name (for example "MacBook Pro") or `iphonectl`, then **Pair**.

- **Settings > Bluetooth does not list the Mac** when the iPhone uses the same Apple ID. Only the Pointer Devices page lists it.
- The Mac appears in that list a few seconds after the command starts, because the daemon opens the Bluetooth link from the Mac (see [How the Mac becomes a mouse](#how-the-mac-becomes-a-mouse)).
- **Pairing** means iOS accepts the Mac as its mouse and keyboard. Before pairing, the iPhone can connect and even subscribe, but iOS drops all input (tested).

After pairing, the command continues by itself. Later runs reconnect in about 2s.

### 4. More iPhones

**Multiple iPhones work after steps 1 to 3 on each one.** Pass the device with `-d`:

```bash
iphonectl list
# 7EF219AD-...  Morse's iPhone  iPhone XR (iPhone11,8) iOS 18.7  (bluetooth C27E57E9, connected, absolute pointer)
# 42B874EC-...  Test iPhone     iPhone 6s (iPhone8,1) iOS 15.8.4  (bluetooth 1BAD6347, connected, relative pointer)

iphonectl screenshot -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F -o a.png
iphonectl tap 206 332 -d E8AC634A-D99B-4F36-91B9-BA6E5D55A0FC
```

The Mac is one Bluetooth mouse for all iPhones, but each report goes to one iPhone only. Input to one phone never reaches another.

**Give every iPhone a different name.** The daemon uses the name to match a USB phone to its lock state and to its Bluetooth device. Two phones called `Morse’s iPhone (2)` get no lock state in `list`, and the first match must move the pointer of both to tell them apart.

```
Settings > General > About > Name   →   "Morse XR", "Test 6s"
```

Apple guide: https://support.apple.com/guide/iphone/change-the-name-of-your-iphone-iphf256af64f/ios. The new name reaches USB and Bluetooth at once. If the Mac still shows the old name, unplug and plug in the cable again, then run `iphonectl forget -d <id>` so the phone is matched again.

## How the Mac becomes a mouse

The daemon uses CoreBluetooth to publish a standard **HID over GATT** service, the same Bluetooth service a real mouse and keyboard use. The iPhone subscribes to it and treats the Mac as its mouse and keyboard.

```
Mac (daemon)                                   iPhone
┌────────────────────────────┐                ┌─────────────────────────────┐
│ HID over GATT service      │ ◀─subscribes── │ AssistiveTouch              │
│  report 1: mouse (absolute)│ ──reports────▶ │  pointer + clicks = touches │
│  report 7: mouse (relative)│                │                             │
│  report 2: keyboard        │                │                             │
│  report 6: media keys      │                │                             │
└────────────────────────────┘                └─────────────────────────────┘
```

The service has **two mice**. Report 1 is absolute: X and Y go from 0 to 32767, so a screenshot pixel converts directly to a pointer position (iOS 18). Report 7 is relative, for iOS versions that ignore absolute positions (iOS 15):

**Clicks in absolute mode go in both reports.** With two mouse collections in the map, iOS 18 moves the pointer from report 1 but ignores the button bits of report 1 (tested on iOS 18.7). So a press and release are sent in report 1 and, with zero movement, in report 7.

```
match:  push pointer into the top-left corner (iOS clamps it at the edges)
        15 steps down ──▶ screenshot A ──▶ 15 steps right ──▶ screenshot B
        pointer blob in B ──▶ screen fraction per step (saved in state.json)
tap:    corner push ──▶ whole steps along x, then y ──▶ click
```

Every step is 10 units, sent every 16 ms, as during measurement: iOS accelerates bigger or faster steps more. Screen size and Tracking Speed do not matter, because the step size is measured in screen fractions.

### Why the Mac first connects to the iPhone

An iPhone on the same Apple ID **does not connect to the Mac by itself**. It connects only when Apple's own device-to-device features need a link. Without a link, it never reads the Mac's services, so the Mac is missing from Pointer Devices > Devices (tested).

The daemon fixes this by opening the link from the Mac:

```
1. Mac ──connect──▶ iPhone             the daemon opens the Bluetooth link
2. iPhone reads the Mac's services     finds the mouse service
3. Mac shows up in Pointer Devices > Devices
4. you tap it → Pair                   iOS now accepts input from the Mac
5. daemon matches the phone            USB id ↔ Bluetooth id (next section)
```

- **Discovery.** While a USB iPhone has no match, the daemon scans for Apple devices that send the "nearby device" signal (manufacturer data `4C 00 10`) and that the Mac knows by name. It connects to each one. Other people's phones had no name in tests, so they are skipped. Your iPad passes the filter and gets a short link too.
- **Cleanup.** Discovery runs only while a request waits for pairing. When the last waiting request ends, scanning stops and the extra links close. Matched iPhones keep their link and reconnect when it drops.
- **Pairing** (step 4) is the only step where iOS agrees to take input. Before it, the iPhone can connect and subscribe, but it ignores every click and key.
- **Other Apple IDs:** the Mac has no name for these phones, so discovery skips them. This case is not tested.

## How a phone is matched

USB ids and Bluetooth ids are unrelated. On the first input to a USB iPhone, the daemon **matches** it: it moves each connected pointer (no click) to two spots and looks for the change in that iPhone's screenshots.

```
pointer check: change at A 39%, at B 54%, whole screen 0.2%
matched: Bluetooth device BA5C7328 is Morse's iPhone
```

The match is saved in `~/.iphonectl/state.json`. It needs AssistiveTouch on, because it looks for the pointer. `iphonectl forget -d <id>` removes a match.

## CLI

| Command | Does |
|---|---|
| `list` | iPhones on USB, `[locked]`, and their Bluetooth match |
| `screenshot [-o file.png\|.jpg] [--settle]` | save the screen; `--settle` waits until it stops changing |
| `screentext [--language it-IT] [--json]` | OCR of the screen: `x,y wxh text` per line. English is always included |
| `tap <x> <y>` | tap at screenshot coordinates |
| `tap --text <text> [--index n]` | tap the center of an OCR text line (exact line wins, else contains) |
| `swipe <x1> <y1> <x2> <y2> [--duration ms]` | drag with the button held |
| `key <combo>` | `home`, `enter`, `esc`, `backspace`, arrows, `volumeup`, `mute` |
| `type <text> [--enter]` | US-ASCII text, then optionally Enter (sends in Messages) |
| `unlock [passcode]` | wake and unlock (or `IPHONECTL_PASSCODE`); no screenshot while locked |
| `lock` | lock over Bluetooth with Control-Command-Q |
| `forget` | remove the Bluetooth match |
| `daemon start\|stop\|restart\|status\|run` | manage the background daemon |

The daemon starts by itself on the first command. After a rebuild, the CLI restarts it.

**Environment variables** set a default for every command; a flag overrides them:

| Variable | Same as | Example |
|---|---|---|
| `IPHONECTL_LANGUAGE` | `--language` (OCR in `screentext`, `--screentext`, `tap --text`) | `it-IT` |
| `IPHONECTL_SCALE` | `--scale` (image and coordinate size) | `1` for native pixels |
| `IPHONECTL_PASSCODE` | `unlock <passcode>` | read from `.passcode` |

## Coordinates: screen points

**Screenshots, `screentext` boxes, `tap` and `swipe` use one space: iOS screen points.** A point is 2 native pixels on @2x iPhones and 3 on @3x ones, so an iPhone XR (828x1792) gives a 414x896 image. Plus models are the exception: they render at 1080 px for 414 points, and iphonectl knows the native size of each iPhone screen. Read a spot in the image, send the same numbers.

| iPhone | Native pixels | Default (points) | Claude tokens | GPT tokens (32 px patches x1.2) |
|---|---|---|---|---|
| 6s (@2x) | 750x1334 | 375x667 | 336 | 303 |
| XR (@2x) | 828x1792 | 414x896 | 480 | 437 |
| 14 Pro (@3x) | 1179x2556 | 393x852 | 465 | 422 |

**Why points:** UI text stays readable (17 pt body text is 17 px). A screenshot costs about a quarter of the native tokens on @2x iPhones and an eighth on @3x. It also stays under every model's resize limit, so the model sees exactly the pixels the CLI maps back. Claude models before 4.7 shrink anything over 1568 px or 1568 tokens (28 px patches), and an XR screen at native size would be shrunk to an unknown scale ([Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost), [OpenAI vision](https://platform.openai.com/docs/guides/images-vision#calculating-costs)).

**Other sizes** with `--scale` (a fraction of native pixels) or `IPHONECTL_SCALE`. Use the same value for every command, because it also changes how `tap` reads coordinates:

```bash
iphonectl screenshot -o full.png --scale 1    # native pixels, 828x1792
IPHONECTL_SCALE=1 iphonectl tap 414 896       # native pixel coordinates
```

`screentext` always runs OCR on native pixels (small text reads better), then scales the boxes.

## Devices in `list`

**Only USB-connected iPhones appear.** `list` gets devices from macOS's QuickTime screen-capture device list, not from a Bluetooth scan. Keep the USB cable attached and trust the Mac once. A Bluetooth-only phone is not listed. Camera permission is required on the Mac; neither a Bluetooth connection nor AssistiveTouch is required just to list a phone.

```text
42B874EC-D690-4D1E-80E4-1A8434DACC3D  iPhone di Carla (2)  iPhone 6s (iPhone8,1) iOS 15.8.4  [locked]  (bluetooth 1BAD6347, connected, relative pointer)
   USB capture ID                        name                 model and iOS (USB)   lock      saved BLE match, live link, pointer mode
```

**No phone fails fast.** When screen capture lists nothing, the daemon asks USB lockdown why, in about 0.1 s, instead of waiting 25 s:

```text
error: No iPhone in macOS screen capture. USB check:
- iPhone di Carla (2): on USB but not trusted (AMDeviceStartSession 0xe8000025). Unlock it and tap Trust on the iPhone; ...
```

It waits (up to 25 s) only for a trusted phone, which capture can list a few seconds after a daemon start.

**Locked phones stay listed.** The daemon reads `PasswordProtected` from iOS lockdown over the trusted USB connection using macOS's private `MobileDevice.framework`. It does not need a screen frame. `[locked]` means the passcode is required; its absence means lockdown reports unlocked. If the lock state cannot be read, the field is absent. Capture and lockdown IDs differ, so the state is matched by device name; two phones with the same name have no reliable lock state.

**One-phone example:** this Mac listed one iPhone with `[locked]` at the start of the test. After `unlock`, the same device remained listed without `[locked]`. The Bluetooth suffix means the previously paired mouse/keyboard is connected. It is not a second device.

## Agent feedback loop

**Each tool call is the slow part**, not the phone. So an action returns the new screen in the same call: `--screenshot` saves it, `--screentext` prints its text. One call per step instead of three.

```
      ┌──────────────────────────────────────────────────────────────┐
      ▼                                                              │
 1. see the screen          screentext (text + boxes, no image)       │
                            or screenshot -o s.png (~500 tokens)      │
 2. act, and see the result tap / swipe / key / type                  │
                            + --screenshot s.png --screentext         │
 3. read the printed text, and s.png if the text is not enough        │
 4. decide the next action toward the user's task  ───────────────────┘
```

```bash
export IPHONECTL_LANGUAGE=it-IT     # phone language for OCR, same as --language
iphonectl list
iphonectl screentext
iphonectl tap --text "Tommaso De Rossi" --screenshot s.png --screentext
iphonectl tap 200 610 --screenshot s.png --screentext          # x,y read from s.png
iphonectl type "ciao" --enter --screentext
```

**Set the OCR language once** for a non-English phone: `IPHONECTL_LANGUAGE=it-IT` (a BCP 47 tag) applies to `screentext`, `--screentext` and `tap --text`. `--language` overrides it. English is always included. Without it, accents and local words are misread.

- **Text first, image when needed.** `--screentext` output is cheap and often enough to decide (a new title, a sent message). Read `s.png` for icons, layout, or text OCR misses.
- **Both flags wait for a still screen:** the CLI waits until two frames 150 ms apart match (up to 2 s, so slide animations are done). With both, the screenshot and the text come from the same still screen. A launching app can look still while blank; if the output is empty, take one more.
- **Tap text, not pixels:** `tap --text "..."` saves a screenshot read and coordinate guessing. On the Home Screen, app **labels do not open apps** (tested on iOS 15): tap the icon, about 40 points above the label.
- **Failed capture after an action:** the error says **action completed**. Do not repeat the action blindly; take a screenshot first.
- **No frames:** `screenshot` and `screentext` reject a locked iPhone quickly. If `list` reports unlocked but capture still gets no frame, see [USB screen capture stops](#usb-screen-capture-stops-ios-bug-restart-the-iphone).

**Leave the iPhone unlocked.** Do not run `iphonectl lock` at the end of a task. Locking stops USB screen capture and makes the next action less reliable. Use `unlock` only when `list` shows `[locked]`; use `lock` only when the task explicitly needs a locked phone.

**Agents:** read the local, ignored `.passcode` file when unlocking this phone. Pass it through `IPHONECTL_PASSCODE="$(< .passcode)" iphonectl unlock` so it is not in the command arguments. Never print or commit the file. Create it locally if this checkout does not have one.

## Unlock

**`unlock` does not use OCR.** USB screen capture does not yield frames while this iPhone is locked, so it cannot inspect the passcode screen. The Bluetooth mouse and keyboard run a timed sequence:

```
click ──▶ screen on ──▶ two fast swipes up ──▶ check USB lock state for 4 s
                                              ├─ unlocked by Face ID ──▶ done
                                              └─ still locked ──▶ type passcode once ──▶ check lock state
```

- **Keys cannot wake the screen.** iOS treats our keys as coming from a mouse and drops them on the lock screen. A click usually wakes it.
- **Face ID runs first.** The first swipe can show notifications; the second opens the passcode flow. `unlock` polls the USB lock state for up to 4 s, returns if Face ID already unlocked the phone, then types the passcode once if it is still locked. It cannot confirm which screen is shown before typing.
- **Lock state** comes over USB from lockdown (`PasswordProtected`) through the private `MobileDevice.framework`. `list` shows `[locked]`; `unlock` checks it before and after.
- **A wrong passcode is never retried.** Failed tries count toward the iPhone lockout. The passcode is not stored.
- **Locked screenshots fail immediately.** USB capture does not return frames from this phone while locked; `screenshot` and `screentext` check the lock state first.
- **OCR is for the agent loop after unlock**, not for the locked-screen sequence. For example, `screentext` can find a button label and its pixel box; the agent chooses the next tap based on that result.

## HTTP API

The daemon serves HTTP on a unix socket. The spec is at `GET /v1/openapi.yaml`.

```bash
S=~/.iphonectl/daemon.sock
curl --unix-socket $S http://localhost/v1/devices
curl --unix-socket $S http://localhost/v1/devices/default/screenshot -o s.png
curl --unix-socket $S -H 'content-type: application/json' \
  -d '{"x":207,"y":448}' http://localhost/v1/devices/default/tap   # screen points, like the screenshot
```

- `{device}` is the USB id, the name, or `default` when one iPhone is connected.
- Input routes return JSON. Send `Accept: text/event-stream` to get progress as server-sent events.
- Errors are `application/problem+json` with a stable `code`. In event-stream mode the status is 200 and the problem arrives as the final `error` event.

### Remote daemon

```bash
# on the Mac with the iPhones
IPHONECTL_TOKEN=secret iphonectl daemon start --port 7420 --host 0.0.0.0 \
  --tls-cert cert.pem --tls-key key.pem

# anywhere else
iphonectl --url https://mac.local:7420 --token secret --ca cert.pem list
```

A host other than localhost needs TLS, so the token never crosses the network in clear text.

## Limits

- **AssistiveTouch must stay on** for tap, swipe, and matching. Its floating button can be hidden (see setup step 2).
- **Keyboard without AssistiveTouch** is not tested.
- **`cmd+space` and `cmd+h`** did nothing in tests.
- **Screen off:** no frames. `unlock` tries to wake a locked iPhone; USB capture may still return no frame. An unlocked one with the screen off needs a tap from you.
- **Lock state** is matched by device name. Two iPhones with the same name show no lock state. Rename one (see [More iPhones](#4-more-iphones)).
- **Many fast daemon restarts** can hide the iPhones for about a minute. macOS throttles the screen capture helper.

### USB screen capture stops (iOS bug): restart the iPhone

**iOS can stop sending its screen over USB** while macOS still lists it. `list` works and the lock state is correct, but `screenshot` gets no frame and no error:

```text
error: No frame from Morse’s iPhone (2) after 8s (session running, 0 frames since open). ...
```

- **Fix: restart the iPhone.** Replugging the cable or restarting the daemon does not help (tested on iOS 18.7).
- This is an iOS bug, not iphonectl. A plain AVFoundation program gets no frames either, and QuickTime Player **crashed** when it opened the same iPhone screen.
- Known Apple reports with the same symptom: [FB21608780](https://github.com/feedback-assistant/reports/issues/778) (after "Stop Mirroring" in Control Center, fixed only by a reboot) and [FB22281473](https://github.com/feedback-assistant/reports/issues/781) (screen capture trust revoked).
- After the restart, **unlock the iPhone by hand once**. Before the first unlock, iOS ignores the Bluetooth keyboard, so `iphonectl unlock` fails.

**Check with QuickTime Player** which sources the Mac sees. Stop the daemon first (the iPhone serves its screen to one app at a time):

1. `iphonectl daemon stop`
2. QuickTime Player > **File > New Movie Recording**
3. Click the **⌄** arrow next to the record button. Under **Camera**:

| Entry | What it is |
|---|---|
| `Morse’s iPhone (2)` | the iPhone **screen** over USB (what iphonectl uses) |
| `Morse’s iPhone (2) Camera` | the iPhone camera (Continuity Camera), not the screen |

- **Screen entry shows the live screen:** capture works; the problem is on the Mac side.
- **Screen entry is black, missing, or QuickTime crashes:** iOS stopped serving the screen. Restart the iPhone.
- Two iPhones with the same name both show up as `... Camera`. Only the one on USB has a screen entry.

<details>
<summary>Architecture</summary>

```
CLI / curl / any language
   │ HTTP over ~/.iphonectl/daemon.sock (mode 0600, no token)
   │ HTTP or HTTPS over TCP with --port (Bearer token)
   ▼
Hummingbird ──▶ generated API (openapi.yaml) ──▶ own thread ──▶ Controller
                                                                  ├─ FrameStream per iPhone (AVFoundation), OCR (Vision)
                                                                  ├─ Lockdown lock state (MobileDevice.framework)
                                                                  └─ HIDPeripheral (CoreBluetooth HID over GATT)
                                                                       └─ LinkKeeper (Mac-initiated LE links)
```

- `Sources/iphonectl/openapi.yaml` is the source of truth. swift-openapi-generator builds the server and the client from it.
- AVFoundation and CoreBluetooth need the main run loop, so HTTP runs in a detached task.
- Each request runs on its own thread. Capture, OCR, and lock state have per-iPhone locks; input sequences (`unlock`, taps) are serialized per iPhone. Different iPhones run in parallel.
- Files: `~/.iphonectl/daemon.sock`, `daemon.log`, `daemon.lock`, `state.json`.

</details>
