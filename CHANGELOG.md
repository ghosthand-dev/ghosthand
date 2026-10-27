# Changelog

## 0.13.0

1. **New plans: free for one iPhone, Pro per Mac.** Free accounts lease one iPhone, with no time or request limits; switch it with Remove on the dashboard. Pro is $99 per Mac per month: every iPhone on a paid Mac works, plus phone tasks and read access to the daemon source code. See https://ghosthand.dev/docs/pricing.

2. **Acquire checks the device.** The daemon sends hashes of the iPhone and Mac ids (never the raw ids) to ghosthand.dev. When the server cannot be reached, only an iPhone that was allowed before keeps working, until its check expires (`tunnel-offline`). An iPhone the daemon cannot match to its USB id now fails with `lockdown-unavailable`.

3. **Mac installer.** Download a notarized `.pkg` from https://ghosthand.dev/download. It installs for the current user only (no admin password) and opens setup. The npm package and the installer ship the same signed app, so macOS permissions stay when you switch between them or upgrade.

4. **Remote MCP works before you set up a Mac.** Claude, ChatGPT and other remote clients can connect https://ghosthand.dev/mcp at once. With no Mac online, tools explain how to download ghosthand or which Mac to wake.

5. **Clearer first-time errors.** With no iPhone ever connected, the error lists the plug-in, Trust and setup window steps.

6. **`ghosthand account` shows the plan** (free, or Pro with the number of paid Macs). Trial wording is gone.

7. **Fewer telemetry requests.** Error reports and usage counts go in one request.

## 0.12.0

1. **Phone tasks see the screen.** The `task` agent now runs on Claude Haiku and gets a screenshot of the settled screen after every action, so it can use icons and images that OCR cannot read. New task tools: `tapText` (tap a text on screen), `unlock` (with a passcode you give in the prompt; it never guesses one) and `webfetch` (reads the ghosthand.dev docs when it is stuck).

2. **Control plane chat: a new prompt replaces the running turn.** Press Enter while the agent works: the old turn stops at once and the new prompt runs on the same lease and task. The chat also works on a locked iPhone; the agent asks you for the passcode.

3. **Screenshots after an action return as soon as the screen reacted.** `--screenshot` and `--screentext` no longer wait a fixed time: the daemon compares the screen with the one before the input and returns once it changed and stood still (up to 1 s for slow reactions).

4. **`key home` works without setup.** It now sends the keyboard Home key, with AssistiveTouch on or off. The manual AssistiveTouch button mapping is no longer needed.

5. **Faster, more consistent default swipes**: 80...180 ms (was 60...400 ms).

6. **Taps land on the right spot when the iPhone lies on its side.** iOS turns mouse input to the last orientation the iPhone was held in, so taps and back swipes went to the wrong place. The daemon now measures this once per lease and turns its input to match.

7. **Faster input.** The daemon runs as an interactive process, so macOS no longer delays its timers: a tap took up to 1.2 s, now about 400 ms. Keys right after a tap wait 300 ms so they never act before the tap.

8. **`--background` for `setup` and `dashboard`**: open the window behind your windows without taking focus, for agents that check it with accessibility tools.

9. **Steadier control plane.** Rows stay one line and the cards keep their rows with or without a lease, so values never move the layout. The screen keeps each iPhone's aspect ratio across launches.

10. **The tunnel reconnects after sleep and network changes**, and leasing an iPhone on another Mac goes to that Mac directly.

11. **Error reports and usage counts.** The daemon sends unexpected errors, crash reports and hourly command counts (never screen text, typed text or prompts). Turn it off with `touch ~/.ghosthand/telemetry-off`. See https://ghosthand.dev/docs/privacy.

## 0.11.0

1. **New `ghosthand task` command: do a task in plain words.** A fast agent on ghosthand.dev reads the screen with OCR and taps, swipes, scrolls and types until the task is done, then answers. Progress goes to stderr, the answer to stdout, then the task id:

   ```bash
   ghosthand task -l 42 "open Settings > General > About and tell me the iOS version"
   ghosthand task -l 42 --resume tsk_8f2k3x9a1b2c "now go back to the Home Screen"
   ```

   `--resume <id>` continues a task with its history; without a prompt it follows the running turn. The agent knows the iPhone's name, model, iOS version, language and region. It never pays, buys, deletes data or types passwords unless the prompt asks exactly that. Also as the MCP tool `task` and the route `POST /v1/leases/{lease}/task`. Needs a signed-in Mac.

