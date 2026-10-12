<div align='center' class='hidden'>
    <br/>
    <br/>
    <h3>ghosthand</h3>
    <p>Control real iPhones from a Mac with AI agents</p>
    <br/>
    <br/>
</div>

Control real iPhones from a Mac. **Screenshots over USB, taps over Bluetooth.** No jailbreak, no Xcode, no app on the phone.

**The Mac becomes a Bluetooth mouse and keyboard for the iPhone.** An agent sees the screen, points, clicks, scrolls and types like a person with a desk setup, so it can use **any iOS app**: App Store apps, system apps, Settings, the lock screen.

> [!IMPORTANT]
> **Requires a Mac and a real iPhone.** The CLI runs only on macOS, and the iPhone must be connected over USB and paired over Bluetooth. Linux, Windows and the iOS Simulator are not supported.

```bash
npx ghosthand setup                           # first: sign in, connect and pair the iPhone
npx ghosthand list
npx ghosthand screenshot -o home.png          # 414x896 on an iPhone XR: screen points
npx ghosthand tap 207 448                     # same coordinates as the screenshot
npx ghosthand scroll down 5                   # mouse wheel, ~100 points per tick
npx ghosthand tap --text "Settings"           # OCR finds the text, taps its center
npx ghosthand type "hello" --enter
secret-provider | npx ghosthand type --stdin  # secrets stay out of argv
npx ghosthand key home                        # Home Screen, not Back
npx ghosthand tap 207 448 --screenshot s.png --screentext
npx ghosthand screentext --language it-IT
npx ghosthand record start demo.mov           # screen + sound; keep acting meanwhile
npx ghosthand record stop
```

```diagram
agent / CLI / curl                       Mac                                  iPhone
      │                     ┌───────────────────────┐   USB screen capture
      │  HTTP (unix socket) │                       │<─────────────────── screen frames
      └────────────────────>│   ghosthand daemon    │
                            │  OCR · leases · state │   Bluetooth Classic HID
                            │                       │──────────────────> AssistiveTouch
                            └───────────────────────┘   mouse + keyboard   pointer, keys
```

## Features

- **Any iOS app**: input goes through AssistiveTouch, like a real mouse; no app or test runner on the iPhone
- **Tap, double and triple tap, hold, swipe and hold-drag** with the mouse pointer, at screenshot coordinates or on OCR text (`tap --text`, `hold --text`)
- **Scroll** with the mouse wheel: lists that a drag cannot scroll
- **Fast keyboard input**: `type` sends text as key presses, plus Home, Enter, Esc, arrows and volume keys
- **Screenshots** over USB, PNG or JPEG, about 0.3s each. The capture stops 1s after the last frame, so an idle daemon uses no CPU for it
- **Screen recording with sound**: `record start` / `record stop` write H.264 + AAC; actions and screenshots keep working while it records
- **Screen points by default**: screenshots, OCR boxes and taps share one small coordinate space, sized for LLM vision
- **Screen text** with on-device OCR (Vision), boxes in screenshot coordinates
- **Unlock** a locked iPhone with its passcode, no touch; lock state in `list`
- **Lock** over the Bluetooth keyboard, verified over USB
- **Mute and unmute** all iPhone sound, confirmed from the iPhone log
- **Files, photos and apps over USB**: pull screenshots and photos, push files, list and uninstall apps, read battery, storage and the system log. No Developer Mode
- **Several iPhones at once**, each controlled on its own
- **CLI, remote MCP server and skill** for agents, with the same help text
- **Leases**: one agent per iPhone at a time; others wait or get a clear "leased by" error
- **HTTP API** described by OpenAPI, usable from any language
- **Every Mac of your account** through one MCP URL, or TCP with a bearer token and HTTPS

## Install

Needs **macOS 14 or later** on Apple silicon or Intel. The npm package ships one universal binary; no Node code runs at runtime. The Bluetooth Classic private API is tested on macOS 26.3 only.

```bash
npx ghosthand setup       # run without installing
bunx ghosthand setup      # same, with Bun
npm install -g ghosthand  # install the `ghosthand` command
```

**Start with `ghosthand setup`.** It opens the Ghosthand app and starts the daemon. The app walks you through sign-in, permissions, USB trust and Bluetooth pairing. When the iPhone is ready, `list`, `screenshot`, `tap` and the other commands work.

```diagram
npx ghosthand setup ──> Ghosthand app + daemon ──> sign in, allow access, plug in, pair
                                                        │
ghosthand list / screenshot / tap / type <──────────────┘ iPhone ready
```

**Sign in once per Mac.** Every lease needs a ghosthand.dev account: **7 days free from sign-up, then $99/month**. `ghosthand setup` starts with **Sign in with Google**: it opens the browser, you approve the Mac, and the window continues by itself. Agents never sign in for you; they open setup and wait.

```bash
ghosthand account   # who is signed in, the plan, the subscribe link
ghosthand account login     # for people without the setup window; agents use setup
ghosthand account logout
```

**Permissions are user-controlled.** Run `ghosthand setup`, then click **Allow Camera** and **Allow Bluetooth**. macOS asks for access for Ghosthand, not your terminal or editor. Normal commands never show permission dialogs or open System Settings.

```bash
ghosthand setup  # open the app, then let the user click its permission buttons
```

## Setup (once per iPhone)

**Two manual connection steps: USB trust and Bluetooth pairing.** AssistiveTouch and keep-awake are automatic. Screenshots work after you plug in, trust, and unlock the iPhone.

**Setup starts with sign-in, then permissions.** `ghosthand setup` shows Sign in with Google, then Camera and Bluetooth buttons, before the phone steps (plug in, trust, unlock, pair). Denied access shows an **Open Settings** button instead. It updates by itself and ends with a "Copy prompt for agent" button. It detaches at once, so the terminal stays free.

**Agents wait for the user.** Open setup once and tell the user to complete setup in the small Ghosthand window. All Ghosthand window actions are user-only; agents must not interact with the window or complete setup for the user. Poll `ghosthand setup status` every 2 seconds, then continue automatically when `ready` is `true`. Do not reopen setup, request permissions, or retry input while waiting. If still incomplete after 10 minutes, report the current status. Use `ghosthand setup --permissions` to review access that is already allowed.

```bash
ghosthand setup status                     # JSON, works before permissions or USB trust
ghosthand setup status --device "iPhone XR" # select the intended phone when several exist
```

**Readiness is per phone.** It requires a signed-in Mac, Camera access, USB capture, an unlocked phone and connected Bluetooth. Once a poll selects a phone, use its returned `device` id on later polls. When ready, acquire that phone with its `captureId` from `overview` (the id shown by `list`). The MCP tools are `setup` and `setup-status`; neither status check needs a lease.

### 1. Plug in and trust

Connect the iPhone over USB, unlock it, and tap **Trust**. Then check:

```bash
ghosthand list
```

### 2. Pair the Mac as a mouse and keyboard

Run any input command. The daemon makes the Mac discoverable and prints the steps:

```bash
ghosthand key home
```

On the iPhone, open **Settings > Bluetooth**, tap the Mac's name (for example "MacBook Pro") under Other Devices, then **Pair**.

