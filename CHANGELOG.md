# Changelog

## 0.7.0

0. **Scripts on any computer: the HTTP API through the tunnel. Breaking: the TCP listener is gone.** While a Mac is signed in, its API is at `https://ghosthand.dev/macs/<mac>/v1/...`, with an API token. No port, no TLS files:

   ```bash
   ghosthand tunnel url --new-token --name ci   # prints export lines for GHOSTHAND_URL and GHOSTHAND_TOKEN
   curl -H "Authorization: Bearer $GHOSTHAND_TOKEN" $GHOSTHAND_URL/v1/devices
   ghosthand tunnel revoke <id>
   ```

   Removed: `daemon start --port/--host/--tls-cert/--tls-key/--token` and `--ca` / `GHOSTHAND_CA`. Use `tunnel url`. Lease ids: bare number on the CLI and HTTP API (`r1` on another computer), `studio:42` over MCP only.

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