2. **Agent chat in the control plane.** A chat column next to the selected iPhone (toggle it with the sidebar button) runs `task` on that iPhone. Each prompt takes a lease labeled "Control plane chat", shows each tool call as one line, and releases the lease when the agent answers or you click Stop. The next prompt continues the same task; the pencil button starts a new one.

3. **Lease ids always carry their Mac.** `acquire` prints `studio:42` also for an iPhone on this Mac, so the id works from every Mac of the account. `list` always groups iPhones under `mac <slug>:` (`this Mac:` while signed out). The plain `42` still works on its own Mac.

4. **The Mac no longer sleeps while the daemon runs.** An idle Mac went into dark wake and USB screen capture stopped. The daemon now keeps idle sleep off, like `caffeinate -i`. Sleep with the lid closed still needs an external display.

5. **Other Macs' iPhones show right after a daemon restart.** The first `list` after a restart no longer misses them; it waits for the ghosthand.dev connection.

## 0.10.0

1. **SIM info in `ghosthand info`**, over USB, also while locked. It shows the physical SIM tray and one line per SIM iOS reads (physical or eSIM) with its carrier bundle and MCC/MNC:

   ```bash
   ghosthand info -l 42
   # sim tray: SIM card in
   # sim line 2: Vodafone_Ho_it, physical SIM, MCC 222 MNC 10
   ```

   `sim lines: none read` means iOS reads no SIM. ICCID and IMSI are never read out. Also in `--json` and the `info` MCP tool.

2. **The control plane shows the iPhones of your other Macs**, view only, grouped under each Mac's name. Their screen shows "visible only on <Mac>". The lists update when they change, with no polling.

3. **Update notice in the CLI.** When npm has a newer ghosthand, the CLI prints once: `ghosthand 0.11.0 is out, this CLI is 0.10.0. Update with npx ghosthand@latest` (or `npm install -g ghosthand@latest` for global installs). The daemon checks npm at most once per hour, in the background.

4. **Setup window stays on its iPhone.** After one iPhone finished setup, the window sometimes switched to another ready iPhone, so **Copy prompt** named the wrong one. The ready screen now has a **Set up <name>** button when another iPhone still needs setup, and the window comes to the front when an agent runs `ghosthand setup`.

5. **Empty states in the control plane are centered** ("No iPhone connected", daemon errors, loading).

## 0.9.0

1. **Tap and type on an iPhone from the control plane.** Hover the screen and click **Take Control**. A click on the screen is a tap there, a drag is a swipe with the same start, end and duration; the Mac keyboard types into the iPhone: text, arrows, backspace and shortcuts like ⌘A. ⌘V types the Mac clipboard as text. Esc or **Release Control** under the screen stops. It needs no lease, so it works also while an agent holds the iPhone (new app-only routes `POST /v1/phones/{phone}/tap`, `/swipe`, `/key` and `/type`, unix socket only). In Bluetooth mode a tap or swipe turns AssistiveTouch on; Release Control turns it off again if no lease holds the iPhone (new route `POST /v1/phones/{phone}/release`); if the app quits without it, it goes off 60 s after the last input.

2. **Live screen in the control plane at 30 fps** (was one frame every 2 s), only while the window is on screen. A preview takes about 5 ms (was 150 ms): it returns the newest capture frame, scales it on the GPU, and reads the lock state from the last phone list. The sidebar keeps a fixed order, by UDID.

3. **Every USB iPhone comes back after a daemon restart.** With several iPhones, macOS screen capture sometimes showed only some of them after a quick restart, until a replug. The daemon now restarts the screen capture helper (up to 3 times) until every trusted, unlocked USB iPhone is listed.

