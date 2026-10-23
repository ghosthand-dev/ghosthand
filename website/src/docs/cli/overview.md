---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand CLI reference"
sidebarTitle: "Overview"
description: "Every ghosthand 0.10.0 command, option and example, generated from the CLI help."
---

The **ghosthand** CLI controls an iPhone through the daemon on your Mac. Every command is
also an [MCP tool](/docs/mcp/overview) and an [HTTP route](/docs/api/overview), with the same help text.

## Install

```bash
npx ghosthand --help
```

## Agent loop

Take a lease, act, read the screen, release. Commands that use an iPhone need the lease with `-l`.

1. `ghosthand list` (which iPhones, locked, leased by whom)  
   `ghosthand acquire -d <id> --label <session id> --reason "<task>"` (prints e.g. studio:42 (42 below))
2. `ghosthand screentext -l 42` (read text and boxes (cheap, no image))  
   `ghosthand screenshot -l 42 -o s.png` (or look at the screen (~500 tokens))
3. `ghosthand tap -l 42 --text "Label" --screenshot s.png --screentext`  
   `ghosthand tap -l 42 <x> <y> --screenshot s.png --screentext` (x,y read from s.png)
4. read the printed text and s.png, decide the next action toward the task, repeat 3
5. `ghosthand release -l 42` (when the task is done)

