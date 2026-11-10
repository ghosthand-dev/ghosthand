---
title: XCTest mode
description: Opt-in control of an iPhone through Apple's XCTest UI testing (WebDriverAgent) instead of the Bluetooth mouse and keyboard. Setup, limits, and how it works.
---

**One iPhone can take input from Apple's XCTest UI testing instead of the Bluetooth mouse
and keyboard.** ghosthand builds WebDriverAgent (the XCUITest runner Appium uses), starts it
with Xcode, and calls it over USB. The commands stay the same.

```bash
ghosthand control -l 42 xctest      # build once (1-3 min), start, wait until it answers
ghosthand tap -l 42 207 448 --screenshot s.png
ghosthand control -l 42 bluetooth   # back to the default
```

Bluetooth stays the default. Use XCTest mode when you already have Xcode and want what it
adds. You can switch back at any time.

## Bluetooth or XCTest

|                              | Bluetooth (default)              | XCTest                                                 |
| ---------------------------- | -------------------------------- | ------------------------------------------------------ |
| **Taps**                     | AssistiveTouch mouse pointer     | XCTest touch events, like a finger                     |
| **Screenshots**              | USB screen capture               | XCTest screenshots; hidden-dialog support is not verified |
| **Text**                     | US-ASCII, as a hardware keyboard | Any text (accents, emoji), as the on-screen keyboard   |
| **Lock, passcode unlock**    | Yes                              | No: keep the iPhone unlocked                           |
| **Mute**                     | Yes                              | No                                                     |
| **On the Mac**               | Nothing to install               | Xcode, signed in to an Apple account                   |
| **On the iPhone**            | Trust + Bluetooth pairing        | Trust + Developer Mode + UI Automation                 |
| **Renewal**                  | None                             | Free Apple account: rebuild every 7 days               |
| **iPhones per Mac**          | About 7 (Bluetooth limit)        | No Bluetooth limit                                     |

Pick XCTest for these reasons:

- **Another screenshot path.** USB screen capture leaves out some system dialogs. XCTest
  screenshots come from iOS itself, but nobody has verified that they show the hidden dialogs.
- **System alerts take the tap.** A few alerts ignore the first AssistiveTouch click. XCTest
  sends touch events the way Apple's own UI tests do.
- **No AssistiveTouch.** Screenshots and recordings show no pointer dot or floating button.
- **Any language.** `type` sends accents and emoji.

**Bluetooth needs nothing to install or renew.** It works on a locked iPhone (`unlock`), and
it uses the same input path as a person with a mouse and keyboard.

Recording and the dashboard preview use USB screen capture in both modes.

## Setup

Do these steps once per Mac and once per iPhone. ghosthand checks each step and says which
one is missing.

### 1. Xcode on the Mac

1. Install **Xcode** from the App Store and open it once.
2. Open **Xcode > Settings > Accounts**, click **+**, and sign in with your Apple account. A
   free account works.
3. Select the team, click **Manage Certificates**, then click **+ > Apple Development**.

If the keychain has several teams, pass one: `ghosthand control -l 42 xctest --team 92MF9DG2LR`.

### 2. Developer Mode on the iPhone

iOS hides the switch until a developer tool connects. When you choose XCTest, **ghosthand
shows the switch** over USB, so you only need to turn it on:

1. On the iPhone, open **Settings > Privacy & Security > Developer Mode** and turn it on.
2. Tap **Restart**.
3. After the restart, unlock the iPhone and tap **Turn On**, then enter the passcode.

The setup window waits on this step and continues by itself after the restart.

### 3. Choose XCTest

Choose XCTest in the setup window. The window shows the choice once Developer Mode is on.
Before that, open the window with the choice:

```bash
ghosthand setup --xctest
```

Pick **XCTest** under the phone. You can also choose it from a terminal with a lease:

```bash
ghosthand control -l 42 xctest
```

The first time, the Mac builds WebDriverAgent for this iPhone (1-3 minutes) and installs it.

### 4. Allow it on the iPhone

The first start asks for two things on the iPhone:

1. **Trust the developer.** Free accounts need this. Open **Settings > General > VPN & Device
   Management**, tap **Apple Development: your account**, then tap **Trust**.
2. **Turn on UI Automation.** Open **Settings > Developer** and turn on **Enable UI
   Automation**. When iOS asks for the passcode to allow automation, enter it.

Then press **Try again** in setup, or run `control xctest` again.

### 5. Keep it unlocked

