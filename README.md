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
                Bluetooth Classic HID mouse + keyboard ──▶ AssistiveTouch pointer on the iPhone
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

Needs macOS 14 or later (the Bluetooth Classic private API is tested on macOS 26.3 only) and Swift 5.9 or later. Xcode is not needed: the Command Line Tools (`xcode-select --install`) build it too. Tested with Command Line Tools (Swift 6.1) and Xcode 26 (Swift 6.3).

```bash
git clone https://github.com/remorses/iphone-usb-control
cd iphone-usb-control
swift build -c release
cp .build/release/iphonectl /usr/local/bin/
```

The first run asks for **Camera** access (screen capture) and, on the first tap, **Bluetooth** access for your terminal.

## iOS versions

**Tested on iOS 18.7 (iPhone XR) over Bluetooth Classic, and on iOS 15.8.4 (iPhone 6s) with the earlier BLE version.** The iPhone sees the Mac as a normal Bluetooth Classic mouse and keyboard (HID profile over L2CAP). The only difference between versions is how the **pointer** moves.

| iOS | Pointer | Tap | Accuracy |
|---|---|---|---|
| 18.7 | **absolute**: report 1 says "go to X, Y" | ~0.3 s | exact |
| 15.8 | **relative** over BLE (iOS ignored absolute X/Y); **not tested yet over Classic** | ~0.45 s | 0.2 pt mean, 0.4 pt max (40 targets) |

- The mode is **found by itself** on the first tap: iOS 17 and later use absolute; older versions are checked by moving the pointer. `list` shows it: `(bluetooth connected, relative pointer)`.
- Apple does not document absolute pointers for AssistiveTouch, and no changelog mentions them. The iOS 15 behavior was found by testing over BLE: the phone read report 1 but the pointer stayed still.
- In relative mode the daemon knows **exactly** how far each report moves the pointer, from Apple's own acceleration table. See [Relative pointer](#relative-pointer-ios-15).

### Which iPhones get which pointer

**Absolute first, on every iOS version.** iOS 17 and later use it with no check. Older iOS tries absolute on the first tap and falls back to relative only if the pointer does not move.

| iPhone | Last iOS | Pointer | Tap |
|---|---|---|---|
| 6s, 6s Plus, 7, 7 Plus, SE (1st gen) | 15 | relative over BLE (tested on 6s); **absolute over Classic not tested** | ~0.45 s relative, < 0.5 pt off |
| 8, 8 Plus, X | 16 | absolute tried first, not tested | |
| **XS, XS Max, XR, SE (2nd gen, 2020)** and newer | 17+ | **absolute** (XR tested) | ~0.3 s, exact |

- The "absolute from iOS 17" claim comes from a vendor of ESP32 **BLE** HID firmware, not from Apple: https://ieasyclick.net/blog/en/ios-ble-hid-no-signature/. Bluetooth Classic HID may behave differently, so older iOS is checked, not assumed.

### Relative pointer (iOS 15)

**iOS turns each relative report into a fixed distance.** It looks up the report's size in IOHIDFamily's built-in acceleration table. Time does not count, and fractions of a point add up. So the daemon computes the reports for any move:

```
tap 300,500 with the pointer at 40,120 (move +260,+380 pt) on a 6s:
  (+169,+248) (+170,+247) ── speed 300, past the flat end of the table ──▶ 214.9 pt each
  (+16,+24)               ── speed 28 ─────────────────────────────────▶ 30.0 pt
  (0,-1)                  ── speed 1: 0.2 pt, lands within 0.2 pt
  100 ms pause, then click                                   ~0.45 s in total
```

- **Measured on an iPhone 6s** (iOS 15.8.4): 15 report sizes, diagonals, and bursts vs 100 ms gaps all matched the table to 0.5 pt. 40 taps in a row landed 0.2 pt from the target on average, with no drift. Details: [docs/relative-pointer.md](docs/relative-pointer.md).
- **The daemon remembers where the pointer is.** Only when it does not know (daemon start, Bluetooth reconnect, rotation, 60 s idle) does it push the pointer into the top-left corner first (+0.3 s).
- **Tracking Speed:** the pointer check measures a `gain` (1.000 at the default speed) and scales the table by it. Other speeds are not tested.
- **Swipes follow `--duration`**: reports are spread over it and sized so the drag ends exactly at the target.

## Setup (once per iPhone)

Screenshots work after you plug in, trust, and unlock the iPhone, while its display is awake. **Taps and swipes need two steps on the iPhone first.**

### 1. Plug in and trust

Connect the iPhone over USB, unlock it, and tap **Trust**. Then check:

```bash
iphonectl list
```

**Set Auto-Lock to Never** (recommended): **Settings > Display & Brightness > Auto-Lock > Never.** A locked iPhone gives no screenshots, and `unlock` needs the passcode. Keep Low Power Mode off: it forces Auto-Lock to 30 seconds.