4. **Use the iPhones of every Mac from any signed-in Mac. Breaking: `--url`, `--token` and `r1` leases are gone.** Sign each Mac in once (`ghosthand setup`). `list` then shows the iPhones of all online Macs of the account, and `acquire -d <id>` takes one on its own Mac:

   ```bash
   ghosthand list                       # mac studio: ... / mac laptop: ...
   ghosthand acquire -d 7EF219AD-... --reason "reply to Anna"   # studio:42
   ghosthand tap -l studio:42 --text General --screenshot s.png
   ```

   The local daemon sends each command for `studio:42` to that Mac through ghosthand.dev, with its own session. No token to copy. A Mac with no iPhone takes the account's only one without `-d`. Leases taken through the tunnel URL now also carry the Mac (`studio:42`, like MCP); the plain `42` still works on its own Mac's URL. `tunnel url --new-token` stays for curl and scripts; the CLI no longer reads `GHOSTHAND_URL` and `GHOSTHAND_TOKEN`. Update every Mac: older daemons are skipped with a warning. The warning shows also when this Mac has no iPhone, so `list` tells which Mac to update instead of only "No iPhone found on USB".

5. **Longer tap press**: 220...260 ms (was 150...190 ms) in Bluetooth mode, for `tap`, `double-tap`, `triple-tap` and Take Control clicks. Short presses often did not register.

6. **Breaking: remote MCP tools never read or write Mac paths.** File, photo, upload, app install and recording tools over MCP take and return file bytes, not paths on the daemon's Mac. The local CLI keeps its path arguments. Files uploaded to ghosthand.dev are served as downloads.

## 0.8.0

1. **Scripts on any computer: the HTTP API through the tunnel. Breaking: the TCP listener is gone.** While a Mac is signed in, its API is at `https://ghosthand.dev/macs/<mac>/v1/...`, with an API token. No port, no TLS files, works behind NAT:

   ```bash
   ghosthand tunnel url --new-token --name ci   # prints export lines for GHOSTHAND_URL and GHOSTHAND_TOKEN
   curl -H "Authorization: Bearer $GHOSTHAND_TOKEN" $GHOSTHAND_URL/v1/devices
   ghosthand tunnel revoke <id>
   ```

   Removed: `daemon start --port/--host/--tls-cert/--tls-key/--token` and `--ca` / `GHOSTHAND_CA`. Use `tunnel url`. Lease ids: bare number on the CLI and HTTP API (`r1` on another computer), `studio:42` over MCP only.

2. **`swipe` is a fast, human-like flick**: random speed, easing and a small sideways bow, lifted while still moving so lists keep their momentum. `--duration` fixes the speed. `hold-drag` keeps the slow, exact drag.

3. **Faster input**: screen capture stays open 60 s after the last command (was 1 s), so a warm `swipe` takes about 0.4 s (was 1.2 s).

4. **More reliable taps**: the default press is now 150...190 ms (was 110...130 ms), for `tap`, `double-tap` and `triple-tap`.

5. **`list` warns about iPhones missing from screen capture**: an iPhone plugged in while locked or untrusted never shows up in capture after you trust it. `list` and the setup window now tell you to unplug and replug the cable, instead of "not found".

6. **Setup shows the XCTest choice for iPhones with Developer Mode on**, without `setup --xctest`.

7. **MCP screenshots are JPEG**: 2-3x smaller over the ghosthand.dev tunnel. The CLI and HTTP API still return PNG.

## 0.7.0

1. **Breaking: commands are grouped under subcommands.** Update scripts. MCP tool names stay dash-joined (`file-push`):

   | before                        | after                           |
   | ----------------------------- | ------------------------------- |
   | `record-start`, `record-stop` | `record start`, `record stop`   |
   | `setup-status`                | `setup status`                  |
   | `login`, `logout`             | `account login`, `account logout` |
   | `app` (control plane window)  | `dashboard`                     |

2. **Files, photos, apps and device info over USB**, no Developer Mode. Also MCP tools and HTTP routes:

   ```bash
   ghosthand file list -l 42 /Documents --app org.videolan.vlc-ios
   ghosthand file push -l 42 clip.mp4 /Documents/clip.mp4 --app org.videolan.vlc-ios
   ghosthand photo pull -l 42           # newest Camera Roll files
   ghosthand photo delete -l 42 IMG_0001.PNG
   ghosthand app list -l 42             # with Home Screen positions
   ghosthand app install -l 42 app.ipa
   ghosthand info -l 42                 # battery, storage, iOS build, works while locked
   ghosthand logs -l 42
   ghosthand restart -l 42
   ```

   `photo delete` needs the optional Allow Photos step in `ghosthand setup`.