The full rules are in the [agent manual](#agent-manual).

## Global options

| Option | Description |
| --- | --- |
| `-l, --lease [id]` | Lease id from `ghosthand acquire` (or GHOSTHAND_LEASE) with its Mac, e.g. studio:42 for an iPhone on Mac studio. Every command that uses an iPhone needs it and runs on its iPhone |
| `-h, --help` | Display this message |
| `-v, --version` | Display version number |

## Commands

Grouped commands take a subcommand: `ghosthand file push`. MCP tool names join the words with `-`.

### Leases

| Command | What it does |
| --- | --- |
| [`list`](/docs/cli/list) | List iPhones connected over USB, to this Mac and to the account's other Macs |
| [`acquire`](/docs/cli/acquire) | Take exclusive use of an iPhone for a task. Prints a short lease id; pass it explicitly with -l to every other command |
| [`wait`](/docs/cli/wait) | Wait until another lease on the iPhone ends, then acquire it. Use only after `acquire` said it is busy and you decided to wait |
| [`release`](/docs/cli/release) | End the lease from -l or GHOSTHAND_LEASE, so another client can acquire the iPhone |

### Screen

| Command | What it does |
| --- | --- |
| [`screenshot`](/docs/cli/screenshot) | Save the current iPhone screen as PNG (or JPG) over USB, in about 0.3s |
| [`screentext`](/docs/cli/screentext) | Read the text on the iPhone screen with on-device OCR. One line per text: `x,y wxh text` in screenshot coordinates (same space as tap) |

### Input

| Command | What it does |
| --- | --- |
| [`tap`](/docs/cli/tap) | Tap at screenshot coordinates or on text found by OCR, via the AssistiveTouch mouse pointer |
| [`double-tap`](/docs/cli/double-tap) | Double tap at screenshot coordinates or on text found by OCR, via the AssistiveTouch mouse pointer |
| [`triple-tap`](/docs/cli/triple-tap) | Triple tap at screenshot coordinates or on text found by OCR, via the AssistiveTouch mouse pointer |
| [`hold`](/docs/cli/hold) | Press and hold (long press) at screenshot coordinates or on text found by OCR, via the AssistiveTouch mouse pointer |
| [`swipe`](/docs/cli/swipe) | Swipe a finger like a person from (x1,y1) to (x2,y2) in screenshot coordinates: fast, lifted while moving. For TikTok, feeds, lists, carousels, Home Screen pages |
| [`hold-drag`](/docs/cli/hold-drag) | Long press at (x1,y1), then drag to (x2,y2) with the button still held: moves items that need a long press first, like Home Screen icons |
| [`scroll`](/docs/cli/scroll) | Scroll with the Bluetooth mouse wheel over a point (default: screen center). Use this to scroll web pages and lists; one tick is about 100 points |
| [`key`](/docs/cli/key) | Press a key on the Bluetooth keyboard: home (Home Screen), enter, backspace, esc, arrows, volumeup. cmd+space opens Spotlight to open apps |
| [`type`](/docs/cli/type) | Type text on the Bluetooth keyboard (US-ASCII) |

### Tasks

| Command | What it does |
| --- | --- |
| [`task`](/docs/cli/task) | Do a task in plain words: a fast agent on ghosthand.dev reads the screen with OCR and taps until it is done, then answers |

### iPhone

| Command | What it does |
| --- | --- |
| [`wake`](/docs/cli/wake) | Turn the display on with a Bluetooth click at the status bar, then check that USB frames arrive |
| [`lock`](/docs/cli/lock) | Lock the iPhone over Bluetooth with Control-Command-Q; verify over USB |
| [`unlock`](/docs/cli/unlock) | Unlock with the Bluetooth keyboard: Enter, Enter, passcode, then check the lock state over USB (~3s). A wrong passcode is not retried |
| [`mute`](/docs/cli/mute) | Mute all iPhone sound (media in every app too) with the Bluetooth keyboard Mute key, confirmed from the iPhone log over USB |
| [`unmute`](/docs/cli/unmute) | Turn iPhone sound back on after `mute`, confirmed from the iPhone log over USB |
| [`assistivetouch`](/docs/cli/assistivetouch) | Show, or turn on or off, AssistiveTouch over USB (no touch on the phone, also while locked). acquire turns it on, release turns it off |
| [`rename`](/docs/cli/rename) | Set the iPhone's name over USB (Settings &gt; General &gt; About &gt; Name), no touch needed |
| [`forget`](/docs/cli/forget) | Remove this Mac's Bluetooth bond with the iPhone, to pair again from scratch |
| [`control`](/docs/cli/control) | Show or switch how input reaches the iPhone: Bluetooth mouse and keyboard (default) or XCTest (WebDriverAgent). Switch only when the user asks |
| [`info`](/docs/cli/info) | Show battery, storage, iOS build, serial number, language, time zone and SIM over USB (works while locked) |
| [`logs`](/docs/cli/logs) | Read the iPhone system log over USB for a few seconds, filtered by process or text |
| [`restart`](/docs/cli/restart) | Restart the iPhone over USB. Afterwards a person must type the passcode once |
| [`shutdown`](/docs/cli/shutdown) | Turn the iPhone off over USB. Only a person can turn it on again |

### Recording

| Command | What it does |
| --- | --- |
| [`record start`](/docs/cli/record-start) | Start recording the iPhone screen and sound to a new .mov or .mp4 file. Stops by itself after 5 minutes; stop earlier with record stop |
| [`record stop`](/docs/cli/record-stop) | Stop the screen recording and wait until the file is complete. Prints path, duration, size, resolution and fps |

### Files, photos and apps

| Command | What it does |
| --- | --- |
| [`file list`](/docs/cli/file-list) | List a folder on the iPhone over USB (AFC): /DCIM, /Downloads, or an app's /Documents with --app |
| [`file pull`](/docs/cli/file-pull) | Copy a file or folder from the iPhone to this Mac over USB |
| [`file push`](/docs/cli/file-push) | Copy a file from this Mac to the iPhone over USB, replacing it and making missing folders |
| [`file remove`](/docs/cli/file-remove) | Remove a file, or a folder with everything in it, on the iPhone over USB |
| [`photo list`](/docs/cli/photo-list) | List the newest Camera Roll files (photos, videos, screenshots) on the iPhone, newest first |
| [`photo pull`](/docs/cli/photo-pull) | Copy the newest Camera Roll files (photos, videos, screenshots) from the iPhone to this Mac |
| [`photo delete`](/docs/cli/photo-delete) | Delete photos from the iPhone's Photos library by file name (from photo list), over USB |
| [`upload`](/docs/cli/upload) | Upload a photo or video to a 1-day link that Safari on the iPhone saves to Photos (Save Video, Save Image) |
| [`app list`](/docs/cli/app-list) | List installed apps over USB, with where each icon is on the Home Screen |
| [`app install`](/docs/cli/app-install) | Install an .ipa signed for this iPhone over USB (ad hoc, enterprise or development signing) |
| [`app uninstall`](/docs/cli/app-uninstall) | Uninstall an app and its data over USB, like Remove App &gt; Delete App |

### Setup and account

| Command | What it does |
| --- | --- |
| [`setup`](/docs/cli/setup) | Open the setup window: connect a new iPhone over USB and Bluetooth, step by step |
| [`setup status`](/docs/cli/setup-status) | Read setup readiness as JSON, including missing permissions and disconnected phones; no lease needed |
| [`account`](/docs/cli/account) | Show this Mac's ghosthand.dev account: who is signed in, the plan, and the subscribe link |
| [`account login`](/docs/cli/account-login) | Sign this Mac in to ghosthand.dev in the browser. For people; agents run `ghosthand setup` instead |
| [`account logout`](/docs/cli/account-logout) | Sign this Mac out of ghosthand.dev; leases fail until it signs in again |
| [`dashboard`](/docs/cli/dashboard) | Open the control plane window: every iPhone, which agent uses it and why, and its live screen |

### Tunnel and scripts

| Command | What it does |
| --- | --- |
| [`tunnel url`](/docs/cli/tunnel-url) | Print this Mac's tunnel URL, to call the HTTP API from a script (curl, Linux). --new-token also creates the API token |
| [`tunnel revoke`](/docs/cli/tunnel-revoke) | Revoke an API token made with `tunnel url --new-token`; scripts that use it get 401 |

### Daemon

| Command | What it does |
| --- | --- |
| [`daemon start`](/docs/cli/daemon-start) | Start the background daemon. Other commands start it on demand |
| [`daemon stop`](/docs/cli/daemon-stop) | Stop the daemon |
| [`daemon restart`](/docs/cli/daemon-restart) | Restart the daemon |
| [`daemon status`](/docs/cli/daemon-status) | Show daemon state, listeners, Bluetooth state and the log path |
| [`daemon run`](/docs/cli/daemon-run) | Run the daemon in the foreground (for launchd or debugging) |

### Random values

| Command | What it does |
| --- | --- |
| [`random`](/docs/cli/random) | Make a random name, lastname, username, birthdate (18+) or password for a new account, saved with the lease. `random list` shows every saved value |

## Agent manual

The rules every agent gets with `ghosthand --help`, and as the MCP server instructions.

- Ghosthand app windows are user-only. Never interact with them for the user.
- Missing macOS Camera or Bluetooth permission: run `ghosthand setup` once and tell
  the user to complete setup in the small Ghosthand window. Poll `setup status`
  every 2 seconds until ready is true, then continue automatically. Do not request
  permissions yourself. No normal command or preview shows permission dialogs.
- Leases: every command that uses an iPhone needs one (list does not). Always pass
  --reason with your task. An iPhone leased by someone else fails at once and shows
  the label, reason, and how long ago it was acquired and last used. Decide: give
  up or tell the user, or run `ghosthand wait`. Never --force unless its holder is
  gone. A lease ends after 10 min without a command.
  Pass -l explicitly: tool-call environments may not persist. --label is display only.
- --wait-text checks a known expected text after input, with --timeout-ms 1...60000
  (default 5000). A timeout says input was sent; never repeat input automatically.
  Already-present matching text does not prove the action caused a transition.
- Non-English phone: export GHOSTHAND_LANGUAGE=it-IT (or pass --language) once, so
  screentext and tap --text read accents and local words right.
- Coordinates are screen points by default: the numbers you read in a screenshot or in
  screentext are the numbers you send to tap/swipe. Never rescale them yourself.
- Add --screenshot and/or --screentext to every action: they wait until the screen
  is still, then save the image / print the text. No separate screenshot call.
- Before `type`, read a screenshot: the cursor must be in the field you want. Keys go
  to the focused field (in Messages, Enter in To: keeps focus there).
- Leave the iPhone unlocked when done. Locked phones give no screenshots. The daemon
  keeps every unlocked USB- and Bluetooth-connected iPhone awake (a Control key press
  after 10 s idle). Locked or unplugged iPhones get no key, so Auto-Lock works normally.
- A wrong unlock passcode is never retried (failed attempts count toward lockout).
- Account: acquire needs this Mac signed in to ghosthand.dev with a trial or plan.
  login-required: run `ghosthand setup`, tell the user to sign in there, poll
  setup status. subscription-required: show the user the link in the error, acquire
  again after they subscribe; never retry in a loop. Do not run `account login` yourself.
- New account and the user gave no details: get each from `ghosthand random <kind>`
  (name, lastname, username, birthdate, password). Never invent a password. Every
  value is saved: `ghosthand random list` finds one you forgot.
- ghosthand drives the iPhone as a Bluetooth keyboard and mouse, so iOS keyboard
  shortcuts work with `key`: cmd+a then backspace clears a field, alt+backspace,
  cmd+shift+left, cmd+c, cmd+z, fn+h (Home), fn+up (App Switcher), fn+c (Control
  Center), fn+n (notifications). Full list: `ghosthand key --help`.
- Go Home with `key home` (AssistiveTouch button 3; see `key --help` for the one-time
  mapping), not the AssistiveTouch menu.
- Screen shrunk to the bottom half (iOS Reachability), sheets look stale: tap the
  empty top area (`tap 207 100`) to restore it. Check this before anything else.
- Screen dimmed but no dialog in the screenshot: the dialog is hidden from USB capture.
  `screenshot --native` takes a real iOS screenshot (cmd+shift+3) that shows it, at the
  same coordinates tap takes. A button that ignores `tap`: press it once more (tap or
  `hold x y --duration 400`); a just-opened alert can ignore the first press.
- Long press (context menus, Home Screen icon menu, previews): `hold x y`. Move an
  item that needs a long press first (Home Screen icons): `hold-drag --hold 2500`.
- Files, photos, apps, battery and logs go over USB without the screen: file list,
  file pull, file push, photo list, photo pull, app list, info, logs (see each --help).
  To add a photo or video to Photos: `ghosthand upload <file>`, then Safari (`upload --help`).
- Dialog not responding or invisible to capture: try `lock`, then `unlock` once
  to dismiss it without accepting an option (tested on an XR, iOS 18.7).
  First obtain a user-confirmed passcode and pipe it to `unlock --stdin`.
  Without one, ask the user before locking. Check the screen afterward; this may
  not dismiss every dialog. Never retry a failed passcode or guess hidden taps.
- Scroll far with `scroll down <ticks>` (mouse wheel, ~100 pt per tick). `swipe`
  moves content by the drag length (no momentum): use it for pages and short moves.
- Swipe Home Screen pages from empty space or an icon, not from a widget, the dock
  or the AssistiveTouch button.
- Open an app: `key cmd+space`, `type <app name>`, `key enter` (works from any app;
  tested on an SE2, iOS 18.6). Faster than swiping Home Screen pages.
- An iPhone in XCTest mode (`list` shows `xctest`) takes the same commands through
  Apple's UI testing instead of Bluetooth. No lock, unlock, mute or shortcuts there; see
  `control --help`. Switch modes only when the user asks.
- On errors, read the whole message: it says what failed and what to do.
- No iPhone in `list`, or errors about USB, Trust, a never-paired iPhone, or
  Bluetooth that never connects: the user must connect or fix the phone. Run
  `ghosthand setup` once (MCP: use the setup tool). Tell the user to complete setup
  in the small Ghosthand window. All actions in the Ghosthand app window are user-only. Agents must not interact with the window or complete setup for the user. Poll `ghosthand setup status` (MCP: setup-status) every 2 seconds until ready is true. Pass --device (MCP: device) for the intended iPhone if known or if several are connected; use the returned device id on later polls. When ready, acquire that phone using its captureId from overview. Wait while the user completes setup, then continue automatically when ready. Do not reopen setup, request permissions, or retry input while waiting. If setup is still incomplete after 10 minutes, report the current status instead of retrying forever. Do not tap Trust or pair for them. A locked iPhone that is trusted
  and paired is not a setup problem: use `unlock` only with a passcode the user
  confirmed, otherwise ask the user to unlock it. `ghosthand dashboard` is a window to
  watch every iPhone and its agent; open it only if the user asks to see it.
- No clever loops that wait for a text you guess ("Open", "Done"): the next screen
  is hard to predict (App Store "Install" confirm, "requires a newer iOS", alerts).
  Loop only when a skill or document you follow says so. Otherwise: one action,
  read the whole screen, decide the next action.