### 2. AssistiveTouch (automatic)

iOS accepts a mouse only through AssistiveTouch. With it off, the iPhone shows no pointer and ignores every click (tested). **iphonectl turns it on over USB** before every tap, swipe, wake, and unlock, and before pairing. No touch on the phone is needed, and it works while locked:

```bash
iphonectl assistivetouch        # on / off
iphonectl assistivetouch off    # give the phone back to a person; the next tap turns it on
```

The check is a USB lockdown read of `com.apple.Accessibility` / `AssistiveTouchEnabledByiTunes`, about 35 ms (a write is about 40 ms).

**Hide the floating button (recommended).** On the same page, turn **Always Show Menu** OFF (Italian: "Mostra sempre menu"). AssistiveTouch stays on and the pointer still works, but the round menu button no longer covers the screen. With it on, it sits over buttons (it covered the Messages send arrow in tests) and fades in and out, which is noise in screenshots. You do not need its Home action; the keyboard has one:

```bash
iphonectl key home   # Home Screen (HID consumer Menu key; tested on iOS 15.8)
```

### 3. Pair the Mac as a mouse and keyboard

Run any input command. The daemon makes the Mac discoverable and prints the steps:

```bash
iphonectl tap 100 100
```

On the iPhone, open **Settings > Bluetooth**, tap the Mac's name (for example "MacBook Pro") under Other Devices, then **Pair**.

- The Mac is discoverable only while a command waits for pairing.
- After Pair, the iPhone opens the connection itself. The command continues by itself.
- Later runs reconnect the paired iPhone from the Mac in about 2 s.
- **After a report map change**, forget the Mac on the iPhone and pair again: the iPhone keeps the map it read at pairing.

### 4. More iPhones

**Multiple iPhones work after steps 1 to 3 on each one.** Pass the device with `-d`:

```bash
iphonectl list
# 7EF219AD-...  Morse's iPhone  iPhone XR (iPhone11,8) iOS 18.7  (bluetooth connected, absolute pointer)
# 42B874EC-...  Test iPhone     iPhone 6s (iPhone8,1) iOS 15.8.4  (bluetooth connected, relative pointer)

iphonectl screenshot -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F -o a.png
iphonectl tap 206 332 -d E8AC634A-D99B-4F36-91B9-BA6E5D55A0FC
```

The Mac is one Bluetooth mouse and keyboard for all iPhones, but each report goes to one iPhone only (its own L2CAP channel). Input to one phone never reaches another.

**Give every iPhone a different name.** The daemon uses the name to find a USB phone's lockdown data (lock state, Bluetooth address). Two phones called `Morse’s iPhone (2)` get no lock state in `list`, and the first match must move the pointer of both to tell them apart.

```
Settings > General > About > Name   →   "Morse XR", "Test 6s"
```

Apple guide: https://support.apple.com/guide/iphone/change-the-name-of-your-iphone-iphf256af64f/ios. The new name reaches USB and Bluetooth at once. If the Mac still shows the old name, unplug and plug in the cable again, then run `iphonectl list` again.

### How many iPhones per Mac

**Plan for at most 7 per Mac; 2 are tested.**