3. **`ghosthand upload` puts a photo or video into Photos**: it prints a 1-day link. Open it in Safari on the iPhone, tap Save, then Save Video or Save Image. Then apps like TikTok and Instagram can upload it. At most 100 MB. Guide: https://ghosthand.dev/docs/send-media

   ```bash
   ghosthand upload clip.mp4
   ```

4. **New gestures**: `hold` (long press), `hold-drag` (long press, then drag, e.g. to move Home Screen icons), `double-tap` and `triple-tap`:

   ```bash
   ghosthand hold -l 42 --text "Photos" --duration 1500
   ghosthand hold-drag -l 42 60 200 300 200 --hold 2500
   ghosthand double-tap -l 42 --text "example"
   ```

5. **Opt-in XCTest control mode**: input and screenshots go through WebDriverAgent, built with your Xcode and Apple team, instead of the Bluetooth mouse and keyboard. Use it for system alerts that ignore the Bluetooth pointer. Needs Developer Mode. Same commands; a command the mode cannot do fails with `unsupported-in-mode`. Guide: https://ghosthand.dev/docs/xctest-mode

   ```bash
   ghosthand control -l 42 xctest
   ghosthand control -l 42 bluetooth
   ```

6. **`screenshot --native`** takes a real iOS screenshot (cmd+shift+3) and reads it over USB. It shows dialogs that USB capture hides.

7. **`key home` clicks AssistiveTouch mouse button 3.** Map it to Home once: Settings > Accessibility > Touch > AssistiveTouch > Devices > this Mac > Customize Additional Buttons. The old keyboard Home key is now `key menu`. `key cmd+space` opens Spotlight, the fast way to open any app:

   ```bash
   ghosthand key -l 42 cmd+space
   ghosthand type -l 42 Files
   ghosthand key -l 42 enter
   ```

8. **Swipes scroll lists on iOS 17 and later.** Before, a swipe with Perform Touch Gestures on acted as a long press at its start point.

9. **Faster typing and smoother pointer moves.** About 43 ms per character, down from 60. Taps still land on the exact target.

10. **Photos permission survives updates**: Ghosthand.app keeps its macOS permission grants after a rebuild or npm upgrade.

11. **`screenshot --native` no longer returns black images** when iOS is still writing the file.

## 0.6.0

1. **Breaking: new Bluetooth report map. Every iPhone must forget the Mac and pair again.** The old map dropped key and button values above 127, so the Globe key never reached the iPhone. Forget the Mac on the iPhone, then pair again (`ghosthand forget --help`).

2. **`fn` (Globe) key and combos**: `fn` is a modifier, `key fn` alone is a Globe tap. Keys in a combo go down in order, so Full Keyboard Access commands like `tab+h` work:

   ```bash
   ghosthand key -l 42 fn+h      # Home Screen
   ghosthand key -l 42 fn+up     # App Switcher
   ghosthand key -l 42 fn+c      # Control Center
   ghosthand key -l 42 fn+n      # Notification Center
   ghosthand key -l 42 dnd       # Do Not Disturb
   ```

   `key --help` now lists the iOS shortcuts that work on iPhone, e.g. `cmd+a` then `backspace` clears a field, `alt+backspace` deletes the previous word.

3. **Horizontal scroll**: `scroll left|right` for carousels and wide tables. Also in the HTTP API and MCP:

   ```bash
   ghosthand scroll -l 42 right 3 --at 207,400 --screentext
   ```

4. **The daemon starts at login**: `ghosthand setup` adds it to Login Items as a LaunchAgent. launchd restarts it after a crash; `daemon stop` keeps it stopped. Turn it off in System Settings > General > Login Items; setup does not add it again. Skipped when `GHOSTHAND_SERVER` is set.

5. **`app` and `setup` windows open in front**: they start as Ghosthand.app and take focus, also when a window is already open. Activity Monitor shows the daemon as `ghosthand-daemon`.

6. **`daemon status` prints the log path**. When a command fails without a clear reason, read the log:

   ```bash
   tail -n 100 ~/.ghosthand/daemon.log
   ```

7. **Clearer remote MCP error when no Mac is connected**: it says to run `npx ghosthand setup` on the Mac with the iPhone and sign in with the same Google account.

## 0.5.0

