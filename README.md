# iphonectl

Control real iPhones from a Mac. **Screenshots over USB, taps over Bluetooth.** No jailbreak, no Xcode, no app on the phone.

```bash
iphonectl list
iphonectl acquire --holder ses_123         # prints e.g. 42; exclusive use of the iPhone
iphonectl screenshot -l 42 -o home.png     # 414x896 on an iPhone XR: screen points
iphonectl tap -l 42 207 448                # same coordinates as the screenshot
iphonectl scroll -l 42 down 5              # mouse wheel, ~100 points per tick
iphonectl tap -l 42 --text "Settings"      # OCR finds the text, taps its center
iphonectl type -l 42 "hello" --enter
secret-provider | iphonectl type -l 42 --stdin  # secrets stay out of argv
iphonectl key -l 42 home                   # Home Screen, not Back
iphonectl tap -l 42 207 448 --screenshot s.png --screentext
iphonectl screentext -l 42 --language it-IT
iphonectl release -l 42                    # the next agent can acquire it
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
- **Leases**: one agent per iPhone at a time; others wait or get a clear "leased by" error
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
iphonectl assistivetouch -l 42        # on / off
iphonectl assistivetouch -l 42 off    # give the phone back to a person; next tap turns it on
```

The check is a USB lockdown read of `com.apple.Accessibility` / `AssistiveTouchEnabledByiTunes`, about 35 ms (a write is about 40 ms).

**Hide the floating button (recommended).** On the same page, turn **Always Show Menu** OFF (Italian: "Mostra sempre menu"). AssistiveTouch stays on and the pointer still works, but the round menu button no longer covers the screen. With it on, it sits over buttons (it covered the Messages send arrow in tests) and fades in and out, which is noise in screenshots. You do not need its Home action; the keyboard has one:

```bash
iphonectl key -l 42 home   # Home Screen (HID consumer Menu key; tested on iOS 15.8)
```

### 3. Pair the Mac as a mouse and keyboard

Run any input command. The daemon makes the Mac discoverable and prints the steps:

```bash
iphonectl tap -l 42 100 100
```

On the iPhone, open **Settings > Bluetooth**, tap the Mac's name (for example "MacBook Pro") under Other Devices, then **Pair**.

