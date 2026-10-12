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
adds; switch back at any time.

## Bluetooth or XCTest

|                              | Bluetooth (default)              | XCTest                                                 |
| ---------------------------- | -------------------------------- | ------------------------------------------------------ |
| **Taps**                     | AssistiveTouch mouse pointer     | XCTest touch events, like a finger                     |
| **Screenshots**              | USB screen capture               | XCTest screenshots, also of dialogs that capture hides |
| **Text**                     | US-ASCII, as a hardware keyboard | Any text (accents, emoji), as the on-screen keyboard   |
| **Lock, passcode unlock**    | Yes                              | No: keep the iPhone unlocked                           |
| **Mute, keyboard shortcuts** | Yes                              | No                                                     |
| **On the Mac**               | Nothing to install               | Xcode, signed in to an Apple account                   |
| **On the iPhone**            | Trust + Bluetooth pairing        | Trust + Developer Mode + UI Automation                 |
| **Renewal**                  | None                             | Free Apple account: rebuild every 7 days               |
| **iPhones per Mac**          | About 7 (Bluetooth limit)        | No Bluetooth limit                                     |

**Why XCTest:**

- **Hidden dialogs show up.** Some system dialogs (location permission, Apple Account
  prompts) are left out of USB screen capture. XCTest screenshots come from iOS itself.
- **System alerts take the tap.** A few alerts ignore the first AssistiveTouch click. XCTest
  sends touch events the way Apple's own UI tests do.
- **No AssistiveTouch.** No pointer dot or floating button in screenshots and recordings.
- **Any language.** `type` sends accents and emoji.

**Why Bluetooth:** nothing to install or renew, works on a locked iPhone (`unlock`), and the
input path is the one a person with a mouse and keyboard uses.

Recording and the dashboard preview use USB screen capture in both modes.

## Setup

Do these once per Mac and once per iPhone. ghosthand checks each one and says which is
missing.

### 1. Xcode on the Mac

1. Install **Xcode** from the App Store and open it once.
2. **Xcode > Settings > Accounts**, click **+**, sign in with your Apple account. A free
   account works.
3. Select the team, click **Manage Certificates**, then **+ > Apple Development**.

Several teams in the keychain? Pass one: `ghosthand control -l 42 xctest --team 92MF9DG2LR`.

### 2. Developer Mode on the iPhone

iOS hides the switch until a developer tool connects. **ghosthand shows it for you** over
USB when you choose XCTest, so you only need to turn it on:

1. On the iPhone: **Settings > Privacy & Security > Developer Mode**, turn it on.
2. Tap **Restart**.
3. After the restart, unlock the iPhone and tap **Turn On**, then enter the passcode.

The setup window waits on this step and continues by itself after the restart.

### 3. Choose XCTest

From the setup window (the choice is hidden by default):

```bash
ghosthand setup --xctest
```

Pick **XCTest** under the phone. Or from a terminal with a lease:

```bash
ghosthand control -l 42 xctest
```

The first time, the Mac builds WebDriverAgent for this iPhone (1-3 minutes) and installs it.

### 4. Allow it on the iPhone

The first start asks for two things on the iPhone:

1. **Trust the developer** (free accounts): **Settings > General > VPN & Device Management**,
   tap **Apple Development: your account**, then **Trust**.
2. **UI Automation**: **Settings > Developer > Enable UI Automation**. When iOS asks for the
   passcode to allow automation, enter it.

Then press **Try again** in setup, or run `control xctest` again.

### 5. Keep it unlocked

XCTest cannot type a passcode. Set **Settings > Display & Brightness > Auto-Lock > Never**
while agents use the iPhone.

## Commands in XCTest mode

All commands work the same, with these differences:

| Command                                           | In XCTest mode                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tap`, `double-tap`, `hold`, `swipe`, `hold-drag` | Touch events                                                                 |
| `scroll`                                          | Slow drags of about 100 points per tick                                      |
| `type`                                            | Any text, into the field that has focus                                      |
| `key`                                             | Only `home`, `volumeup`, `volumedown`, `enter`, `backspace`, `tab`, `space`  |
| `screenshot`, `screentext`                        | XCTest screenshots; `--native` is not needed                                 |
| `lock`, `unlock`, `mute`, `unmute`                | Error `unsupported-in-mode`: a locked iPhone cannot be unlocked in this mode |

`ghosthand list` shows `(xctest running)` instead of the Bluetooth state. After a daemon
restart the runner is `stopped`; the next command starts it again (about 15 s).

## Troubleshooting

| Message                                                 | What to do                                                |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `No Accounts`                                           | Sign in to Xcode: Settings > Accounts                     |
| `Developer Mode`                                        | Step 2 above                                              |
| `not been explicitly trusted`, `invalid code signature` | Trust the developer (step 4)                              |
| `UI Automation`                                         | Settings > Developer > Enable UI Automation               |
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
- **One state per iPhone.** The mode lives in `~/.ghosthand/state.db`; leases, OCR and
  waits do not change.
- **Coordinates.** Screenshot points become fractions of a USB capture frame, as in Bluetooth
  mode, then screen points for WebDriverAgent.
- **Developer Mode switch.** Shown with the AMFI lockdown service (action 0), the same call
  Apple's `devmodectl` makes. Only pairing is needed. Turning it on stays with you: iOS
  allows that only without a passcode.

| Command                                         | WebDriverAgent route                            |
| ----------------------------------------------- | ----------------------------------------------- |
| tap, double-tap, hold, swipe, hold-drag, scroll | `POST /session/:id/actions` (one touch pointer) |
| key home                                        | `POST /wda/homescreen`                          |
| key volumeup, volumedown                        | `POST /session/:id/wda/pressButton`             |
| type, key enter / backspace / tab / space       | `POST /session/:id/wda/keys`                    |
| lock / wake                                     | `POST /wda/lock` / `POST /wda/unlock`           |
| screenshot                                      | `GET /screenshot`                               |

<details>
<summary>Reference projects and open questions</summary>

Projects read while building this (October 2026):

- [appium/WebDriverAgent](https://github.com/appium/WebDriverAgent): the runner; v16.15.0 builds with Xcode 26.6.
- [callstackincubator/agent-device](https://github.com/callstackincubator/agent-device): own XCTest runner started with `xcodebuild test-without-building`, own usbmux client; tested on iOS 26.5.
- [mobile-next/mobilecli](https://github.com/mobile-next/mobilecli): own runner, re-signs a prebuilt app.
- [appium/appium-xcuitest-driver](https://github.com/appium/appium-xcuitest-driver): `devicectl` launch breaks on iOS 27 ([appium#22636](https://github.com/appium/appium/issues/22636)), so ghosthand keeps xcodebuild.
- [doronz88/pymobiledevice3](https://github.com/doronz88/pymobiledevice3) `services/amfi.py`: the Developer Mode reveal call.

Not verified on a device yet:

- Which hidden dialogs the XCTest screenshot shows. The Apple 2FA alert was black even in
  a native iOS screenshot.
- Whether a running XCTest session keeps the screen from auto-locking.
- The scroll distance per tick.

</details>