XCTest cannot type a passcode. Set **Settings > Display & Brightness > Auto-Lock > Never**
while agents use the iPhone.

## Limitations

**A new runner session can ask for the passcode.** Since iOS 15, iOS can ask for the
passcode (or Touch ID) to allow UI automation when WebDriverAgent starts, even with
Enable UI Automation already on. This is an Apple security rule. No XCTest tool can skip
it ([appium#19363](https://github.com/appium/appium/issues/19363)).

```
runner exit, reboot, replug ───────────> WebDriverAgent starts ──> iOS asks for passcode
                                                                    │
                     nobody types it ──> "Timed out while enabling automation mode"
```

- **iOS asks only when the runner starts**, never on each command. A daemon restart or
  update does not start the runner again (see Runner job below). The runner starts after
  it exits, after a reboot, or after a replug. Appium users report the prompt coming back after hours or days
  with no clear cause. Apple does not document how often.
- **A locked iPhone fails the same way.** The runner cannot start until a person unlocks it.
- **For unattended use, turn the iPhone passcode off.** This is the only workaround Appium
  maintainers give. It also turns off Touch ID or Face ID, Apple Pay and iCloud Keychain.
- With a passcode, someone must be at the iPhone each time the runner starts. Bluetooth
  mode does not have this limit, because it types the passcode itself (`unlock`).

## Commands in XCTest mode

All commands work the same, with these differences:

| Command                                           | In XCTest mode                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tap`, `double-tap`, `hold`, `swipe`, `hold-drag` | Touch events                                                                 |
| `scroll`                                          | Slow drags of about 100 points per tick                                      |
| `type`                                            | Any text, into the field that has focus                                      |
| `key`                                             | `home`, `volumeup`, `volumedown`, `enter`, `backspace`, `tab`, `space`, and shortcuts like `cmd+space`, `cmd+c` |
| `screenshot`, `screentext`                        | XCTest screenshots; `--native` is not needed                                 |
| `lock`, `unlock`, `mute`, `unmute`                | Error `unsupported-in-mode`: a locked iPhone cannot be unlocked in this mode |

`ghosthand list` shows `(xctest running)` instead of the Bluetooth state. The runner keeps
running through daemon restarts and updates, and the new daemon uses it. `control
bluetooth` stops it. A runner that exited starts again on the next command (about 15 s).

## Troubleshooting

| Message                                                 | What to do                                                |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `No Accounts`                                           | Sign in to Xcode: Settings > Accounts                     |
| `Developer Mode`                                        | Step 2 above                                              |
| `not been explicitly trusted`, `invalid code signature` | Trust the developer (step 4)                              |
| `UI Automation`                                         | Settings > Developer > Enable UI Automation               |
| `Timed out while enabling automation mode`              | Unlock the iPhone and enter the passcode if asked ([Limitations](#limitations)) |
| `maximum number of apps`                                | A free account signs 3 apps per iPhone: delete an old one |
| Stopped working after a week                            | `ghosthand control -l 42 xctest --rebuild`                |

Logs are in `~/.ghosthand/xctest/<udid>-build.log` and `<udid>-run.log`.

## How it works

```diagram
CLI / MCP ──> daemon ──> Controller (leases, OCR, waitText, settle) ──> PhoneDriver
                                                                         │
                                       ┌─────────────────────────────────┴──────┐
                                       v                                        v
                               BluetoothDriver                           XCTestDriver
                         HID mouse + keyboard (default)                       │
                                                                              │ HTTP/1.1 over
                                                                              │ USB (usbmux),
                                                                              v port 8100
  ~/.ghosthand/xctest/  WebDriverAgent source ──> xcodebuild build  ──> WebDriverAgent
                        (pinned tag)              -for-testing          on the iPhone, kept
                                                  (your team)           alive by xcodebuild
                                                                        test-without-building
```

- **No Appium server, no client library.** The daemon calls WebDriverAgent's HTTP routes
  itself, through the same USB connection Finder uses (MobileDevice `USBMuxConnectByPort`).
- **One state per iPhone.** The daemon stores the mode in `~/.ghosthand/state.db`, keyed
  only by the USB UDID. A new or deleted screen capture match keeps the mode, and setup can
  choose XCTest before screen capture lists the iPhone. Leases, OCR and waits do not change.
- **Runner job.** `xcodebuild test-without-building` runs as its own launchd job,
  `dev.ghosthand.xctest.<udid>`. Its plist is in `~/.ghosthand/xctest/`, and it is not a
  login item. A daemon restart, update or crash leaves the job running. The next daemon uses
  the runner if it runs the current build for the iPhone's team. Otherwise the daemon stops
  it. `control bluetooth`, a new team and `control xctest` stop it (`launchctl bootout`).
  The job ends at logout.
- **Tool ownership.** Builds and short tools run under a supervisor that watches a pipe
  that the daemon holds. If the daemon exits or crashes, the supervisor stops their
  process group.
- **Coordinates.** Screenshot points become fractions of the last XCTest screenshot (its
  native pixels), then screen points for WebDriverAgent (pixels / `scale` from
  `GET /wda/screen`, read once). Input needs no USB frame, so it works while capture is
  dark or frozen. Every screenshot refreshes the size, so it follows a rotation the agent saw.
- **No Bluetooth.** The Mac's Bluetooth service starts only when a USB iPhone uses
  Bluetooth mode, and setup does not ask for the Bluetooth permission while every iPhone
  uses XCTest.
- **Developer Mode switch.** ghosthand shows the switch with the AMFI lockdown service
  (action 0), the same call that Apple's `devmodectl` makes. This needs only pairing. You
  turn the switch on yourself, because iOS lets a tool turn it on only when the iPhone has
  no passcode.

| Command                                         | WebDriverAgent route                            |
| ----------------------------------------------- | ----------------------------------------------- |
| tap, double-tap, hold, swipe, hold-drag, scroll | `POST /session/:id/actions` (one touch pointer) |
| key home                                        | `POST /wda/homescreen`                          |
| key cmd+space, cmd+c, ...                       | `POST /session/:id/wda/element/0/keyboardInput` |
| key volumeup, volumedown                        | `POST /session/:id/wda/pressButton`             |
| type, key enter / backspace / tab / space       | `POST /session/:id/wda/keys`                    |
| lock / wake                                     | `POST /wda/lock` / `POST /wda/unlock`           |
| screenshot                                      | `GET /screenshot`                               |
| screen scale (once, for coordinates)            | `GET /session/:id/wda/screen`                   |

<details>
<summary>Reference projects and open questions</summary>

Projects read while building this (October 2026):

- [appium/WebDriverAgent](https://github.com/appium/WebDriverAgent): the runner. Version 16.15.0 builds with Xcode 26.6.
- [callstackincubator/agent-device](https://github.com/callstackincubator/agent-device): has its own XCTest runner, started with `xcodebuild test-without-building`, and its own usbmux client. It was tested on iOS 26.5.
- [mobile-next/mobilecli](https://github.com/mobile-next/mobilecli): has its own runner and re-signs a prebuilt app.
- [appium/appium-xcuitest-driver](https://github.com/appium/appium-xcuitest-driver): `devicectl` launch breaks on iOS 27 ([appium#22636](https://github.com/appium/appium/issues/22636)), so ghosthand keeps xcodebuild.
- [doronz88/pymobiledevice3](https://github.com/doronz88/pymobiledevice3) `services/amfi.py`: the call that shows the Developer Mode switch.

Seen on an iPhone SE2 (iOS 18.6.2):

- The runner exits when Xcode loses its CoreDevice connection to the iPhone. The xcresult
  says `connection was invalidated` or `tunnel connection failed`, and there is no crash
  report. On 12 October this happened 13 times, 10-170 s after start, during the first
  development day on another SE2. Since then, runs lasted 5 h and 47 h. The cause is
  unknown: 8 cycles of opening and closing USB capture did not stop a running runner
  (6 November). The next command restarts the runner in 5-18 s, possibly with a passcode
  prompt. The failed command says `xctest-unavailable`.
- Runner starts on this SE2 showed **Enter iPhone Passcode for "XCTest"** (Enable UI
  Automation), even while the iPhone was unlocked. Each start timed out after about 65 s
  until a person typed the passcode. The next start, hours later, did not ask.
- A screenshot taken right after a gesture can show the status bar clock as 9:41. iOS
  overrides the clock while a UI test runs, and USB capture shows it too. Rarely, the
  screenshot shows a screen from many minutes earlier.
- `type` with no focused field still succeeds. WebDriverAgent does not check focus.

Not verified on a device yet:

- Which hidden dialogs the XCTest screenshot shows. The Apple 2FA alert was black even in
  a native iOS screenshot. The Instagram prompt test did not show a system dialog.
- Whether a running XCTest session keeps the screen from auto-locking.
- The scroll distance per tick.

</details>