- The Mac is discoverable only while a command waits for pairing.
- After Pair, the iPhone opens the connection itself. The command continues by itself.
- Later runs reconnect the paired iPhone from the Mac in about 2 s.
- **After a report map change**, forget the Mac on the iPhone and pair again: the iPhone keeps the map it read at pairing.
- **Pairing fails, or the Mac is gone from the list:** forget on both sides, then pair again. See [Pairing no longer works](#pairing-no-longer-works-forget-on-both-sides).

### 3. AssistiveTouch (automatic)

iOS accepts a mouse only through AssistiveTouch. With it off, the iPhone shows no pointer and ignores every click (tested). **`acquire` turns it on over USB and `release` turns it off again**, so a personal iPhone goes back to normal when the agent is done. No touch on the phone is needed, and it works while locked:

```bash
ghosthand acquire --reason "reply to Anna"  # AssistiveTouch on
ghosthand release -l 42                     # lease released; AssistiveTouch turned off
ghosthand release -l 42 --keep-assistivetouch  # lease released; AssistiveTouch stays on
```

- **Always off after the lease.** `release` turns it off also when it was on before `acquire`. Pass `--keep-assistivetouch` (HTTP: `?keepAssistiveTouch=true`) to leave it on.
- **Expired leases too.** A lease that ends by its idle timeout gets AssistiveTouch turned off a few seconds later.
- **Tap, swipe and wake check again** (in case a person turned it off mid-task).

The state is kept in `state.db` (`phone.assistive_touch_off_after_lease`).

The check is a USB lockdown read of `com.apple.Accessibility` / `AssistiveTouchEnabledByiTunes`, about 35 ms (a write is about 40 ms).

**Hide the floating button (recommended).** Open **Settings > Accessibility > Touch > AssistiveTouch** and turn **Always Show Menu** OFF (Italian: "Mostra sempre menu"). AssistiveTouch stays on and the pointer still works, but the round menu button no longer covers the screen. With it on, it sits over buttons (it covered the Messages send arrow in tests) and fades in and out, which is noise in screenshots and [recordings](#record-the-screen). `key home` does not need the menu (see below):

```diagram
Always Show Menu ON   ──> round button on screen ──> in screenshots and videos
Always Show Menu OFF  ──> hidden while the Mac mouse is connected; taps still work
```

- **Set it on the iPhone, once.** USB lockdown has only the AssistiveTouch on/off key (`AssistiveTouchEnabledByiTunes`), no key for this switch, so ghosthand cannot change it over USB. An agent can flip it with taps in Settings (tested on an XR, iOS 18.7).
- **It stays off** when `acquire` and `release` turn AssistiveTouch on and off.

**Map mouse button 3 to Home, once.** `key home` clicks mouse button 3, which AssistiveTouch turns into its Home action (the same mapping TapKit uses). Open **Settings > Accessibility > Touch > AssistiveTouch > Devices > (this Mac) > Customise Additional Buttons**, run `ghosthand key home` while it says "Press a button", then pick **Home** (tested on an SE2, iOS 18.6.2). Unmapped, `key home` does nothing; `key fn+h` and `key menu` (HID consumer Menu, tested on iOS 15.8) are the keyboard Home keys.

```bash
ghosthand key home  # Home Screen via AssistiveTouch button 3
```

### 4. Keep awake (automatic)

**No need to change Auto-Lock.** The daemon keeps every unlocked iPhone connected over both USB and Bluetooth awake, leased or not, so it is always ready for the next command:

```diagram
daemon, every 2 s ──> unlocked and idle for 10 s? ──yes──> Left Control press (Bluetooth)
                            │                                    │
                            └─ locked or command running: skip   └─> iOS resets the Auto-Lock timer
```

- **No visible effect.** A lone Control key types nothing and shows no pointer, so screenshots stay clean. It works with AssistiveTouch off.
- **Never between input.** A tap or typed text holds the Bluetooth link; the key waits for it.
- **Locked iPhones are skipped.** The lock state comes from USB lockdown. A key would light the Lock Screen (seen on iOS 18), so a locked iPhone gets no key and its display turns off normally.
- **To let the iPhone lock by itself**, unplug USB or stop the daemon (`ghosthand daemon stop`). Keep-awake stops on the next check (every 2 seconds).

Tested on an iPhone XR, iOS 18.7, Auto-Lock 30 seconds: without the key SpringBoard dims at 20 s; with it, no dim for 75 s, with and without AssistiveTouch.

## Use it with an agent

**Install the skill** so your agent knows the commands, the lease rules and the feedback loop:

```bash
npx -y skills add https://ghosthand.dev -g -y
```

This works with Claude Code, Cursor, OpenCode, Codex and other agents that read [skills](https://skills.sh). The skill tells the agent to read `ghosthand --help` first; the help text is the full agent manual.

**Agent without a shell?** Add `https://ghosthand.dev/mcp` as a remote [MCP server](#mcp-server): the same commands as tools.

**Then ask in plain words**, with the iPhone plugged in and unlocked:

```text
Use ghosthand to open Messages on my iPhone and reply "on my way" to Anna.
```

The agent takes a lease, works in a loop (read the screen, act, read the result), and releases the phone when it is done:

```bash
ghosthand screentext
ghosthand tap --text "Anna" --screenshot s.png --screentext
ghosthand type "on my way" --enter --screentext
```

See [Agent feedback loop](#agent-feedback-loop) for the rules the agent follows.

**Double tap** selects words and zooms content in apps that support it. It sends two
mouse clicks at one position, not a VoiceOver gesture or a side-button confirmation.
Each press lasts 110...130 ms; the release-to-press gap is 100...150 ms. Single taps
use the same press duration. [Apple's text-selection guide](https://support.apple.com/guide/iphone/select-cut-copy-and-paste-text-iph1a9cae52c/ios)
describes double-tap word selection.

```bash
ghosthand double-tap -l 42 120 300 --screenshot after.png
ghosthand double-tap -l 42 --text "example" --screentext
```

The same action is the MCP tool `double-tap` and HTTP route
`POST /v1/leases/{lease}/double-tap`, with the same arguments as `tap`. `triple-tap`
sends three clicks with the same timing, to select a paragraph.

**Hold** is a long press: the button goes down, stays still for `--duration` (default
1000 ms), then goes up. It opens context menus, Home Screen icon menus and previews.
No reports are sent while held: iOS reads repeated reports as movement, and a Home
Screen long press then turns into edit mode.

```bash
ghosthand hold -l 42 144 324 --screentext          # Notes icon: its menu with Remove App
ghosthand hold -l 42 --text "Safari" --duration 1500
ghosthand key -l 42 esc                             # close the menu
```

**Hold-drag** presses, stays still for `--hold` (default 1000 ms), then drags to the
target over `--duration` (default 1000 ms) and releases. A plain `swipe` moves at once,
so items that need a long press first stay in place.

```bash
ghosthand hold-drag -l 42 144 324 57 412 --hold 2500   # move a Home Screen icon
ghosthand key -l 42 home                                # leave edit mode
```

> [!IMPORTANT]
> **Home Screen icons need `--hold 2500`** from the normal Home Screen: iOS enters edit mode while held, then the icon follows. Start on the icon, not on the AssistiveTouch button. Tested on an SE2, iOS 18.6, Perform Touch Gestures on.

The MCP tools are `triple-tap`, `hold` (`durationMs`) and `hold-drag` (`holdMs`,
`durationMs`); the HTTP routes are `POST /v1/leases/{lease}/triple-tap`, `/hold` and `/hold-drag`.

## Control plane: watch your agents

**Many agents, many iPhones?** `ghosthand dashboard` opens a window that shows what each one is doing:

```diagram
┌ iPhones on USB ──────┐┌ Morse’s iPhone   iPhone XR · iOS 18.7                     ● In use ┐
│ ● Morse’s iPhone   1 ││ ┌──────────┐   Agent         ses_f089c49bfffe                      │
│   reply to Anna      ││ │  live    │   Task          reply to Anna in Messages             │
│ ● Test iPhone        ││ │  screen  │   Last command  tap · 4s ago                          │
│ ● iPhone 15          ││ │  (2 s)   │   Waiting       ses_f08a12c3 · install Reddit         │
│ + Set Up iPhone…     ││ └──────────┘   Connection · Device ids                             │
└──────────────────────┘└────────────────────────────────────────────────────────────────────┘
```

- **Sidebar:** each iPhone with a status dot: blue in use, green free, orange locked, yellow connecting, red needs setup. A badge counts agents waiting for it.
- **Lease:** agent label, task, lease age, last command, idle timeout, and agents running `ghosthand wait`.
- **Screen:** small and read-only, refreshed every 2 s. It needs no lease and does not reset the agent's idle timer.
- **Connection and ids:** USB, Bluetooth, pointer mode, AssistiveTouch, and the device id to copy for `acquire -d`.

`dashboard` and `setup` share one process; running either again brings its window to the front. Both read `GET /v1/phones` (see [HTTP API](#http-api)).

## Agent feedback loop

**Each tool call is the slow part**, not the phone. So an action returns the new screen in the same call: `--screenshot` saves it, `--screentext` prints its text. One call per step instead of three.

```diagram
      ┌─────────────────────────────────────────────────────────────────┐
      v                                                                 │
 1. see the screen           screentext (text + boxes, no image)        │
                             or screenshot -o s.png (~500 tokens)       │
 2. act, and see the result  tap / swipe / key / type                   │
                             + --screenshot s.png --screentext          │
 3. read the printed text, and s.png if the text is not enough          │
 4. decide the next action toward the user's task  ─────────────────────┘
```

```bash
export GHOSTHAND_LANGUAGE=it-IT                        # phone language for OCR, same as --language
ghosthand list
ghosthand screentext
ghosthand tap --text "Tommaso De Rossi" --screenshot s.png --screentext
ghosthand tap 200 610 --screenshot s.png --screentext  # x,y read from s.png
ghosthand type "ciao" --enter --screentext
```

**Set the OCR language once** for a non-English phone: `GHOSTHAND_LANGUAGE=it-IT` (a BCP 47 tag) applies to `screentext`, `--screentext` and `tap --text`. `--language` overrides it. English is always included. Without it, accents and local words are misread.

- **Text first, image when needed.** `--screentext` output is cheap and often enough to decide (a new title, a sent message). Read `s.png` for icons, layout, or text OCR misses.
- **Both flags use one frame:** the daemon runs them after the input, under the same lease, and waits for a still screen (up to 2 s after frames start). OCR reads the native frame (small text reads better); the image is resized from that same frame. A blank or unchanged image is not proof that input failed.
- **Check focus before you type.** `type` sends keys to the field that has focus, and you cannot see which one from the command. Read a screenshot first: the cursor must be in the field you want. In Messages, Enter in the **To:** field adds the recipient but keeps focus there, so `type "ciao" --enter` put "ciao" into To: (tested on iOS 18.7). Tap the message field, check the screenshot, then type.

  ```bash
  ghosthand type "3336052139" --enter         # To: field, adds the recipient
  ghosthand tap 200 562 --screenshot s.png    # check focus in the image
  ghosthand type "ciao" --enter --screentext  # Enter sends
  ```

- **Tap text, not pixels:** `tap --text "..."` saves a screenshot read and coordinate guessing. On the Home Screen, app **labels do not open apps** (tested on iOS 15): tap the icon, about 40 points above the label.
- **No clever loops.** Do not script loops that wait for a text you guess ("Open", "Done"). The next screen is hard to predict: iOS shows sheets and alerts at any time (the App Store asks to confirm **Install**, then can say "requires iOS 16 or later"), and a loop that waits for one word waits forever (this happened while installing Reddit on the 6s). Use a loop only when a skill or document you follow asks for it explicitly. Otherwise use the plain feedback loop: one action, read the whole screen, decide the next action.
- **Failed capture after an action:** the error says **Input sent**. Do not repeat the action blindly; take a screenshot first.
- **No frames:** `screenshot` and `screentext` reject a locked iPhone quickly. If `list` reports unlocked but capture still gets no frame, see [USB screen capture stops](#usb-screen-capture-stops-ios-bug-restart-the-daemon-then-the-iphone).

**Screen shrunk to the bottom half? That is iOS Reachability, not a hidden dialog.** The app and its sheets slide down, the top half is empty, and a sheet can look stale or dimmed. A tap in the empty top area restores it (tested on an XR, iOS 18.7: `tap 207 100`). Check for it first when a screen looks wrong. A stale screen can also come from a secure field: tap outside it and read again.

```bash
ghosthand tap 207 100 --screenshot s.png --screentext   # empty top area: full screen returns
```

**Some iOS dialogs are invisible to USB capture and OCR** (tested on an XR, iOS 18.7: the App Store location prompt, the Install sheet, the cellular-data prompt). The page behind looks dimmed or unchanged, and `screentext` shows no dialog. Take a `screenshot`, read the image, and tap by position. Enter, Esc, Space, Tab and a center tap did not dismiss the location prompt: a person had to tap **Don't Allow**. Apple documents Tab and Space for [Full Keyboard Access](https://support.apple.com/en-euro/guide/iphone/ipha4375873f/ios), but that setting is off by default.

**Screen dimmed but no dialog in the screenshot? Take a native screenshot.** USB capture leaves out some system dialogs (seen on an SE2, iOS 18.6: the Instagram location prompt). An iOS screenshot, taken with the Bluetooth keyboard shortcut, includes them. `screenshot --native` does it in one command, in about 2 s: it presses cmd+shift+3, reads the new PNG over USB, scales it to screen points (the numbers `tap` takes), then deletes it from Photos.

```bash
ghosthand screenshot -l 42 --native -o real.png            # read real.png: the dialog is there
ghosthand tap -l 42 120 401 --screenshot s.png              # tap the button you read
ghosthand hold -l 42 120 401 --duration 400                 # button ignored the tap? press it once more
```

The same steps by hand, for when you want the file:

```bash
ghosthand key -l 42 cmd+shift+3                             # iOS saves a real screenshot
ghosthand photo pull -l 42 -o .                             # newest Camera Roll file, e.g. ./IMG_0004.PNG
ghosthand photo delete -l 42 IMG_0004.PNG                   # remove it from Photos again
```

- The native PNG is in native pixels (750x1334 on an SE2). `screenshot --native` scales it for you. With the manual steps, pass its numbers with `tap --scale 1` (native pixels). See [Coordinates](#coordinates-screen-points).
- **Deleting needs the optional Photos access** on the Mac: run `ghosthand setup --permissions` once and click **Allow Photos** with the iPhone plugged in and unlocked (macOS asks about removable volumes). Without it the screenshot stays in Photos and the output says which file to delete.
- **A just-opened alert can ignore the first press.** On an SE2 (iOS 18.6, Perform Touch Gestures on), the Remove "Notes"? alert ignored the first press on Cancel in 8 of 8 trials and took the second, with tap, `hold --duration 400` or a stationary swipe alike. Earlier reports that a 400 ms press works where a tap fails (location prompt, Photos Delete Photo sheet) were second presses too. Read the screen, then press once more.

**Dialog does not respond, or is invisible to capture? Try `lock`, then `unlock`** to dismiss it without accepting an option. This cleared a Maps prompt on an XR, iOS 18.7; it is not guaranteed for every dialog. First obtain a user-confirmed passcode from the secret provider. Without one, ask the user before locking. Try once, then check the screen; never retry a failed passcode.

```bash
ghosthand lock -l 42
secret-provider | ghosthand unlock -l 42 --stdin --screenshot s.png --screentext
```

**Secure password fields freeze frames** for 10 to 30 seconds. Wait; do not type again.

> [!IMPORTANT]
> **Leave the iPhone unlocked.** Do not run `ghosthand lock` at the end of a task. Locking stops USB screen capture and makes the next action less reliable. Use `unlock` only when `list` shows `[locked]`.

## CLI

> [!NOTE]
> **Every command except `list` needs a lease**, so two agents never use the same iPhone at once. `ghosthand acquire --reason "<task>"` prints an id like `42`; pass `-l 42` to every command and run `ghosthand release -l 42` at the end. The examples in this README leave out `-l` to stay short. See [Leases](#leases-one-agent-per-iphone).

**Grouped commands use a subcommand**: `file`, `photo`, `app`, `record`, `setup`, `account`, `daemon` (`ghosthand file push`, `ghosthand record stop`). `setup` and `account` also run alone. MCP tool names join the words with `-` (`file-push`).

| Command                                                             | Does                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `list`                                                              | iPhones on USB, `[locked]`, their Bluetooth link state, and who leases them                                        |
| `acquire --reason task [--force] [--idle-timeout s] [--label text]` | take the iPhone for a task; prints the lease id                                                                    |
| `wait --reason task [--timeout s]`                                  | wait until another lease ends, then acquire; prints the lease id                                                   |
| `release`                                                           | end the lease; turns AssistiveTouch off if `acquire` turned it on                                                  |
| `screenshot [-o file.png\|.jpg] [--settle] [--native]`              | save the screen; `--settle` waits until it stops changing; `--native` shows dialogs USB capture hides              |
| `screentext [--language it-IT] [--json]`                            | OCR of the screen: `x,y wxh text` per line. English is always included                                             |
| `tap <x> <y>`                                                       | tap at screenshot coordinates                                                                                      |
| `tap --text <text> [--index n]`                                     | tap the center of an OCR text line (exact line wins, else contains)                                                |
| `double-tap <x> <y>`, `triple-tap <x> <y>`                          | two or three clicks at one point: select a word or a paragraph                                                     |
| `hold <x> <y> [--duration ms]`                                      | long press (context menus, Home Screen icon menu); also `--text`                                                   |
| `swipe <x1> <y1> <x2> <y2> [--duration ms]`                         | drag with the button held; content moves by the drag length (no momentum)                                          |
| `hold-drag <x1> <y1> <x2> <y2> [--hold ms] [--duration ms]`         | long press, then drag while held: move Home Screen icons                                                           |
| `scroll <up\|down> <ticks> [--at x,y]`                              | mouse wheel scroll, \~100 points per tick; scrolls lists that `swipe` cannot. See [docs/scroll.md](docs/scroll.md) |
| `key <combo>`                                                       | `home`, `enter`, `esc`, `backspace`, arrows, `pageup`, `pagedown`, `end`, `volumeup`                               |
| `mute` / `unmute`                                                   | silence all iPhone sound, or turn it back on; confirmed from the iPhone log                                        |
| `type <text> \| type --stdin [--enter]`                             | validated US-ASCII text; stdin keeps secrets out of arguments                                                      |
| `wake`                                                              | turn the display on and check that USB frames arrive                                                               |
| `unlock --stdin`                                                    | wake and unlock (or `GHOSTHAND_PASSCODE`); no screenshot while locked                                              |
| `record start <file.mov\|.mp4> [--fps n] [--max-duration s]`        | record screen and sound to a file; stops by itself after 5 min. See [Record the screen](#record-the-screen)      |
| `record stop`                                                       | stop the recording; prints duration, size and fps                                                                  |
| `assistivetouch [on\|off]`                                          | show or set AssistiveTouch over USB; `acquire` turns it on by itself                                               |
| `lock`                                                              | lock over Bluetooth with Control-Command-Q                                                                         |
| `rename <name>`                                                     | set the iPhone's name over USB; the id does not change                                                             |
| `forget`                                                            | remove the Mac's Bluetooth bond with the iPhone, to pair again                                                     |
| `random <name\|lastname\|username\|birthdate\|password>`            | random account detail, saved in state.db with the lease's task and iPhone; `random list` shows them all            |
| `file list <path> [--app id]`                                       | list a folder over USB: `/DCIM`, `/Downloads`, or an app's `/Documents`. See [Files](#files-photos-and-apps-over-usb) |
| `file pull <iphone path> [local]` / `file push <local> <iphone path>` | copy a file or folder from or to the iPhone over USB; `--app id` for an app's Documents                           |
| `file remove <iphone path>`                                         | remove a file or folder over USB; refuses `/DCIM`                                                                  |
| `photo list` / `photo pull [--last n]`                              | newest Camera Roll files, or copy them to this Mac                                                                 |
| `photo delete <name...>`                                            | delete photos so Photos forgets them too (ImageCaptureCore); needs Allow Photos                                   |
| `app list` / `app install <file.ipa>` / `app uninstall <id>`        | installed apps with their Home Screen page; install a signed IPA; uninstall                                        |
| `info`                                                              | battery, storage, iOS build, serial, language, time zone; works while locked                                       |
| `logs [--process p] [--grep text] [--seconds n]`                    | iPhone system log over USB, from now on                                                                            |
| `restart` / `shutdown`                                              | restart or turn off over USB; ask the user first                                                                   |
| `setup`                                                             | window for people: connect a new iPhone step by step                                                               |
| `setup status`                                                      | setup readiness as JSON: missing permissions, disconnected phones                                                  |
| `dashboard`                                                         | window for people: every iPhone, its agent, task, last command and live screen                                     |
| `account` / `account login` / `account logout`                      | this Mac's ghosthand.dev account and plan                                                                          |
| `daemon start\|stop\|restart\|status\|run`                          | manage the background daemon                                                                                       |

The daemon starts by itself on the first command. After a rebuild, the CLI restarts it.

### Secret text from stdin

**Pipe secrets directly** after checking focus. The CLI validates all input before any key is sent, and does not echo rejected characters.

```bash
secret-provider | ghosthand type --stdin
```

One final **LF or CRLF** is removed. Other whitespace is preserved. LF sends Enter and tab moves focus. `--keep-final-newline` preserves LF; `--enter` adds one more Enter. Unsupported controls, invalid UTF-8 and non-ASCII fail before input.

### Keyboard shortcuts

**The Mac is a real keyboard and mouse** for the iPhone, so iOS keyboard shortcuts work with `key`. To replace the text in a field, select all and delete it:

```bash
ghosthand key -l 42 cmd+a
ghosthand key -l 42 backspace
```

**Modifiers:** `cmd`, `shift`, `alt` (option), `ctrl`, `fn` (Globe). `fn` is sent as the standard Globe key of non-Apple keyboards (Consumer AC Keyboard Layout Select, `0x29D`); `key fn` alone is a Globe tap. Keys in a combo go down in order, so `tab+h` holds Tab, then presses H.

| Combo | Action |
| ----- | ------ |
| `cmd+a` | select all |
| `alt+backspace` | delete the previous word |
| `cmd+backspace` | delete to start of line |
| `shift+left` | extend the selection by one letter |
| `cmd+left` / `cmd+right` | go to start / end of line |
| `cmd+shift+left` / `right` | select to start / end of line |
| `cmd+up` / `cmd+down` | go to start / end of the text |
| `cmd+shift+up` / `down` | select to start / end of the text |
| `cmd+c`, `cmd+v`, `cmd+z` | copy, paste, undo |
| `tab` / `shift+tab` | next / previous field or focused item |
| `space` | activate the focused item |
| `esc` | dismiss menus, suggestions, some dialogs |
| `cmd+l`, `cmd+f`, `cmd+r` | Safari: address bar, find on page, reload |
| `fn+h` | Home Screen |
| `fn+up` | App Switcher |
| `fn+c`, `fn+n` | Control Center, Notification Center |
| `tab+h` | show all commands (only with **Full Keyboard Access** on) |

Tested on an iPhone SE 2, iOS 18.6: `fn+h`, `fn+up`, `fn+c`, `fn+n` work with Full Keyboard Access off. `tab+h` shows the command list in every app (Safari, Messages, Settings, Home Screen) only after Settings > Accessibility > Keyboards & Typing > Full Keyboard Access is on. Other combos are iPadOS shortcuts; read the screen after each one.

**iPhones paired before the `fn` fix:** forget the Mac on the iPhone and pair again. The old report map dropped the Globe usage (logical max `0xB0` was read as -80). The same pairing also adds `scroll left|right`.

### Full Keyboard Access (optional)

**Full Keyboard Access** is an iOS accessibility setting that controls the whole iPhone from a keyboard, with a blue focus box instead of touch. The user turns it on in Settings > Accessibility > Keyboards & Typing > Full Keyboard Access. It is off by default and ghosthand does not need it. Ask the user before turning it on: it changes the iPhone for them too.

| Combo | Action | Tested |
| ----- | ------ | ------ |
| `tab` / `shift+tab` | move focus to the next / previous group | yes (the first Tab focuses the AssistiveTouch button) |
| arrows | move focus inside a group (list rows); in a text field they move the cursor | yes |
| `space` | activate the focused item | yes |
| `esc`, `tab+b` | go back | yes |
| `tab+f` | **find**: type an item's name, Enter activates it | yes in Settings; no result on the Home Screen |
| `tab+h` | show all commands | yes |
| `tab+m` | contextual menu (long press) | no |
| `tab+z` | actions of the focused item (e.g. delete a row) | no |
| `tab+l` | lock screen | no |
| `tab+r` | rotate device | no |
| `tab+g` | keyboard gestures (touch, swipes, zoom, two-finger gestures) | no |
| `tab+x` | Accessibility Shortcut | no |
| `fn+s` | Siri | no |
| `ctrl+tab` / `ctrl+shift+tab` | next / previous item | no |

The full list, with custom keys, is in Settings > Full Keyboard Access > Commands.

**Limits seen in tests (iPhone SE 2, iOS 18.6):**

- **Focus box in screenshots.** It is blue and can frame the whole screen. Set Auto-Hide to hide it after idle time.
- **A command can do nothing.** The first `tab+f` and the first `tab+b` did nothing; the second worked. Check the screen after each key.
- **Dangerous chords.** With it on, `ctrl+alt+shift+cmd+s` calls Emergency SOS and `ctrl+alt+shift+cmd+r` restarts the iPhone. Never send them.

### Mute

**`mute` sets a state; it does not toggle.** It is safe to run twice.

```bash
ghosthand mute  # muted iPhone XR Tommy
ghosthand unmute
```

The keyboard Mute key (consumer `0xE2`) toggles iOS **full mute**: all output, media in every app too. The ringer switch does not silence app media. iOS has no mute state readable over USB lockdown, so the daemon reads SpringBoard's log line after each press:

```diagram
Mac ──BT Mute key──> SpringBoard ──FullMute──> audiomxd
 ^                       │
 └──USB syslog_relay─────┘  "Updated fullyMuted to true"
```

If the phone was already in the asked state, the first press toggles it away and a second press toggles it back (about 50 ms of sound). No log line in 3 s fails with `mute-unconfirmed` and no second press. Tested on an XR, iOS 18.7. Full mute stays on when screen capture starts or stops.

### Record the screen

**Record while an agent works.** The recording uses the same USB capture as screenshots, so input and screenshots keep working while it runs.

```bash
ghosthand record start demo.mov --fps 30   # returns at once
ghosthand tap --text "Settings"
ghosthand record stop
# /Users/me/demo.mov  12.4s  2.1 MB  828x1792  30 fps  sound  stopped by request
```

```
iPhone ──USB──> capture session ──┬──> latest frame ──> screenshot, screentext, tap --text
                                  └──> fps cap ──> AVAssetWriter (H.264 + AAC) ──> demo.mov
                 sound output ────────────────────────────┘  (added only while recording)
```

| Rule | Detail |
| ---- | ------ |
| **Auto stop** | after `--max-duration` (default 300 s, max 3600), when the lease ends, or when the daemon stops. The file is complete in each case |
| **Size** | measured on an XR: 3-5 MB per minute on a still screen, at most about 17 MB per minute while it moves |
| **Path** | a new `.mov` or `.mp4` on the daemon's Mac; it never overwrites a file |
| **Sound** | the iPhone's sound output; `--no-audio` leaves it out. With sound, start and stop pause media that plays on the iPhone: start the recording first, then press play |
| **Clean video** | turn **Always Show Menu** off in Settings > Accessibility > Touch > AssistiveTouch, or the round AssistiveTouch button is in the video. See [AssistiveTouch](#3-assistivetouch-automatic). The mouse pointer dot is still drawn by iOS and stays in the video |

### Bounded text verification

**Send once, then check OCR.** `tap`, `swipe`, `scroll`, `key`, `type` and `wake` accept an expected case-insensitive text substring:

```bash
ghosthand tap --text "General" --wait-text "About" --timeout-ms 5000
```

The deadline starts **after input completes**, not during Bluetooth pairing. Default: 5000 ms; range: 1...60000 ms. The daemon runs the check on the native frame, and a frame read never waits past the deadline. A timeout says input was sent and reports completed OCR reads, including unchanged text. It never repeats input. OCR cannot prove that input caused a matching screen, especially if that text was already present.

Verification failure stops the command before optional screenshot/OCR output. Read the screen separately before deciding whether another action is safe. Locked-phone, Bluetooth and USB errors retain their own evidence; missing frames alone cannot identify their cause. Never lock a phone to repair capture.

**Environment variables** set a default for every command; a flag overrides them:

| Variable             | Same as                                                          | Example                                            |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `GHOSTHAND_LANGUAGE` | `--language` (OCR in `screentext`, `--screentext`, `tap --text`) | `it-IT`                                            |
| `GHOSTHAND_SCALE`    | `--scale` (image and coordinate size)                            | `1` for native pixels                              |
| `GHOSTHAND_PASSCODE` | passcode for `unlock`                                            | user-confirmed secret; prefer `unlock --stdin`     |
| `GHOSTHAND_LEASE`    | `-l, --lease` (every device command)                             | supported, but agents must pass `-l 42` explicitly |

## Files, photos and apps over USB

**No screen needed.** These commands use iOS services a trusted Mac can reach over the cable (the ones Finder uses). No Developer Mode, no app on the iPhone. They work while the iPhone is locked, except photo deletes and native screenshots.

```bash
ghosthand photo pull -l 42 --last 3 -o ./photos      # newest Camera Roll files to this Mac
ghosthand file push -l 42 report.pdf /Downloads/report.pdf
ghosthand app list -l 42                             # bundle ids, versions, Home Screen page
ghosthand info -l 42                                 # battery, storage, iOS build, time zone
ghosthand logs -l 42 --process appstored --seconds 10
```

```
                         ┌── com.apple.afc ─────────────> /var/mobile/Media (DCIM, Downloads)
ghosthand ──USB lockdown─┼── house_arrest ──────────────> an app's Documents (file sharing apps)
 (MobileDevice.framework)├── installation_proxy ────────> app list, install, uninstall
                         ├── springboardservices ───────> Home Screen page of each app
                         ├── diagnostics_relay ─────────> restart, shutdown
                         └── syslog_relay ──────────────> system log
ImageCaptureCore (like Image Capture.app) ──────────────> delete photos so Photos forgets them
```

### Get photos and files from the iPhone

**Photos, videos and screenshots are files under `/DCIM`.** `photo list` shows the newest first; `photo pull` copies them; `file pull` copies any path, and a folder comes as a folder.

```bash
ghosthand photo list -l 42 --limit 5
# 845 KB    2026-10-10 10:52  /DCIM/100APPLE/IMG_0008.PNG
ghosthand file pull -l 42 /DCIM/100APPLE/IMG_0008.PNG shot.png
ghosthand file pull -l 42 /DCIM/100APPLE ./camera-roll   # whole folder
```

| Path | What is there |
| --- | --- |
| `/DCIM/100APPLE/IMG_0001.PNG` | Camera Roll. Screenshots are PNG, camera photos HEIC or JPG, videos MOV |
| `/Downloads` | iOS download databases. Not the Files app's Downloads |
| `/Books`, `/PublicStaging`, `/iTunes_Control` | Books, app install staging, media sync |
| `--app <bundle id>` + `/Documents/...` | an app's Documents, only for apps with **file sharing** (`[file sharing]` in `app list`) |

**The Files app ("On My iPhone") and other app data are not reachable** over USB without Developer Mode. With iCloud Photos and "Optimize iPhone Storage", older originals may not be on the iPhone.

### Send files to the iPhone

```bash
ghosthand file push -l 42 report.pdf /Downloads/report.pdf
ghosthand file push -l 42 movie.mp4 /Documents/movie.mp4 --app org.videolan.vlc-ios
ghosthand file remove -l 42 /Downloads/report.pdf
```

**A pushed file is not in any app** unless it goes to an app with file sharing (`--app`). Then it shows in that app, and in Files > On My iPhone > that app when the app supports it.

### Send media for uploads in apps

**Apps like TikTok and Instagram upload only from Photos**, and a file copied to `/DCIM` is not imported. **`ghosthand upload`** puts the file on ghosthand.dev and prints a short link to a page with a **Save** button. Safari's share sheet then offers **Save Video** (or **Save Image**):

```bash
ghosthand upload clip.mp4          # https://ghosthand.dev/u/3fK9xQ2mZr7T, expires in 1 day
ghosthand key -l 42 cmd+space      # open Safari, then cmd+l, type the link, enter
ghosthand tap -l 42 --text Save    # wait until the button says Save, not Loading...
ghosthand tap -l 42 --text "Save Video"
```

- **Needs the account** (signed in, trial or plan). No lease: the upload does not touch the iPhone.
- **At most 100 MB.** Anyone with the link can download the file for 1 day.
- **Offline or bigger:** `file push` into VLC, then Files > Share > Save Video.

Full steps and why there is no USB-only path: [docs/send-media.md](docs/send-media.md), also at https://ghosthand.dev/docs/send-media.

### Delete photos

```bash
ghosthand photo delete -l 42 IMG_0008.PNG
```

**Never remove `/DCIM` files with `file remove`**: Photos keeps a broken entry (tested on an SE2, iOS 18.6), so `file remove` refuses `/DCIM`. `photo delete` uses ImageCaptureCore, like Image Capture.app, and Photos forgets the photo too. It is permanent: it skips Recently Deleted, and with iCloud Photos the delete syncs. It needs the iPhone unlocked and the optional **Allow Photos** access from `ghosthand setup --permissions`.

### Apps

```bash
ghosthand app list -l 42
# com.burbn.instagram  Instagram 450.1.0  (page 2)
# com.example.beta  Beta 1.2  [installing]  (App Library only)
ghosthand app install -l 42 MyApp.ipa         # signed for this iPhone: ad hoc, enterprise, development
ghosthand app uninstall -l 42 com.example.app
```

- **Home Screen place**: `dock`, `page N`, or `page N, folder <name>`. Swipe to that page, then tap the icon.
- **`[installing]`** is an App Store download that is not done. Trust it over the App Store button label, which can show Resume while it downloads.
- **Opening an app over USB needs Developer Mode**, so ghosthand taps its icon instead.
- **App Store apps install from the App Store app.** `app install` takes only IPAs signed for this iPhone.

### Device info, logs, restart

```bash
ghosthand info -l 42
# battery: 100%, on power
# storage: 51.0 GB free of 57.4 GB
ghosthand logs -l 42 --process SpringBoard --grep fullyMuted --seconds 5
ghosthand restart -l 42      # ask the user first
```

**The system log has no history over USB**: lines start when `logs` starts, so run it while the thing you watch happens. **After `restart` a person must type the passcode once**: until then iOS ignores the Bluetooth keyboard. `shutdown` needs a person to press the side button.

## Leases: one agent per iPhone

**Every command that uses an iPhone needs a lease.** Two agents on one Mac can no longer tap the same phone at the same time. `list` needs none.

```bash
ghosthand acquire -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F --label ses_123 --reason "reply to Anna"  # prints 42
ghosthand tap -l 42 207 448    # runs on the lease's iPhone; no -d
ghosthand release -l 42
```

```diagram
agent A: acquire ──> lease 42 ──> tap -l 42, type -l 42 ────────> release -l 42
agent B:       acquire ──> error: in use by "ses_123" for "reply to Anna":
                           acquired 2m3s ago, last command 4s ago, ends after 9m56s idle
agent B:       decides: give up / tell the user, or
               wait --reason "..." --timeout 600 ─────── waits ──────> lease 43
```

- **Always pass `--reason`** with the task. A busy `acquire` fails at once and shows the label, its reason, when it was acquired and its last command, so the next agent can decide to give up instead of waiting.
- **`wait`** is a separate command on purpose: an agent must read who holds the phone before it waits. It retries every second (no queue order). On timeout it shows the current label and reason.

- **Idle timeout:** a lease ends 10 minutes after its last command (`--idle-timeout`), so a crashed agent never blocks the phone.
- **`--force`** takes it from a lease whose holder is gone; that holder's next command fails with `lease-invalid`.
- **After `wait` or `--force`, take a screenshot first.** Someone else used the phone.
- **Pass the ID explicitly with `-l`.** Tool-call environments may not persist; do not rely on exporting `GHOSTHAND_LEASE`.
- **IDs increase in SQLite** and are not reused after expiry, force, release or a daemon restart. Do not delete or restore `state.db`.
- **`--label` is only display text**, e.g. your agent session id, so others can find who holds the phone. It is not checked, not unique, and an acquire with the same label does not resume an active lease.
- **Lease numbers are coordination IDs, not authentication.** TCP access still requires the daemon bearer token. Anyone with daemon access can acquire or force leases.
- Leases live in the `lease` table of `state.db`, so they survive a daemon restart (a rebuild restarts it).

## Coordinates: screen points

**Screenshots, `screentext` boxes, `tap` and `swipe` use one space: iOS screen points.** A point is 2 native pixels on @2x iPhones and 3 on @3x ones, so an iPhone XR (828x1792) gives a 414x896 image. Plus models are the exception: they render at 1080 px for 414 points, and ghosthand knows the native size of each iPhone screen. Read a spot in the image, send the same numbers.

| iPhone       | Native pixels | Default (points) | Claude tokens | GPT tokens (32 px patches x1.2) |
| ------------ | ------------- | ---------------- | ------------- | ------------------------------- |
| 6s (@2x)     | 750x1334      | 375x667          | 336           | 303                             |
| XR (@2x)     | 828x1792      | 414x896          | 480           | 437                             |
| 14 Pro (@3x) | 1179x2556     | 393x852          | 465           | 422                             |

**Why points:** UI text stays readable (17 pt body text is 17 px). A screenshot costs about a quarter of the native tokens on @2x iPhones and an eighth on @3x. It also stays under every model's resize limit, so the model sees exactly the pixels the CLI maps back. Claude models before 4.7 shrink anything over 1568 px or 1568 tokens (28 px patches), and an XR screen at native size would be shrunk to an unknown scale ([Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost), [OpenAI vision](https://platform.openai.com/docs/guides/images-vision#calculating-costs)).

**Other sizes** with `--scale` (a fraction of native pixels) or `GHOSTHAND_SCALE`. Use the same value for every command, because it also changes how `tap` reads coordinates:

```bash
ghosthand screenshot -o full.png --scale 1  # native pixels, 828x1792
ghosthand tap 414 896 --scale 1             # native pixel coordinates
```

`screentext` always runs OCR on native pixels (small text reads better), then scales the boxes.

## Why this instead of Appium?

**Great for letting an agent control your own phone without a development setup.** After installing ghosthand on the Mac, there are just two manual connection steps:

1. **USB:** connect the iPhone, unlock it, and accept **Trust This Computer**.
2. **Bluetooth:** pair the Mac as a mouse and keyboard from the iPhone's Settings.

Nothing to install on the iPhone. No Xcode, Developer Mode, developer account, signing certificates, or test runner. AssistiveTouch is enabled automatically; allow Camera and Bluetooth using the buttons in `ghosthand setup`. Keep the phone unlocked and its screen awake. See [Setup](#setup-once-per-iphone).

**Appium on iOS uses WebDriverAgent (WDA)**, a signed test runner that controls the UI through Apple's XCTest framework. It can control existing App Store apps too, not just apps you develop. Its [device setup](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/) requires trust, Developer Mode on modern iOS, and provisioning for WDA.

| Tradeoff             | ghosthand                                         | Appium / WDA                                                                                     |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Phone setup          | USB trust + Bluetooth pairing                     | Development setup + signed runner                                                                |
| Signing renewal      | None; no runner installed                         | Free Personal Team: renew WDA provisioning every 7 days; paid membership avoids the weekly limit |
| Input                | Mouse, keyboard, and wheel through AssistiveTouch | Native UI-testing gestures, including multi-touch                                                |
| Find controls        | Screenshots, OCR, coordinates                     | UI elements and attributes, plus screenshots and coordinates                                     |
| Runtime dependencies | USB capture + Bluetooth link                      | Running WDA / XCTest session                                                                     |
| App lifecycle        | Navigate through the visible UI                   | Direct launch, terminate, and state queries                                                      |
| Text                 | US-ASCII only                                     | Broader text support, depending on the field                                                     |
| Fleet size           | Bluetooth limit: about 7 per Mac, 2 tested        | No Bluetooth limit; depends on host resources and USB                                            |

### No developer account or weekly signing renewal

**A paid account is not mandatory for Appium.** A free Xcode Personal Team can sign WDA, but Apple limits it to 3 registered devices and provisioning profiles that expire after 7 days. After expiry, the runner cannot be launched with that profile; rebuild/re-sign and reinstall it with renewed provisioning. Your other apps and their accounts are not affected. See [Apple's Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account).

**Ghosthand avoids this maintenance entirely.** There is no iPhone app to sign or renew. A paid [Apple Developer Program membership](https://developer.apple.com/programs/enroll/) costs US$99 per year (regional pricing varies) and avoids the free team's weekly limit, but WDA certificates and profiles still need renewal when they expire.

### Reliability

**My experience:** when I tried an Appium-like XCTest setup, the test runner frequently crashed. USB capture plus Bluetooth input has been more reliable for controlling my own phone. This is personal experience, not a controlled benchmark or a claim that everyone's Appium setup crashes. Removing WDA avoids runner crashes, signing failures, and XCTest idle waits, not every possible failure.

**Known issues exist on both sides.** Appium's [troubleshooting guide](https://appium.github.io/appium-xcuitest-driver/latest/troubleshooting/) documents unresponsive real devices and `testmanagerd` crashes. Here, Bluetooth can disconnect, USB capture can freeze or miss system dialogs, and private macOS APIs can change. Mouse drags are not always finger swipes, and there is no UI element tree or multi-touch. See [Limits](#limits).

**Closer to a real mouse-and-keyboard user.** The iPhone receives Bluetooth HID input through AssistiveTouch, the same input path a person can use with physical peripherals, rather than an XCTest runner. This avoids runner-specific signals and may make automation harder to distinguish from that legitimate use, but we have not measured detection rates. Pointer input, screen capture, and automated behavior can still provide signals. Neither approach is proven to prevent bot detection or account restrictions.

### Optional: XCTest mode

**One iPhone can use WebDriverAgent instead of Bluetooth**, for system alerts that ignore the pointer and dialogs that USB capture hides. Same commands; it needs Xcode signed in to an Apple account, Developer Mode and UI Automation on the iPhone. No lock, passcode unlock, mute or shortcuts.

```bash
ghosthand control -l 42 xctest      # builds WebDriverAgent once (1-3 min), then starts it
ghosthand control -l 42 bluetooth   # back to the default
```

The setup window shows the choice only with `ghosthand setup --xctest`. Details: [docs/xctest-mode.md](docs/xctest-mode.md).

## Alternatives

|                       | ghosthand                                                | Appium (XCUITest)       |
| --------------------- | -------------------------------------------------------- | ----------------------- |
| App on the iPhone     | none                                                     | WebDriverAgent (signed) |
| Xcode, Developer Mode | no                                                       | yes                     |
| Screen                | USB capture                                              | XCTest                  |
| Input                 | Bluetooth Classic HID                                    | XCTest                  |
| iOS 15                | yes over BLE (relative pointer); not tested over Classic | yes                     |
| Unlock with passcode  | yes                                                      | no                      |
| iPhones per Mac       | \~7, 2 tested                                            | many                    |

## More iPhones


**Multiple iPhones work after both connection steps on each one.** Pick one with `acquire -d`; each lease runs on its own iPhone:

```bash
ghosthand list
# 7EF219AD-...  Morse's iPhone  iPhone XR (iPhone11,8) iOS 18.7  (bluetooth connected, absolute pointer)
# 42B874EC-...  Test iPhone     iPhone 6s (iPhone8,1) iOS 15.8.4  (bluetooth connected, relative pointer)

ghosthand acquire -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F  # prints e.g. 42
ghosthand acquire -d "Test iPhone"                         # prints e.g. 43
ghosthand screenshot -l 42 -o a.png
ghosthand tap -l 43 206 332
ghosthand release -l 42
ghosthand release -l 43
```

The Mac is one Bluetooth mouse and keyboard for all iPhones, but each report goes to one iPhone only (its own L2CAP channel). Input to one phone never reaches another.

**Names do not matter; the id does.** Screen capture and USB lockdown give each iPhone unrelated IDs, and the name is the only field both show. So the daemon matches them once and saves the match in `~/.ghosthand/state.db` (see [State database](#state-database)):

```diagram
capture id 7EF219AD-... ── saved once ──> UDID 00008020-... ──> lock state, BT address
   first match: the only new iPhone on USB, or else the only one with that name
```

After that, a rename changes nothing. Only **several new iPhones with the same name, plugged in together**, cannot be matched: `list` warns. Plug them in one at a time once.

**Rename from the Mac** over USB, no touch needed (works while locked):

```bash
ghosthand rename "iPhone XR"  # on the lease's iPhone
# renamed "iPhone" to "iPhone XR". The id stays 7EF219AD-69B4-423E-B8C4-4F4A6140822F
```

- `list` and `acquire -d "iPhone XR"` use the new name at once. The Bluetooth link stays connected (tested on iOS 18.7).
- macOS screen capture (QuickTime, daemon logs) keeps the old name until you **unplug and plug in the cable**.

### How many iPhones per Mac

**Plan for at most 7 per Mac; 2 are tested.**

| Limit              | Value               | Why                                                                                                                                                                                                                         |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bluetooth Classic  | 7 connected devices | [Apple](https://support.apple.com/en-us/101205): "seven is the maximum number of Bluetooth devices that can be connected to your Mac at once; three to four is a practical limit". Keyboard, trackpad and AirPods count too |
| USB                | 127 devices per bus | **Not the problem.** Power is: use a powered hub, each iPhone charges while it is controlled                                                                                                                                |
| Screen capture CPU | not measured        | one video stream per iPhone                                                                                                                                                                                                 |

More than 7 iPhones needs a second Mac. Run a daemon on each one and reach it with `--url` (see [Remote daemon](#remote-daemon)).

### Several Macs: give each a unique name

**The iPhone lists the Mac by its computer name.** Two Macs called "MacBook Pro" look the same in Settings > Bluetooth, so an iPhone can pair with the wrong one. Rename each Mac before pairing:

```bash
# System Settings > General > About > Name, or:
sudo scutil --set ComputerName "Lab Mac 1"
sudo scutil --set LocalHostName "lab-mac-1"   # optional: network name, no spaces
```

- The Bluetooth radio uses the computer name. There is **one name per Mac**; ghosthand cannot show its own name next to it.
- The pairing steps print the name to tap: `tap "Lab Mac 1", then Pair`.
- An iPhone that paired before the rename can keep showing the old name. Forget the Mac on the iPhone (Settings > Bluetooth > (i) > Forget This Device) and pair again.
- Apple guide: [change your Mac's name](https://support.apple.com/guide/mac-help/change-computers-local-hostname-mac-mchlp2322/mac).

## Devices in `list`

**Only USB-connected iPhones appear.** `list` gets devices from macOS's QuickTime screen-capture device list, not from a Bluetooth scan. Keep the USB cable attached and trust the Mac once. A Bluetooth-only phone is not listed. Camera permission is required on the Mac; neither a Bluetooth connection nor AssistiveTouch is required just to list a phone. Missing permissions tell the agent to open `ghosthand setup` and poll `setup status` until ready, without showing a system dialog.

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

**Bluetooth link state** comes from the iPhone's Bluetooth address (read over USB) and the Mac's open HID channels. `list` starts Bluetooth when an iPhone uses Bluetooth mode, and reconnects paired phones:

| State          | Meaning                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `connected`    | input works                                                                                                                                 |
| `disconnected` | paired; the Mac reconnects in about 2 s. If it stays, Bluetooth is off on the iPhone or it is out of range. The Mac cannot tell these apart |
| `not paired`   | pair from iPhone Settings > Bluetooth; the next input command waits for it                                                                  |

It waits (up to 25 s) only for a trusted phone, which capture can list a few seconds after a daemon start.

**Locked phones stay listed.** The daemon reads `PasswordProtected` from iOS lockdown over the trusted USB connection using macOS's private `MobileDevice.framework`. It does not need a screen frame. `[locked]` means the passcode is required; its absence means lockdown reports unlocked. If the lock state cannot be read, the field is absent. Capture and lockdown IDs differ; see [More iPhones](#more-iphones) for how they are matched.

## Unlock

**`unlock` uses only the Bluetooth keyboard.** USB screen capture does not yield frames while the iPhone is locked, so it runs a timed sequence (about 3 s):

```diagram
enter ──> screen on ──1 s──> enter ──> passcode screen ──1 s──> type passcode once
                                                                  └──> check USB lock state
```

- **The keyboard must be the first HID collection.** iOS takes the device type from it. With the mouse first, SpringBoard tagged keys `source:mouse` and the lock screen dropped them. After a report map change, forget and pair the iPhone again: iOS keeps the old map from pairing.
- **Lock state** comes over USB from lockdown (`PasswordProtected`) through the private `MobileDevice.framework`. `list` shows `[locked]`; `unlock` checks it before and after.
- **A wrong passcode is never retried.** Failed tries count toward the iPhone lockout. The passcode is not stored.
- **Locked screenshots fail immediately.** USB capture does not return frames from this phone while locked; `screenshot` and `screentext` check the lock state first.
- **OCR is for the agent loop after unlock**, not for the locked-screen sequence. For example, `screentext` can find a button label and its pixel box; the agent chooses the next tap based on that result.

## HTTP API

**The daemon serves HTTP on a unix socket**, described by OpenAPI at `GET /v1/openapi.yaml`. Any language with an HTTP client can drive it.

```bash
S=~/.ghosthand/daemon.sock
curl --unix-socket $S http://localhost/v1/devices
curl --unix-socket $S http://localhost/v1/phones   # setup step, lease, last command, waiting agents
curl --unix-socket $S -H 'content-type: application/json' \
  -d '{"device":"default","label":"curl","reason":"reply to Anna"}' http://localhost/v1/leases   # {"id":"42",…}
L=http://localhost/v1/leases/42
curl --unix-socket $S $L/screenshot -o s.png
curl --unix-socket $S -H 'content-type: application/json' \
  -d '{"x":207,"y":448}' $L/tap                    # screen points, like the screenshot
curl --unix-socket $S $L/assistive-touch            # {"enabled":true}
curl --unix-socket $S -X DELETE $L                  # release
```

- **Screenshots and input live under `/v1/leases/{lease}/`** and run on the lease's iPhone. Unknown, expired, released or taken with `force`: `lease-invalid` (403). Acquire while held: `device-leased` (409); the detail shows the label, reason, acquire time and last call. Retry to wait.
- Input routes return JSON. Send `Accept: text/event-stream` to get progress as server-sent events.
- **One call per step:** input routes take `waitText`, `screenshot=png|jpeg` and `screentext=true`. The daemon runs them after the input on the same lease; the result has `screenshot` (base64) and `screen` (OCR lines). `tap` also takes `{"text":"General","index":1}` instead of `x` and `y`.

  ```bash
  curl --unix-socket $S -H 'content-type: application/json' \
    -d '{"text":"General"}' "$L/tap?waitText=About&screentext=true"
  ```
- Errors are `application/problem+json` with a stable `code`. In event-stream mode the status is 200 and the problem arrives as the final `error` event.

### Remote daemon

**For agents anywhere, use [remote MCP](#mcp-server).** It needs no port and no URL to share.

**For the CLI on your own network**, listen on TCP with a bearer token:

```bash
# on the Mac with the iPhones
GHOSTHAND_TOKEN=secret ghosthand daemon start --port 7420 --host 0.0.0.0 \
  --tls-cert cert.pem --tls-key key.pem

# anywhere else: acquire with the URL once, then use the lease alone
ghosthand --url https://mac.local:7420 --token secret --ca cert.pem acquire --reason "reply to Anna"
# r1
ghosthand screenshot -l r1 -o s.png
```

**Remote leases remember their daemon.** `acquire --url` prints a local id like `r1` and saves the URL (and `--token`, `--ca`) in `~/.ghosthand/remote-leases.json`, mode 0600. Later commands need only `-l r1`, so a forgotten `--url` can never hit a lease on the local daemon.

**A host other than localhost needs TLS**, so the token never crosses the network in clear text.

## MCP server

**Add `https://ghosthand.dev/mcp` as a remote MCP server.** Every CLI command is a tool with the same name and the same help text, so agents without a shell (Claude Code, Cursor, opencode) can drive the iPhones. The client signs in with the same Google account as your Macs.

```bash
claude mcp add --transport http ghosthand https://ghosthand.dev/mcp
```

```jsonc
// opencode.json
{ "mcp": { "ghosthand": { "type": "remote", "url": "https://ghosthand.dev/mcp" } } }
// .cursor/mcp.json
{ "mcpServers": { "ghosthand": { "url": "https://ghosthand.dev/mcp" } } }
```

**Every signed-in Mac is reachable.** While a Mac is signed in, its daemon keeps a WebSocket to ghosthand.dev. One hub per account holds the sockets of all its Macs and routes each call:

```diagram
MCP client ──POST /mcp, OAuth──> ghosthand.dev hub (one per account)
                                   ├─ lease "studio:42" ──> Mac studio
                                   ├─ mac: "laptop" ──────> Mac laptop
                                   └─ list ───────────────> every Mac, joined
                                          ▲  WebSocket the daemon opens (session token)
                                          └── daemon ──> tunnel.sock, /mcp only ──> Controller
```

- **Leases name their Mac:** `acquire` returns `studio:42`. Pass it as is; it picks the Mac.
- **Several Macs:** `list` shows each iPhone under its Mac. Pass `mac` to `acquire`, `wait`, `setup` and `setup status`. With one Mac online, `mac` is optional.
- **Flags are arguments:** `lease`, `text` and `index` on `tap`, `waitText`, `timeoutMs`, `screenshot: true`, `screentext: true`. Screenshots come back as image content, not files.
- **Stateless HTTP:** modern clients (MCP 2026-07-28) and legacy ones (`initialize`) both work. A closed request stops the tool.
- **No MCP library:** a few JSON-RPC methods in [mcp.swift](Sources/ghosthand/mcp.swift) run in the daemon; the hub in [website/src/tunnel.ts](website/src/tunnel.ts) only routes.
- `ghosthand daemon status` shows this Mac's name in the account.

## Security

> [!WARNING]
> **Whoever reaches the daemon can use the iPhone like a person holding it**: open apps, read messages, type.

Everything runs on your Mac and nothing is installed on the iPhone. Screenshots, screen text and typed text leave the Mac only for remote MCP calls, through ghosthand.dev. The only server call is the plan check at each `acquire`: the daemon sends the account's session token to ghosthand.dev (`GHOSTHAND_SERVER` overrides the server, e.g. a local `vite dev`). The token is in `~/.ghosthand/state.db`, mode 0600. If ghosthand.dev cannot be reached, the lease is allowed.

```diagram
who can reach the phone              how
local user who owns ~/.ghosthand ──> unix socket, file mode 0600
MCP client of your account ────────> ghosthand.dev/mcp: OAuth, then the Mac's tunnel
remote client ─────────────────────> TCP with --port: Bearer token, TLS off localhost
```

The iPhone accepts input only from a Mac that has **all three**:

1. **USB cable** plugged in, and the phone trusts this Mac (Trust prompt + passcode).
2. **Bluetooth pairing** accepted on the phone in Settings > Bluetooth.
3. The **daemon running**.

**Cut access** by removing any one of them:

| Action                                                                            | Effect                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ghosthand daemon stop`                                                           | no screenshots, no input, until the next command starts it                |
| unplug the cable                                                                  | no screenshots and no input: every command finds the phone over USB first |
| iPhone: Settings > Bluetooth > the Mac > (i) > Forget This Device                 | no input until you pair again                                             |
| iPhone: Settings > General > Transfer or Reset > Reset > Reset Location & Privacy | removes the USB trust of every computer                                   |

- **The passcode is never stored.** `unlock` gets it per call; prefer a direct pipe to `unlock --stdin`, not an argument.
- **Apple Pay still needs you.** It asks for a double press of the side button, which the Mac cannot press.

## Limits

- **AssistiveTouch must be on** for tap and swipe. ghosthand turns it on over USB; its floating button can be hidden (see [AssistiveTouch](#3-assistivetouch-automatic)).
- **Keyboard without AssistiveTouch** is not tested.
- **`cmd+h`** did nothing in tests. `cmd+space` opens Spotlight: `key cmd+space`, `type Safari`, `key enter` opens an app.
- **No verified global Back command.** `key home` goes Home; `key esc` sends Escape. Neither is a promise of Back in Settings or Safari. AC Back (Consumer usage `0x0224`) is not exposed because reliable iOS behavior has not been verified. Descriptors are unchanged.
- **Screen off:** no frames. `unlock` tries to wake a locked iPhone; USB capture may still return no frame. An unlocked one with the screen off needs a tap from you.
- **Several new iPhones with one name**, plugged in together, cannot be matched to their USB data. Plug them in one at a time once (see [More iPhones](#more-iphones)).
- **Many fast daemon restarts** can hide the iPhones for about a minute. macOS throttles the screen capture helper.
- **About 7 iPhones per Mac**, set by Bluetooth, not by ghosthand. Only 2 tested. See [How many iPhones per Mac](#how-many-iphones-per-mac).
- **The cable must stay in.** Screenshots only come over USB; a phone on Bluetooth or Wi-Fi alone is not listed.
- **Typing is US-ASCII only**: no accents or emoji. There is no length limit.

### Something went wrong: read the daemon log

**The daemon writes everything to `~/.ghosthand/daemon.log`**: each command, its errors, Bluetooth pairing, screen capture restarts, and the MCP calls from the remote tunnel. Each line starts with a UTC timestamp.

```bash
tail -n 100 ~/.ghosthand/daemon.log                   # last lines
tail -f ~/.ghosthand/daemon.log                       # follow live while you run a command
grep -iE 'error|fail' ~/.ghosthand/daemon.log | tail  # recent errors only
```

```text
2026-10-08T13:02:40Z error no-device: No iPhone found on USB. A charge-only cable does not work.
2026-10-08T16:43:31Z no iPhone visible yet, restarting the screen capture helper
```

| File                       | What writes it                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| `~/.ghosthand/daemon.log`  | the daemon (`ghosthand daemon start`, or any command that starts it) |
| `~/.ghosthand/app.log`     | the `setup` and `dashboard` windows, and their app install step            |
| your terminal (stderr)     | `ghosthand daemon run`: the daemon in the foreground, for debugging  |

- **`ghosthand daemon status`** prints the log path, the pid, and the Bluetooth state.
- **The log is never rotated.** Delete or truncate it when it gets large: `: > ~/.ghosthand/daemon.log`. Never delete `state.db`.
- **Live progress** of one command (pairing, retries) is also streamed to that command's stderr, so you see it without the log.

### Pairing no longer works: forget on both sides

**Symptoms:** Pair on the iPhone ends with "Connection unsuccessful", the Mac is missing from the iPhone's Bluetooth list, or `list` stays at `bluetooth disconnected`.

**Cause:** one side still has an old bond and the other side does not. This happens after a Forget on only one side, a phone reset, a phone paired with an older ghosthand (BLE), or a report map change. The side with the old key rejects the new pairing (tested on the iPhone 6s and XR).

**Fix: remove the bond on both sides, then pair again.**

1. iPhone: Settings > Bluetooth > the Mac > (i) > **Forget This Device**.
2. Mac: `ghosthand forget` (with a lease on that iPhone). It removes the Mac's bond (same as System Settings > Bluetooth > the iPhone > (i) > **Forget This Device**).
3. Run any input command, for example `ghosthand key home`. It makes the Mac discoverable and waits.
4. iPhone: Settings > Bluetooth, tap the Mac under Other Devices, then **Pair**.

The Mac is listed on the iPhone **only while a command waits for pairing**. With no command waiting, it is not discoverable, and a new iPhone does not see it.

### USB screen capture stops (iOS bug): restart the daemon, then the iPhone

**iOS can stop sending its screen over USB** while macOS still lists it. `list` works and the lock state is correct, but `screenshot` gets no frame and no error:

```text
error: No frame from Morse’s iPhone (2) after 8s (session running, 0 frames since open). ...
```

- **First try `ghosthand daemon restart`.** It fixed a stuck capture that failed with `Recording Stopped (AVFoundationErrorDomain -11808)` (iOS 18.7).
- **If frames still do not arrive, restart the iPhone.** Replugging the cable does not help, and in some cases the daemon restart did not help either (tested on iOS 18.7).
- This is an iOS bug, not ghosthand. A plain AVFoundation program gets no frames either, and QuickTime Player **crashed** when it opened the same iPhone screen.
- Known Apple reports with the same symptom: [FB21608780](https://github.com/feedback-assistant/reports/issues/778) (after "Stop Mirroring" in Control Center, fixed only by a reboot) and [FB22281473](https://github.com/feedback-assistant/reports/issues/781) (screen capture trust revoked).
- After the restart, **unlock the iPhone by hand once**. Before the first unlock, iOS ignores the Bluetooth keyboard, so `ghosthand unlock` fails.

**Check with QuickTime Player** which sources the Mac sees. Stop the daemon first (the iPhone serves its screen to one app at a time):

1. `ghosthand daemon stop`
2. QuickTime Player > **File > New Movie Recording**
3. Click the **⌄** arrow next to the record button. Under **Camera**:

| Entry                       | What it is                                            |
| --------------------------- | ----------------------------------------------------- |
| `Morse’s iPhone (2)`        | the iPhone **screen** over USB (what ghosthand uses)  |
| `Morse’s iPhone (2) Camera` | the iPhone camera (Continuity Camera), not the screen |

- **Screen entry shows the live screen:** capture works; the problem is on the Mac side.
- **Screen entry is black, missing, or QuickTime crashes:** iOS stopped serving the screen. Restart the iPhone.
- Two iPhones with the same name both show up as `... Camera`. Only the one on USB has a screen entry.

## How the Mac becomes a mouse

The daemon publishes a **Bluetooth Classic HID** service, the same profile a real Bluetooth keyboard uses. macOS has no public API to be a Classic HID device, so it uses CoreBluetooth's private `CBClassicManager` (`Sources/ClassicBluetooth`).

```diagram
Mac (daemon)                                          iPhone
┌──────────────────────────────────┐                 ┌─────────────────────────────┐
│ SDP record: HID, report map      │ <──SDP query─── │ Settings > Bluetooth > Pair │
│ L2CAP 0x11 control  (handshakes) │ <──opens─────── │                             │
│ L2CAP 0x13 interrupt             │ ──reports─────> │ AssistiveTouch              │
│  report 1: mouse (absolute)      │                 │  pointer + clicks = touches │
│  report 7: mouse (rel.), wheels  │                 │                             │
│  report 2: keyboard, 6: media    │                 │                             │
└──────────────────────────────────┘                 └─────────────────────────────┘
```

Report 1 is absolute: X and Y go from 0 to 32767, so a screenshot pixel converts directly to a pointer position (tested on iOS 18.7 over Classic). Report 7 is relative, for iOS versions that ignore absolute positions (iOS 15 over BLE).

**Clicks in absolute mode go in both reports.** With two mouse collections in the map, iOS 18 ignored the button bits of report 1 over BLE. So a press and release are sent in report 1 and, with zero movement, in report 7.

```diagram
check:  corner ──> move (80,120) pt ──> screenshot P1
        corner ──> move (160,120) pt ──> screenshot P2
        pointer found in P1 and P2 ──> gain = measured / computed (saved in state.db)
tap:    computed reports from the last known spot ──> 100 ms pause ──> click
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

```diagram
USB lockdown  BluetoothAddress ──── EC:CE:D7:A4:9B:C1 ────> Bluetooth HID link
```

### State database

**`~/.ghosthand/state.db` holds SQLite state.** Device matches and pointer modes are caches, one row per iPhone keyed by Apple's UDID. The `lease` table holds active leases, and `lease_counter` keeps the highest issued ID so IDs are never reused (see [Leases](#leases-one-agent-per-iphone)).

```diagram
phone (USB)                                  bluetooth_pointer (Bluetooth)
┌───────────────────────────────────┐        ┌──────────────────────────────────────┐
│ usb_udid           PK             │<───────│ usb_udid   PK, FK, ON DELETE CASCADE │
│ screen_capture_id  UNIQUE         │        │ mode       absolute | relative       │
│ capture_matched_by / _at          │        │ gain, screen_width_pt, _height_pt    │
└───────────────────────────────────┘        │ report_map, found_at                 │
                                             └──────────────────────────────────────┘
```

```bash
sqlite3 -header -column ~/.ghosthand/state.db 'SELECT * FROM phone; SELECT * FROM bluetooth_pointer'
# usb_udid                   screen_capture_id                     capture_matched_by  capture_matched_at
# 00008020-000405C214BB002E  7EF219AD-69B4-423E-B8C4-4F4A6140822F  only-new-phone      1790773434
# usb_udid                   mode      gain  screen_width_pt  screen_height_pt  report_map                found_at
# 00008020-000405C214BB002E  absolute                                           classic-a85efc997e025d8f  1790773436
```

| Table               | Written when                                                                                                           | If the row is missing                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `phone`             | a command sees a new iPhone. `capture_matched_by`: `only-new-phone` or `same-name` (see [More iPhones](#more-iphones)). `assistive_touch_off_after_lease`: 1 when AssistiveTouch goes off once no lease holds the iPhone | matched again the same way                                                           |
| `bluetooth_pointer` | the first tap or swipe                                                                                                 | iOS 17+: absolute again, no check. Older iOS: the pointer check runs on the next tap |

- **Not stored**, because USB lockdown gives them on every command: name, Bluetooth address, lock state, the AssistiveTouch setting.
- **Bluetooth pairing is not here.** macOS keeps the bond. A phone paired while the daemon was stopped, or with no `state.db`, reconnects on the next command (tested).
- **A saved match is never changed by itself**, even while its phone is missing from one list during a plug-in. If one is wrong, delete its `phone` row (below).
- **Schema migrations preserve state.** Version 5 → 6 adds AssistiveTouch ownership without deleting matches, pointer settings, leases or the lease counter. Newer or unsupported schemas are refused without deleting data. Never delete `state.db` to bypass that error.

**Fix a bad state** with `sqlite3`, also while the daemon runs (it keeps no copy in memory). Turn on `foreign_keys`: the `sqlite3` shell has it off, and without it the pointer row is not deleted with its phone.

```bash
DB=~/.ghosthand/state.db
sqlite3 $DB "PRAGMA foreign_keys = ON; DELETE FROM phone WHERE usb_udid = '00008020-000405C214BB002E'"   # one iPhone
sqlite3 $DB 'DELETE FROM bluetooth_pointer'                                                             # all pointer modes
```

- **Screen from one phone, input to another:** delete its `phone` row. Plug in same-named new phones one at a time.
- **Pointer lands in the wrong spot:** delete its `bluetooth_pointer` row. `ghosthand forget` also does it, but it removes the Bluetooth bond too, so you must pair again.
- **Never delete or restore `state.db`.** Resetting its counter can give a new lease an old ID.

## iOS versions

**Tested on iOS 18.7 (iPhone XR) over Bluetooth Classic, and on iOS 15.8.4 (iPhone 6s) with the earlier BLE version.** The iPhone sees the Mac as a normal Bluetooth Classic mouse and keyboard (HID profile over L2CAP). The only difference between versions is how the **pointer** moves.

| iOS  | Pointer                                                                           | Tap      | Accuracy                             |
| ---- | --------------------------------------------------------------------------------- | -------- | ------------------------------------ |
| 18.7 | **absolute**: report 1 says "go to X, Y"                                          | \~0.3 s  | exact                                |
| 15.8 | **relative** over BLE (iOS ignored absolute X/Y); **not tested yet over Classic** | \~0.45 s | 0.2 pt mean, 0.4 pt max (40 targets) |

- The mode is **found by itself** on the first tap: iOS 17 and later use absolute; older versions are checked by moving the pointer. `list` shows it: `(bluetooth connected, relative pointer)`.
- Apple does not document absolute pointers for AssistiveTouch, and no changelog mentions them. The iOS 15 behavior was found by testing over BLE: the phone read report 1 but the pointer stayed still.
- In relative mode the daemon knows **exactly** how far each report moves the pointer, from Apple's own acceleration table. See [Relative pointer](#relative-pointer-ios-15).

### Which iPhones get which pointer

**Absolute first, on every iOS version.** iOS 17 and later use it with no check. Older iOS tries absolute on the first tap and falls back to relative only if the pointer does not move.

| iPhone                                           | Last iOS | Pointer                                                                | Tap                              |
| ------------------------------------------------ | -------- | ---------------------------------------------------------------------- | -------------------------------- |
| 6s, 6s Plus, 7, 7 Plus, SE (1st gen)             | 15       | relative over BLE (tested on 6s); **absolute over Classic not tested** | \~0.45 s relative, \< 0.5 pt off |
| 8, 8 Plus, X                                     | 16       | absolute tried first, not tested                                       |                                  |
| **XS, XS Max, XR, SE (2nd gen, 2020)** and newer | 17+      | **absolute** (XR tested)                                               | \~0.3 s, exact                   |

- The "absolute from iOS 17" claim comes from a [vendor of ESP32 **BLE** HID firmware](https://ieasyclick.net/blog/en/ios-ble-hid-no-signature/), not from Apple. Bluetooth Classic HID may behave differently, so older iOS is checked, not assumed.

### Relative pointer (iOS 15)

**iOS turns each relative report into a fixed distance.** It looks up the report's size in IOHIDFamily's built-in acceleration table. Time does not count, and fractions of a point add up. So the daemon computes the reports for any move:

```diagram
tap 300,500 with the pointer at 40,120 (move +260,+380 pt) on a 6s:
  (+169,+248) (+170,+247) ── speed 300, past the flat end of the table ──> 214.9 pt each
  (+16,+24)               ── speed 28 ─────────────────────────────────> 30.0 pt
  (0,-1)                  ── speed 1: 0.2 pt, lands within 0.2 pt
  100 ms pause, then click                                   ~0.45 s in total
```

- **Measured on an iPhone 6s** (iOS 15.8.4): 15 report sizes, diagonals, and bursts vs 100 ms gaps all matched the table to 0.5 pt. 40 taps in a row landed 0.2 pt from the target on average, with no drift. Details: [docs/relative-pointer.md](docs/relative-pointer.md).
- **The daemon remembers where the pointer is.** Only when it does not know (daemon start, Bluetooth reconnect, rotation, 60 s idle) does it push the pointer into the top-left corner first (+0.3 s).
- **Tracking Speed:** the pointer check measures a `gain` (1.000 at the default speed) and scales the table by it. Other speeds are not tested.
- **Swipes follow `--duration`**: reports are spread over it and sized so the drag ends exactly at the target.

<details>
<summary>Architecture</summary>

```diagram
CLI / curl / any language
   │ HTTP over ~/.ghosthand/daemon.sock (mode 0600, no token)
   │ HTTP or HTTPS over TCP with --port (Bearer token)
   v
Hummingbird ──> generated API (openapi.yaml) ──> own thread ──> Controller
     ^
     │ /mcp only, via tunnel.sock
MCP clients ──> ghosthand.dev/mcp (OAuth) ──> WebSocket the daemon opens while signed in
                                                                  │
      ┌───────────────────────────────────────┬───────────────────┤
      v                                       v                   v
  FrameStream per iPhone (AVFoundation)   Lockdown lock state     HIDDevice: BT Classic
  OCR (Vision)                            (MobileDevice)          HID, CBClassicManager
```

- `Sources/ghosthand/openapi.yaml` is the source of truth. swift-openapi-generator builds the server and the client from it.
- AVFoundation and CoreBluetooth need the main run loop, so HTTP runs in a detached task.
- Each request runs on its own thread. Capture, OCR, and lock state have per-iPhone locks; input sequences (`unlock`, taps) are serialized per iPhone. Different iPhones run in parallel.
- Files: `~/.ghosthand/daemon.sock`, `daemon.log`, `daemon.lock`, `state.db`.

</details>