1. **Breaking: every lease needs a ghosthand.dev account.** Sign the Mac in once with Google; the setup window's first step does it, or run:

   ```bash
   ghosthand login     # opens the browser, waits for approval
   ghosthand account   # who is signed in, the plan, the subscribe link
   ghosthand logout
   ```

   New accounts get 7 days free, then $99/month. Only `acquire` and `wait` check the plan; a running lease is never stopped. Without a plan, `acquire` fails with `subscription-required` and prints the subscribe link.

2. **Remote MCP for every Mac of your account**: add `https://ghosthand.dev/mcp` as a remote MCP server and sign in with Google. It reaches every signed-in Mac:

   ```bash
   claude mcp add --transport http ghosthand https://ghosthand.dev/mcp
   ```

   `list` shows each iPhone under its Mac. Leases name their Mac (`studio:42`), so later calls go to the right one. With several Macs online, pass `mac` to `acquire`.

3. **Breaking: `ghosthand mcp` (stdio) is removed.** Use the remote MCP URL above.

4. **Breaking: `--tunnel` is removed.** A signed-in daemon always keeps its connection to ghosthand.dev, authenticated by the Mac's session; there is no secret URL anymore. Signing the Mac out closes it. `GHOSTHAND_TUNNEL_ID` is gone.

5. **New `random` command**: make a name, last name, username, birthdate (18+) or password for a new account. Every value is saved with the lease's reason and iPhone, so a lost value can be found again:

   ```bash
   ghosthand random -l 42 name       # e.g. Emma
   ghosthand random -l 42 password
   ghosthand random list
   ```

6. **`list` shows the SIM phone number** after the iOS version, when the carrier wrote it to the SIM. Also in the API as `phoneNumber`.

7. **Remote leases remember their URL**: `acquire --url <url>` prints a lease like `r1`. Later commands need only `-l r1`, no `--url`:

   ```bash
   ghosthand --url https://mac.local:7420 --token secret acquire --reason "reply to Anna"
   # r1
   ghosthand screenshot -l r1 -o s.png
   ghosthand release -l r1
   ```

   The URL and token are saved in `~/.ghosthand/remote-leases.json` (mode 0600). A forgotten `--url` can no longer reach a lease with the same number on the local daemon.

## 0.4.0

1. **Remote access with `--tunnel`**: reach the daemon from anywhere at a secret URL. No open port, no certificate, works behind NAT:

   ```bash
   # on the Mac with the iPhones
   ghosthand daemon start --tunnel
   # tunnel: https://ghosthand.dev/tunnel/3f9c0a6e8b2d4f71a5c3e9d07b16f4a2

   # anywhere else
   ghosthand --url https://ghosthand.dev/tunnel/3f9c0a6e8b2d4f71a5c3e9d07b16f4a2 list
   ghosthand mcp --url https://ghosthand.dev/tunnel/3f9c0a6e8b2d4f71a5c3e9d07b16f4a2
   ```

   The daemon opens a WebSocket to ghosthand.dev; requests and streamed responses go through it. **The URL is the password**: whoever has it can use every iPhone on the Mac. `ghosthand daemon restart --tunnel` makes a new URL. Set `GHOSTHAND_TUNNEL_ID` (`openssl rand -hex 16`) to keep one URL across stops. Browsers are rejected.

2. **Ghosthand.app**: the daemon now runs as `~/Applications/Ghosthand.app` with its own icon. macOS Camera and Bluetooth permissions belong to Ghosthand, not to the terminal or editor that started it. Open **Ghosthand** from Spotlight to show the control plane window.

3. **New `setup-status` command**: agents poll setup readiness as JSON while the user follows the setup window. Missing permissions and incomplete setup are normal results, not errors:

   ```bash
   ghosthand setup
   ghosthand setup-status --device "Tommy's iPhone"   # poll every 2 s until "ready": true
   ```

   The setup window now asks for Camera and Bluetooth permission first, with buttons the user clicks. Normal commands never open permission dialogs. Also an MCP tool with the same name.

4. **AssistiveTouch goes off after every lease**, also when it was on before `acquire`, so the person gets the phone back without a pointer. New `--keep-assistivetouch` flag leaves it on:

   ```bash
   ghosthand release -l 42 --keep-assistivetouch
   ```

