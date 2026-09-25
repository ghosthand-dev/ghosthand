# iphonectl

Control real iPhones from a Mac. **Screenshots over USB, taps over Bluetooth.** No jailbreak, no Xcode, no app on the phone.

```bash
iphonectl list
iphonectl screenshot -o home.png          # 0.1s after the first call
iphonectl tap 414 896                     # screenshot pixels
iphonectl swipe 414 1400 414 600
iphonectl type "hello"
iphonectl key enter
```

```
                USB (QuickTime screen capture) ──▶ screenshots
Mac ── iphonectl daemon ─┤
                Bluetooth LE HID mouse + keyboard ──▶ AssistiveTouch pointer on the iPhone
```

## Features

- **Screenshots** over USB, PNG or JPEG, about 0.1s each once the capture is open
- **Tap, swipe, key, type** through a Bluetooth mouse and keyboard served by the Mac
- **Several iPhones at once**, each controlled on its own
- **HTTP API** described by OpenAPI, usable from any language
- **Remote daemon** over TCP with a bearer token and HTTPS

## Install

Needs macOS 14 or later and Swift 5.9 or later. Tested with Xcode 26 (Swift 6.3); Command Line Tools alone is not tested.

```bash
git clone https://github.com/remorses/iphone-usb-control
cd iphone-usb-control
swift build -c release
cp .build/release/iphonectl /usr/local/bin/
```

The first run asks for **Camera** access (screen capture) and, on the first tap, **Bluetooth** access for your terminal.

## Setup (once per iPhone)

Screenshots work right after you plug in the iPhone. **Taps and swipes need two steps on the iPhone first.**

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
# E8AC634A-...  Morse's iPhone  (bluetooth BA5C7328, connected)

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
| `list` | iPhones on USB and their Bluetooth match |
| `screenshot [-o file.png\|.jpg]` | save the screen |
| `tap <x> <y>` | tap at screenshot pixels |
| `swipe <x1> <y1> <x2> <y2> [--duration ms]` | drag with the button held |
| `key <combo>` | `enter`, `esc`, `backspace`, arrows, `volumeup`, `mute` |
| `type <text>` | US-ASCII text |
| `forget` | remove the Bluetooth match |
| `daemon start\|stop\|restart\|status\|run` | manage the background daemon |

The daemon starts by itself on the first command. After a rebuild, the CLI restarts it.

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
- **Screen off or locked:** no frames. Unlock the iPhone.
- **Many fast daemon restarts** can hide the iPhones for about a minute. macOS throttles the screen capture helper.

<details>
<summary>Architecture</summary>

```
CLI / curl / any language
   │ HTTP over ~/.iphonectl/daemon.sock (mode 0600, no token)
   │ HTTP or HTTPS over TCP with --port (Bearer token)
   ▼
Hummingbird ──▶ generated API (openapi.yaml) ──▶ own thread ──▶ Controller
                                                                  ├─ FrameStream per iPhone (AVFoundation)
                                                                  └─ BLEMouse (CoreBluetooth HID peripheral)
                                                                       └─ LinkKeeper (Mac-initiated LE links)
```

- `Sources/iphonectl/openapi.yaml` is the source of truth. swift-openapi-generator builds the server and the client from it.
- AVFoundation and CoreBluetooth need the main run loop, so HTTP runs in a detached task.
- Files: `~/.iphonectl/daemon.sock`, `daemon.log`, `daemon.lock`, `state.json`.

</details>