- The Mac is discoverable only while a command waits for pairing.
- After Pair, the iPhone opens the connection itself. The command continues by itself.
- Later runs reconnect the paired iPhone from the Mac in about 2 s.
- **After a report map change**, forget the Mac on the iPhone and pair again: the iPhone keeps the map it read at pairing.
- **Pairing fails, or the Mac is gone from the list:** forget on both sides, then pair again. See [Pairing no longer works](#pairing-no-longer-works-forget-on-both-sides).

### 4. More iPhones

**Multiple iPhones work after steps 1 to 3 on each one.** Pick one with `acquire -d`; each lease runs on its own iPhone:

```bash
iphonectl list
# 7EF219AD-...  Morse's iPhone  iPhone XR (iPhone11,8) iOS 18.7  (bluetooth connected, absolute pointer)
# 42B874EC-...  Test iPhone     iPhone 6s (iPhone8,1) iOS 15.8.4  (bluetooth connected, relative pointer)

iphonectl acquire -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F  # prints e.g. 42
iphonectl acquire -d "Test iPhone"                       # prints e.g. 43
iphonectl screenshot -l 42 -o a.png
iphonectl tap -l 43 206 332
iphonectl release -l 42
iphonectl release -l 43
```

The Mac is one Bluetooth mouse and keyboard for all iPhones, but each report goes to one iPhone only (its own L2CAP channel). Input to one phone never reaches another.

**Names do not matter; the id does.** Screen capture and USB lockdown give each iPhone unrelated IDs, and the name is the only field both show. So the daemon matches them once and saves the match in `~/.iphonectl/state.db` (see [State database](#state-database)):

```
capture id 7EF219AD-...  ──── saved once ────▶  UDID 00008020-...  ──▶  lock state, Bluetooth address
   first match: the only new iPhone on USB, or else the only one with that name
```

After that, a rename changes nothing. Only **several new iPhones with the same name, plugged in together**, cannot be matched: `list` warns. Plug them in one at a time once.

**Rename from the Mac** over USB, no touch needed (works while locked):

```bash
iphonectl rename -l 42 "iPhone XR"      # on the lease's iPhone
# renamed "iPhone" to "iPhone XR". The id stays 7EF219AD-69B4-423E-B8C4-4F4A6140822F
```

- `list` and `acquire -d "iPhone XR"` use the new name at once. The Bluetooth link stays connected (tested on iOS 18.7).
- macOS screen capture (QuickTime, daemon logs) keeps the old name until you **unplug and plug in the cable**.

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
        pointer found in P1 and P2 ──▶ gain = measured / computed (saved in state.db)
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

### State database

**`~/.iphonectl/state.db` holds SQLite state.** Device matches and pointer modes are caches. The lease counter is durable and must not be reset. One row per iPhone, keyed by Apple's UDID:

The `lease` table holds active leases. `lease_counter` retains the highest issued ID after expiry, release and schema changes (see [Leases](#leases-one-agent-per-iphone)).

```
phone (USB)                                  bluetooth_pointer (Bluetooth)
┌───────────────────────────────────┐        ┌──────────────────────────────────────┐
│ usb_udid           PK             │◀───────│ usb_udid   PK, FK, ON DELETE CASCADE │
│ screen_capture_id  UNIQUE         │        │ mode       absolute | relative       │
│ capture_matched_by / _at          │        │ gain, screen_width_pt, _height_pt    │
└───────────────────────────────────┘        │ report_map, found_at                 │
                                             └──────────────────────────────────────┘
```

```bash
sqlite3 -header -column ~/.iphonectl/state.db 'SELECT * FROM phone; SELECT * FROM bluetooth_pointer'
# usb_udid                   screen_capture_id                     capture_matched_by  capture_matched_at
# 00008020-000405C214BB002E  7EF219AD-69B4-423E-B8C4-4F4A6140822F  only-new-phone      1790773434
# usb_udid                   mode      gain  screen_width_pt  screen_height_pt  report_map                found_at
# 00008020-000405C214BB002E  absolute                                           classic-a85efc997e025d8f  1790773436
```

| Table | Written when | If the row is missing |
|---|---|---|
| `phone` | a command sees a new iPhone. `capture_matched_by`: `only-new-phone` or `same-name` (see [More iPhones](#4-more-iphones)) | matched again the same way |
| `bluetooth_pointer` | the first tap or swipe | iOS 17+: absolute again, no check. Older iOS: the pointer check runs on the next tap |

- **Not stored**, because USB lockdown gives them on every command: name, Bluetooth address, lock state, AssistiveTouch.
- **Bluetooth pairing is not here.** macOS keeps the bond. A phone paired while the daemon was stopped, or with no `state.db`, reconnects on the next command (tested).
- **A saved match is never changed by itself**, even while its phone is missing from one list during a plug-in. If one is wrong, delete its `phone` row (below).
- **Schema changes preserve the lease counter.** Cache tables can be recreated, but IDs must keep increasing.

**Fix a bad state** with `sqlite3`, also while the daemon runs (it keeps no copy in memory). Turn on `foreign_keys`: the `sqlite3` shell has it off, and without it the pointer row is not deleted with its phone.

```bash
DB=~/.iphonectl/state.db
sqlite3 $DB "PRAGMA foreign_keys = ON; DELETE FROM phone WHERE usb_udid = '00008020-000405C214BB002E'"   # one iPhone
sqlite3 $DB 'DELETE FROM bluetooth_pointer'                                                             # all pointer modes
```

- **Screen from one phone, input to another:** delete its `phone` row. Plug in same-named new phones one at a time.
- **Pointer lands in the wrong spot:** delete its `bluetooth_pointer` row. `iphonectl forget` also does it, but it removes the Bluetooth bond too, so you must pair again.
- **Never delete or restore `state.db`.** Resetting its counter can give a new lease an old ID.

## CLI

| Command | Does |
|---|---|
| `list` | iPhones on USB, `[locked]`, their Bluetooth link state, and who leases them |
| `acquire [--wait s] [--force] [--idle-timeout s] [--holder name]` | take the iPhone; prints the lease id |
| `release` | end the lease |
| `screenshot [-o file.png\|.jpg] [--settle]` | save the screen; `--settle` waits until it stops changing |
| `screentext [--language it-IT] [--json]` | OCR of the screen: `x,y wxh text` per line. English is always included |
| `tap <x> <y>` | tap at screenshot coordinates |
| `tap --text <text> [--index n]` | tap the center of an OCR text line (exact line wins, else contains) |
| `swipe <x1> <y1> <x2> <y2> [--duration ms]` | drag with the button held (on a list row it taps the row) |
| `scroll <up\|down> <ticks> [--at x,y]` | mouse wheel scroll, ~100 points per tick; scrolls lists that `swipe` cannot. See [docs/scroll.md](docs/scroll.md) |
| `key <combo>` | `home`, `enter`, `esc`, `backspace`, arrows, `pageup`, `pagedown`, `end`, `volumeup`, `mute` |
| `type <text> \| type --stdin [--enter]` | validated US-ASCII text; stdin keeps secrets out of arguments |
| `unlock --stdin` | wake and unlock (or `IPHONECTL_PASSCODE`); no screenshot while locked |
| `assistivetouch [on\|off]` | show or set AssistiveTouch over USB; pointer input turns it on by itself |
| `lock` | lock over Bluetooth with Control-Command-Q |
| `rename <name>` | set the iPhone's name over USB; the id does not change |
| `forget` | remove the Mac's Bluetooth bond with the iPhone, to pair again |
| `daemon start\|stop\|restart\|status\|run` | manage the background daemon |

The daemon starts by itself on the first command. After a rebuild, the CLI restarts it.

### Secret text from stdin

**Pipe secrets directly** after checking focus. The CLI validates all input before any key is sent, and does not echo rejected characters.

```bash
secret-provider | iphonectl type -l 42 --stdin
```

One final **LF or CRLF** is removed. Other whitespace is preserved. LF sends Enter and tab moves focus. `--keep-final-newline` preserves LF; `--enter` adds one more Enter. Unsupported controls, invalid UTF-8 and non-ASCII fail before input.

### Bounded text verification

**Send once, then check OCR.** `tap`, `swipe`, `scroll`, `key`, `type` and `wake` accept an expected case-insensitive text substring:

```bash
iphonectl tap -l 42 --text "General" --wait-text "About" --timeout-ms 5000
```

The deadline starts **after input completes**, not during Bluetooth pairing. Default: 5000 ms; range: 1...60000 ms. Capture/OCR reads are cancelled at the client deadline. A timeout says input was sent and reports completed OCR reads, including unchanged text. It never repeats input. OCR cannot prove that input caused a matching screen, especially if that text was already present.

Verification failure stops the command before optional screenshot/OCR output. Read the screen separately before deciding whether another action is safe. Locked-phone, Bluetooth and USB errors retain their own evidence; missing frames alone cannot identify their cause. Never lock a phone to repair capture.

**Environment variables** set a default for every command; a flag overrides them:

| Variable | Same as | Example |
|---|---|---|
| `IPHONECTL_LANGUAGE` | `--language` (OCR in `screentext`, `--screentext`, `tap --text`) | `it-IT` |
| `IPHONECTL_SCALE` | `--scale` (image and coordinate size) | `1` for native pixels |
| `IPHONECTL_PASSCODE` | passcode for `unlock` | user-confirmed secret; prefer `unlock --stdin` |
| `IPHONECTL_LEASE` | `-l, --lease` (every device command) | supported, but agents must pass `-l 42` explicitly |

## Leases: one agent per iPhone

**Every command that uses an iPhone needs a lease.** Two agents on one Mac can no longer tap the same phone at the same time. `list` needs none.

```bash
iphonectl acquire -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F --holder ses_123  # prints 42
iphonectl tap -l 42 207 448    # runs on the lease's iPhone; no -d
iphonectl release -l 42
```

```
agent A: acquire ──▶ lease 42 ──▶ tap -l 42, type -l 42 ────────▶ release -l 42
agent B:       acquire ──▶ error: leased by "ses_123" (ends after 9m58s idle)
agent B:       acquire --wait 600 ─────────── waits ──────────────────────▶ lease 43
```

- **Idle timeout:** a lease ends 10 minutes after its last command (`--idle-timeout`), so a crashed agent never blocks the phone.
- **`--wait <s>`** retries every second (no queue order). **`--force`** takes it from a lease whose holder is gone; that holder's next command fails with `lease-invalid`.
- **After `--wait` or `--force`, take a screenshot first.** Someone else used the phone.
- **Pass the ID explicitly with `-l`.** Tool-call environments may not persist; do not rely on exporting `IPHONECTL_LEASE`.
- **IDs increase in SQLite** and are not reused after expiry, force, release or a daemon restart. Do not delete or restore `state.db`.
- **Holder is only a label.** An acquire with the same holder does not resume an active lease.
- **Lease numbers are coordination IDs, not authentication.** TCP access still requires the daemon bearer token. Anyone with daemon access can acquire or force leases.
- Leases live in the `lease` table of `state.db`, so they survive a daemon restart (a rebuild restarts it).

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
iphonectl screenshot -l 42 -o full.png --scale 1    # native pixels, 828x1792
iphonectl tap -l 42 414 896 --scale 1              # native pixel coordinates
```

`screentext` always runs OCR on native pixels (small text reads better), then scales the boxes.

## Devices in `list`

**Only USB-connected iPhones appear.** `list` gets devices from macOS's QuickTime screen-capture device list, not from a Bluetooth scan. Keep the USB cable attached and trust the Mac once. A Bluetooth-only phone is not listed. Camera permission is required on the Mac; neither a Bluetooth connection nor AssistiveTouch is required just to list a phone. The first `list` asks for Bluetooth access, because it starts Bluetooth.

```text
7EF219AD-69B4-423E-B8C4-4F4A6140822F  Morse’s iPhone (2)  iPhone XR (iPhone11,8) iOS 18.7.10  (bluetooth connected, absolute pointer)
   USB capture ID                        name                model and iOS (USB)                   Bluetooth link, pointer mode
```

**The ID is stable.** It is the USB screen-capture ID, not the Apple UDID. On the same Mac, the XR kept `7EF219AD-…` after a rename, an iOS update, and a cable replug (tested). Save it and pass it with `-d`. Not tested across different Macs.

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

**Locked phones stay listed.** The daemon reads `PasswordProtected` from iOS lockdown over the trusted USB connection using macOS's private `MobileDevice.framework`. It does not need a screen frame. `[locked]` means the passcode is required; its absence means lockdown reports unlocked. If the lock state cannot be read, the field is absent. Capture and lockdown IDs differ; see [More iPhones](#4-more-iphones) for how they are matched.

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
iphonectl acquire --holder <session id>                    # prints e.g. 42
iphonectl screentext -l 42
iphonectl tap -l 42 --text "Tommaso De Rossi" --screenshot s.png --screentext
iphonectl tap -l 42 200 610 --screenshot s.png --screentext   # x,y read from s.png
iphonectl type -l 42 "ciao" --enter --screentext
iphonectl release -l 42
```

**Set the OCR language once** for a non-English phone: `IPHONECTL_LANGUAGE=it-IT` (a BCP 47 tag) applies to `screentext`, `--screentext` and `tap --text`. `--language` overrides it. English is always included. Without it, accents and local words are misread.

- **Text first, image when needed.** `--screentext` output is cheap and often enough to decide (a new title, a sent message). Read `s.png` for icons, layout, or text OCR misses.
- **Both flags use one frame:** the daemon waits for a still screen (up to 2 s after frames start). When both flags are set, the CLI gets a native PNG, runs OCR on it, and resizes that same image for saving. No second capture or public frame ID. A blank or unchanged image is not proof that input failed.
- **Check focus before you type.** `type` sends keys to the field that has focus, and you cannot see which one from the command. Read a screenshot first: the cursor must be in the field you want. In Messages, Enter in the **To:** field adds the recipient but keeps focus there, so `type "ciao" --enter` put "ciao" into To: (tested on iOS 18.7). Tap the message field, check the screenshot, then type.

  ```bash
  iphonectl type -l 42 "3336052139" --enter        # To: field, adds the recipient
  iphonectl tap -l 42 200 562 --screenshot s.png   # check focus in the image
  iphonectl type -l 42 "ciao" --enter --screentext # Enter sends
  ```

- **Tap text, not pixels:** `tap --text "..."` saves a screenshot read and coordinate guessing. On the Home Screen, app **labels do not open apps** (tested on iOS 15): tap the icon, about 40 points above the label.
- **No clever loops.** Do not script loops that wait for a text you guess ("Open", "Done"). The next screen is hard to predict: iOS shows sheets and alerts at any time (the App Store asks to confirm **Install**, then can say "requires iOS 16 or later"), and a loop that waits for one word waits forever (this happened while installing Reddit on the 6s). Use a loop only when a skill or document you follow asks for it explicitly. Otherwise use the plain feedback loop: one action, read the whole screen, decide the next action.
- **Failed capture after an action:** the error says **action completed**. Do not repeat the action blindly; take a screenshot first.
- **No frames:** `screenshot` and `screentext` reject a locked iPhone quickly. If `list` reports unlocked but capture still gets no frame, see [USB screen capture stops](#usb-screen-capture-stops-ios-bug-restart-the-daemon-then-the-iphone).

**Leave the iPhone unlocked.** Do not run `iphonectl lock` at the end of a task. Locking stops USB screen capture and makes the next action less reliable. Use `unlock` only when `list` shows `[locked]`; use `lock` only when the task explicitly needs a locked phone.

**Agents:** `.passcode` is stale. Never read it. Use only the user-confirmed Sigillo `IPHONE_PASSCODE`, piped directly to `iphonectl unlock -l 42 --stdin`, without printing it or putting it in arguments. Do not retry a failed unlock.

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
curl --unix-socket $S -H 'content-type: application/json' \
  -d '{"device":"default","holder":"curl"}' http://localhost/v1/leases   # {"id":"42",…}
L=http://localhost/v1/leases/42
curl --unix-socket $S $L/screenshot -o s.png
curl --unix-socket $S -H 'content-type: application/json' \
  -d '{"x":207,"y":448}' $L/tap                    # screen points, like the screenshot
curl --unix-socket $S $L/assistive-touch            # {"enabled":true}
curl --unix-socket $S -X DELETE $L                  # release
```

- **Screenshots and input live under `/v1/leases/{lease}/`** and run on the lease's iPhone. Unknown, expired, released or taken with `force`: `lease-invalid` (403). Acquire while held: `device-leased` (409); retry to wait.
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

- **The passcode is never stored.** `unlock` gets it per call; prefer a direct pipe to `unlock -l 42 --stdin`, not an argument.
- **Apple Pay still needs you.** It asks for a double press of the side button, which the Mac cannot press.

## Limits

- **AssistiveTouch must be on** for tap and swipe. iphonectl turns it on over USB; its floating button can be hidden (see setup step 2).
- **Keyboard without AssistiveTouch** is not tested.
- **`cmd+space` and `cmd+h`** did nothing in tests.
- **No verified global Back command.** `key home` goes Home; `key esc` sends Escape. Neither is a promise of Back in Settings or Safari. AC Back (Consumer usage `0x0224`) is not exposed because reliable iOS behavior has not been verified. Descriptors are unchanged.
- **Screen off:** no frames. `unlock` tries to wake a locked iPhone; USB capture may still return no frame. An unlocked one with the screen off needs a tap from you.
- **Several new iPhones with one name**, plugged in together, cannot be matched to their USB data. Plug them in one at a time once (see [More iPhones](#4-more-iphones)).
- **Many fast daemon restarts** can hide the iPhones for about a minute. macOS throttles the screen capture helper.
- **About 7 iPhones per Mac**, set by Bluetooth, not by iphonectl. Only 2 tested. See [How many iPhones per Mac](#how-many-iphones-per-mac).
- **The cable must stay in.** Screenshots only come over USB; a phone on Bluetooth or Wi-Fi alone is not listed.
- **Typing is US-ASCII only**: no accents or emoji. There is no length limit.

### Pairing no longer works: forget on both sides

**Symptoms:** Pair on the iPhone ends with "Connection unsuccessful", the Mac is missing from the iPhone's Bluetooth list, or `list` stays at `bluetooth disconnected`.

**Cause:** one side still has an old bond and the other side does not. This happens after a Forget on only one side, a phone reset, a phone paired with an older iphonectl (BLE), or a report map change. The side with the old key rejects the new pairing (tested on the iPhone 6s and XR).

**Fix: remove the bond on both sides, then pair again.**

1. iPhone: Settings > Bluetooth > the Mac > (i) > **Forget This Device**.
2. Mac: `iphonectl forget` (with a lease on that iPhone). It removes the Mac's bond (same as System Settings > Bluetooth > the iPhone > (i) > **Forget This Device**).
3. Run any input command, for example `iphonectl key home`. It makes the Mac discoverable and waits.
4. iPhone: Settings > Bluetooth, tap the Mac under Other Devices, then **Pair**.

The Mac is listed on the iPhone **only while a command waits for pairing**. With no command waiting, it is not discoverable, and a new iPhone does not see it.

### USB screen capture stops (iOS bug): restart the daemon, then the iPhone

**iOS can stop sending its screen over USB** while macOS still lists it. `list` works and the lock state is correct, but `screenshot` gets no frame and no error:

```text
error: No frame from Morse’s iPhone (2) after 8s (session running, 0 frames since open). ...
```

- **First try `iphonectl daemon restart`.** It fixed a stuck capture that failed with `Recording Stopped (AVFoundationErrorDomain -11808)` (iOS 18.7).
- **If frames still do not arrive, restart the iPhone.** Replugging the cable does not help, and in some cases the daemon restart did not help either (tested on iOS 18.7).
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
- Files: `~/.iphonectl/daemon.sock`, `daemon.log`, `daemon.lock`, `state.db`.

</details>