5. **Daemon upgrades itself**: after you update the CLI, the next command restarts the local daemon on the new binary, only when no lease is active. `ghosthand mcp` checks the daemon before each request and restarts a daemon that does not answer.

6. **API Reference on ghosthand.dev**: every HTTP endpoint with examples, CLI and curl samples. The OpenAPI spec is stricter: request bodies with unknown keys get `400 invalid-request`, and a tap body is either `{x, y}` or `{text, index}`.

7. **Screen capture stops 1 s after the last screenshot** (was 30 s): an idle daemon uses no CPU for capture, and iOS stops sending its sound to the Mac. A screenshot takes about 0.3 s.

8. **Keep-awake skips locked iPhones**: on iOS 18 the key lit the Lock Screen. A locked iPhone now turns its display off normally.

9. **Setup window fixes**: the connect step tells you to unlock the iPhone, the setup window closes when it opens the control plane, and the copied agent prompt installs the skill globally (`npx -y skills add https://ghosthand.dev -g -y`).

10. **Fixed a daemon crash when an iPhone is unplugged while capture opens**, and recording logs no longer show up in another agent's command output.

## 0.3.0

1. **MCP server** — every CLI command is now an MCP tool with the same name. `ghosthand mcp` is a stdio MCP server that talks to the local daemon over its unix socket, so no port or token is needed:

   ```bash
   claude mcp add ghosthand -- npx -y ghosthand mcp
   ```

   ```jsonc
   // opencode.json
   { "mcp": { "ghosthand": { "type": "local", "command": ["npx", "-y", "ghosthand", "mcp"] } } }
   ```

   Tool descriptions come from the CLI help. Screenshots come back as image content. Use `ghosthand mcp --url` for a remote daemon.

2. **Screen recording** — record the iPhone screen and sound to a `.mov` or `.mp4` file from the same USB capture. Screenshots, `screentext` and input keep working while it records:

   ```bash
   ghosthand record-start demo.mov --fps 30   # returns at once
   ghosthand tap --text "Settings"
   ghosthand record-stop
   # /Users/me/demo.mov  12.4s  2.1 MB  828x1792  30 fps  sound  stopped by request
   ```

   Stops by itself after `--max-duration` (default 300 s), when the lease ends, or when the daemon stops. `--no-audio` leaves the sound out. With sound, start and stop pause media on the iPhone: start the recording first, then press play.

3. **`ghosthand setup` and `ghosthand app` windows** — `setup` walks one new iPhone through USB trust, unlock and Bluetooth pairing, then gives a prompt to copy for your agent. `app` is a control plane: every iPhone with its status, agent, task, last command, waiting agents and a live screen preview. Agents get a hint to open `setup` when a phone is missing or not paired.

4. **iPhones stay awake** — the daemon sends an idle Left Control key over Bluetooth, so Auto-Lock no longer has to be **Never**. No pointer shows in screenshots and nothing is typed. It stops when the iPhone is unplugged from USB.

5. **AssistiveTouch on acquire, off on release** — `acquire` turns AssistiveTouch on when it is off. `release` (or an expired lease) turns it off again only if ghosthand turned it on. Your own AssistiveTouch setting stays.

6. **More reliable `unlock`** — unlock now uses only the Bluetooth keyboard (Enter, passcode, Enter) and checks the lock state between steps. **Forget and pair each iPhone again** after you update: iOS keeps the old HID report map from pairing, and the lock screen ignores keys from it.

7. **Close invisible system dialogs with `lock` then `unlock`** — some iOS dialogs do not show in USB capture. `lock`, then `unlock` with a confirmed passcode closes them without picking an option:

   ```bash
   ghosthand lock
   secret-provider | ghosthand unlock --stdin
   ```

8. **Tap by text, `--wait-text`, `--screenshot` and `--screentext` now run in the daemon** — same behavior from the CLI and MCP. Errors after an input say `Input sent` and never repeat the input. New error codes `text-not-found` and `wait-text-timeout`.

9. **Browser requests are rejected on the TCP API** — requests with `Origin` or browser `Sec-Fetch-*` headers get 403 even with a valid token, so a web page cannot reach the daemon.

10. **Daemon state survives updates** — `state.db` is migrated in place. Leases, device matches, pointer settings and the lease counter are kept.