| Limit | Value | Why |
|---|---|---|
| Bluetooth Classic | 7 connected devices | Apple: "seven is the maximum number of Bluetooth devices that can be connected to your Mac at once; three to four is a practical limit" (https://support.apple.com/en-us/101205). Keyboard, trackpad and AirPods count too |
| USB | 127 devices per bus | **Not the problem.** Power is: use a powered hub, each iPhone charges while it is controlled |
| Screen capture CPU | not measured | one video stream per iPhone |

More than 7 iPhones needs a second Mac. Run a daemon on each one and reach it with `--url` (see [Remote daemon](#remote-daemon)).

### Several Macs: give each a unique name

**The iPhone lists the Mac by its computer name.** Two Macs called "MacBook Pro" look the same in Settings > Bluetooth, so an iPhone can pair with the wrong one. Rename each Mac before pairing:

```bash
# System Settings > General > About > Name, or:
sudo scutil --set ComputerName "Lab Mac 1"
sudo scutil --set LocalHostName "lab-mac-1"   # optional: network name, no spaces
```

- The Bluetooth radio uses the computer name. There is **one name per Mac**; iphonectl cannot show its own name next to it.
- The pairing steps print the name to tap: `tap "Lab Mac 1", then Pair`.
- An iPhone that paired before the rename can keep showing the old name. Forget the Mac on the iPhone (Settings > Bluetooth > (i) > Forget This Device) and pair again.
- Apple guide: https://support.apple.com/guide/mac-help/change-computers-local-hostname-mac-mchlp2322/mac

## How the Mac becomes a mouse

The daemon publishes a **Bluetooth Classic HID** service, the same profile a real Bluetooth keyboard uses. macOS has no public API to be a Classic HID device, so it uses CoreBluetooth's private `CBClassicManager` (`Sources/ClassicBluetooth`).

```
Mac (daemon)                                          iPhone
┌──────────────────────────────────┐                 ┌─────────────────────────────┐
│ SDP record: HID, report map      │ ◀──SDP query─── │ Settings > Bluetooth > Pair │
│ L2CAP 0x11 control  (handshakes) │ ◀──opens─────── │                             │
│ L2CAP 0x13 interrupt             │ ──reports─────▶ │ AssistiveTouch              │
│  report 1: mouse (absolute)      │                 │  pointer + clicks = touches │
│  report 7: mouse (relative)      │                 │                             │
│  report 2: keyboard, 6: media    │                 │                             │
└──────────────────────────────────┘                 └─────────────────────────────┘
```

Report 1 is absolute: X and Y go from 0 to 32767, so a screenshot pixel converts directly to a pointer position (tested on iOS 18.7 over Classic). Report 7 is relative, for iOS versions that ignore absolute positions (iOS 15 over BLE).

**Clicks in absolute mode go in both reports.** With two mouse collections in the map, iOS 18 ignored the button bits of report 1 over BLE. So a press and release are sent in report 1 and, with zero movement, in report 7.

```
check:  corner ──▶ move (80,120) pt ──▶ screenshot P1 ──▶ corner ──▶ move (160,120) pt ──▶ P2
        pointer found in P1 and P2 ──▶ gain = measured / computed (saved in state.json)
tap:    computed reports from the last known spot ──▶ 100 ms pause ──▶ click
```

<details>
<summary>Private API details</summary>

- `addServiceWithData:` takes the SDP record in bluetoothd's own element format, not the SDP wire format (reversed from bluetoothd).
- `sendMsg:35` with `kCBMsgArgDiscoverableState` makes the Mac discoverable.
- CoreBluetooth does not install L2CAP callbacks for other apps, so `CBClassicPeer.handleMsg:args:` is swizzled to install them.
- Each `CBL2CAPChannel` must stay referenced: releasing it closes its socket, and the iPhone shows "Connection unsuccessful".
- A macOS update can change any of these.

</details>

## How a phone is found

Each iPhone reports its **Bluetooth address** over USB lockdown. Its HID link to the Mac uses the same address, so the daemon joins the USB screen and the Bluetooth input by address. No pointer moves, and other connected devices (iPad, other phones) are never touched.

```
USB lockdown  BluetoothAddress ──── EC:CE:D7:A4:9B:C1 ────▶ Bluetooth HID link
```

`~/.iphonectl/state.json` keeps only the pointer mode per address. `iphonectl forget -d <id>` clears it, so the next tap checks it again.

## CLI

| Command | Does |
|---|---|
| `list` | iPhones on USB, `[locked]`, and their Bluetooth link state |
| `screenshot [-o file.png\|.jpg] [--settle]` | save the screen; `--settle` waits until it stops changing |
| `screentext [--language it-IT] [--json]` | OCR of the screen: `x,y wxh text` per line. English is always included |
| `tap <x> <y>` | tap at screenshot coordinates |
| `tap --text <text> [--index n]` | tap the center of an OCR text line (exact line wins, else contains) |
| `swipe <x1> <y1> <x2> <y2> [--duration ms]` | drag with the button held |
| `key <combo>` | `home`, `enter`, `esc`, `backspace`, arrows, `volumeup`, `mute` |
| `type <text> [--enter]` | US-ASCII text, then optionally Enter (sends in Messages) |
| `unlock [passcode]` | wake and unlock (or `IPHONECTL_PASSCODE`); no screenshot while locked |
| `assistivetouch [on\|off]` | show or set AssistiveTouch over USB; pointer input turns it on by itself |
| `lock` | lock over Bluetooth with Control-Command-Q |
| `forget` | check the pointer mode again on the next tap |
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

**Only USB-connected iPhones appear.** `list` gets devices from macOS's QuickTime screen-capture device list, not from a Bluetooth scan. Keep the USB cable attached and trust the Mac once. A Bluetooth-only phone is not listed. Camera permission is required on the Mac; neither a Bluetooth connection nor AssistiveTouch is required just to list a phone. The first `list` asks for Bluetooth access, because it starts Bluetooth.

```text
7EF219AD-69B4-423E-B8C4-4F4A6140822F  Morse’s iPhone (2)  iPhone XR (iPhone11,8) iOS 18.7.10  (bluetooth connected, absolute pointer)
   USB capture ID                        name                model and iOS (USB)                   Bluetooth link, pointer mode
```

**No phone fails fast.** When screen capture lists nothing, the daemon asks USB lockdown why, in about 0.1 s, instead of waiting 25 s:

```text
error: No iPhone in macOS screen capture. USB check:
- iPhone di Carla (2): on USB but not trusted (AMDeviceStartSession 0xe8000025). Unlock it and tap Trust on the iPhone; ...
```

**Bluetooth link state** comes from the iPhone's Bluetooth address (read over USB) and the Mac's open HID channels. `list` starts Bluetooth and reconnects paired phones:

| State | Meaning |
|---|---|
| `connected` | input works |
| `disconnected` | paired; the Mac reconnects in about 2 s. If it stays, Bluetooth is off on the iPhone or it is out of range. The Mac cannot tell these apart |
| `not paired` | pair from iPhone Settings > Bluetooth; the next input command waits for it |

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
curl --unix-socket $S http://localhost/v1/devices/default/assistive-touch   # {"enabled":true}
curl --unix-socket $S -X PUT -H 'content-type: application/json' \
  -d '{"enabled":false}' http://localhost/v1/devices/default/assistive-touch
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

## Security

**Whoever reaches the daemon can use the iPhone like a person holding it**: open apps, read messages, type. Everything runs on your Mac; no account, no cloud, nothing installed on the iPhone.

```
who can reach the phone                         how
local user who owns ~/.iphonectl ──────────────▶ unix socket, file mode 0600
remote client ─────────────────────────────────▶ TCP only with --port, Bearer token, TLS off localhost
```

The iPhone accepts input only from a Mac that has **all three**:

1. **USB cable** plugged in, and the phone trusts this Mac (Trust prompt + passcode).
2. **Bluetooth pairing** accepted on the phone in Settings > Bluetooth.
3. The **daemon running**.

**Cut access** by removing any one of them:

| Action | Effect |
|---|---|
| `iphonectl daemon stop` | no screenshots, no input, until the next command starts it |
| unplug the cable | no screenshots and no input: every command finds the phone over USB first |
| iPhone: Settings > Bluetooth > the Mac > (i) > Forget This Device | no input until you pair again |
| iPhone: Settings > General > Transfer or Reset > Reset > Reset Location & Privacy | removes the USB trust of every computer |

- **The passcode is never stored.** `unlock` gets it per call; pass it with `IPHONECTL_PASSCODE`, not as an argument.
- **Apple Pay still needs you.** It asks for a double press of the side button, which the Mac cannot press.

## Limits

- **AssistiveTouch must be on** for tap and swipe. iphonectl turns it on over USB; its floating button can be hidden (see setup step 2).
- **Keyboard without AssistiveTouch** is not tested.
- **`cmd+space` and `cmd+h`** did nothing in tests.
- **Screen off:** no frames. `unlock` tries to wake a locked iPhone; USB capture may still return no frame. An unlocked one with the screen off needs a tap from you.
- **Lock state** is matched by device name. Two iPhones with the same name show no lock state. Rename one (see [More iPhones](#4-more-iphones)).
- **Many fast daemon restarts** can hide the iPhones for about a minute. macOS throttles the screen capture helper.
- **About 7 iPhones per Mac**, set by Bluetooth, not by iphonectl. Only 2 tested. See [How many iPhones per Mac](#how-many-iphones-per-mac).
- **The cable must stay in.** Screenshots only come over USB; a phone on Bluetooth or Wi-Fi alone is not listed.
- **Typing is US-ASCII only**: no accents or emoji. There is no length limit.

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

## Alternatives

| | iphonectl | iPhone Mirroring | Appium (XCUITest) |
|---|---|---|---|
| App on the iPhone | none | none | WebDriverAgent (signed) |
| Xcode, Developer Mode | no | no | yes |
| Screen | USB capture | Wi-Fi mirror | XCTest |
| Input | Bluetooth Classic HID | Mac input | XCTest |
| iOS 15 | yes over BLE (relative pointer); not tested over Classic | no (iOS 18+) | yes |
| Unlock with passcode | yes | no | no |
| iPhones per Mac | ~7, 2 tested | 1 | many |
| Account, cloud | none, local daemon | same Apple ID on Mac and iPhone | none |

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
                                                                  └─ HIDDevice (Bluetooth Classic HID, private CBClassicManager)
```

- `Sources/iphonectl/openapi.yaml` is the source of truth. swift-openapi-generator builds the server and the client from it.
- AVFoundation and CoreBluetooth need the main run loop, so HTTP runs in a detached task.
- Each request runs on its own thread. Capture, OCR, and lock state have per-iPhone locks; input sequences (`unlock`, taps) are serialized per iPhone. Different iPhones run in parallel.
- Files: `~/.iphonectl/daemon.sock`, `daemon.log`, `daemon.lock`, `state.json`.

</details>
