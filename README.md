# iphonectl

Control real iPhones from a Mac. **Screenshots over USB, taps over Bluetooth.** No jailbreak, no Xcode, no app on the phone.

```bash
iphonectl list
iphonectl screenshot -o home.png          # 0.1s after the first call
iphonectl tap 414 896                     # screenshot pixels
iphonectl swipe 414 1400 414 600
iphonectl type "hello"
iphonectl key enter
iphonectl tap 414 896 --screenshot after.png  # act, then save fresh screen
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
- **Screen text** with on-device OCR (Vision), boxes in screenshot pixels
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

**Hide the floating button.** On the same page, turn **Always Show Menu** OFF (Italian: "Mostra sempre menu"). AssistiveTouch stays on and the pointer still works, but the round menu button no longer covers the screen. You do not need its Home action: swipe up from the bottom edge, like on any iPhone without a Home button.

```bash
# go home: drag from the bottom edge up (1180x2556 screen)
iphonectl swipe 590 2550 590 1500 --duration 250
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
# 7EF219AD-...  Morse's iPhone  (bluetooth C27E57E9, connected)
# E8AC634A-...  Test iPhone     (bluetooth BA5C7328, connected)

iphonectl screenshot -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F -o a.png
iphonectl tap 413 665 -d E8AC634A-D99B-4F36-91B9-BA6E5D55A0FC
```

The Mac is one Bluetooth mouse for all iPhones, but each report goes to one iPhone only. Input to one phone never reaches another.

## How the Mac becomes a mouse

The daemon uses CoreBluetooth to publish a standard **HID over GATT** service, the same Bluetooth service a real mouse and keyboard use. The iPhone subscribes to it and treats the Mac as its mouse and keyboard.

```
Mac (daemon)                                   iPhone
┌────────────────────────────┐                ┌─────────────────────────────┐
│ HID over GATT service      │ ◀─subscribes── │ AssistiveTouch              │
│  report 1: mouse (absolute)│ ──reports────▶ │  pointer + clicks = touches │
│  report 2: keyboard        │                │                             │
│  report 6: media keys      │                │                             │
└────────────────────────────┘                └─────────────────────────────┘
```

The mouse is **absolute**: X and Y go from 0 to 32767. A screenshot pixel converts directly to a pointer position, so no calibration is needed.

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
| `screenshot [-o file.png\|.jpg]` | save the screen |
| `screentext [--language it-IT] [--json]` | OCR of the screen: `x,y wxh text` per line. English is always included |
| `tap <x> <y>` | tap at screenshot pixels |
| `swipe <x1> <y1> <x2> <y2> [--duration ms]` | drag with the button held |
| `key <combo>` | `enter`, `esc`, `backspace`, arrows, `volumeup`, `mute` |
| `type <text>` | US-ASCII text |
| `unlock [passcode]` | wake and unlock (or `IPHONECTL_PASSCODE`); no screenshot while locked |
| `lock` | lock over Bluetooth with Control-Command-Q |
| `forget` | remove the Bluetooth match |
| `daemon start\|stop\|restart\|status\|run` | manage the background daemon |

The daemon starts by itself on the first command. After a rebuild, the CLI restarts it.

## Devices in `list`

**Only USB-connected iPhones appear.** `list` gets devices from macOS's QuickTime screen-capture device list, not from a Bluetooth scan. Keep the USB cable attached and trust the Mac once. A Bluetooth-only phone is not listed. Camera permission is required on the Mac; neither a Bluetooth connection nor AssistiveTouch is required just to list a phone.

```text
7EF219AD-69B4-423E-B8C4-4F4A6140822F  Morse’s iPhone (2)  [locked]  (bluetooth C27E57E9, connected)
   USB capture ID                        name                 USB lock state   saved BLE match + live link
```

**Locked phones stay listed.** The daemon reads `PasswordProtected` from iOS lockdown over the trusted USB connection using macOS's private `MobileDevice.framework`. It does not need a screen frame. `[locked]` means the passcode is required; its absence means lockdown reports unlocked. If the lock state cannot be read, the field is absent. Capture and lockdown IDs differ, so the state is matched by device name; two phones with the same name have no reliable lock state.

**One-phone example:** this Mac listed one iPhone with `[locked]` at the start of the test. After `unlock`, the same device remained listed without `[locked]`. The Bluetooth suffix means the previously paired mouse/keyboard is connected. It is not a second device.

## Agent feedback loop

**Leave the iPhone unlocked.** Do not run `iphonectl lock` at the end of a task. Locking stops USB screen capture and makes the next action less reliable. Use `unlock` only when `list` shows `[locked]`; use `lock` only when the task explicitly needs a locked phone.

**Agents:** read the local, ignored `.passcode` file when unlocking this phone. Pass it through `IPHONECTL_PASSCODE="$(< .passcode)" iphonectl unlock` so it is not in the command arguments. Never print or commit the file. Create it locally if this checkout does not have one.

```bash
iphonectl list
iphonectl tap 414 896 --screenshot after.png
# Read after.png to see what changed before choosing the next tap.
iphonectl screentext --language it-IT
# Read the recognized text and pixel boxes before choosing a text-based action.
```

- **Visual actions:** use `--screenshot [path]` with `tap`, `swipe`, `key`, `type`, or `unlock`. The CLI runs the action, then requests a fresh screenshot (default `screenshot.png`). Read that image before the next action. If capture fails, the error says **action completed**; do not repeat it blindly.
- **Text-only actions or data reading:** use `screentext --language it-IT` instead of interpreting image pixels. It returns `x,y widthxheight text`; `--json` also returns confidence and screen size. English is always included. Use the text and coordinates to decide whether to tap, type, or stop. `screentext` is a separate read, not an automatic step inside actions.
- **No frames:** `screenshot` and `screentext` reject a locked iPhone quickly. If `list` reports unlocked but capture still gets no frame, the display or USB capture stream may be off. Do not treat a successful action response as proof of what appeared on screen.

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
  -d '{"x":414,"y":896}' http://localhost/v1/devices/default/tap
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
- **Lock state** is matched by device name. Two iPhones with the same name show no lock state.
- **Many fast daemon restarts** can hide the iPhones for about a minute. macOS throttles the screen capture helper.

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
                                                                  └─ BLEMouse (CoreBluetooth HID peripheral)
                                                                       └─ LinkKeeper (Mac-initiated LE links)
```

- `Sources/iphonectl/openapi.yaml` is the source of truth. swift-openapi-generator builds the server and the client from it.
- AVFoundation and CoreBluetooth need the main run loop, so HTTP runs in a detached task.
- Each request runs on its own thread. Capture, OCR, and lock state have per-iPhone locks; input sequences (`unlock`, taps) are serialized per iPhone. Different iPhones run in parallel.
- Files: `~/.iphonectl/daemon.sock`, `daemon.log`, `daemon.lock`, `state.json`.

</details>
