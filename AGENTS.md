# Device access

- `.passcode` is stale. Never read, print, upload, or commit its contents. Use only a user-confirmed Sigillo `IPHONE_PASSCODE` if unlocking is needed; never print secrets or put them in command arguments.
- Take a lease first: `.build/debug/ghosthand acquire --label <session id> --reason "<task>"` prints a short ID, e.g. `42`. Pass `-l 42` explicitly to every device command, including `release`. Tool-call environments may not persist; do not rely on an exported `GHOSTHAND_LEASE`.
- Always pass `--reason` with your task. If another session holds it, acquire fails and shows its reason and last command: give up or tell the user, or run `ghosthand wait --reason "<task>" --timeout 600`. Never `--force`. The label is only display text; it does not resume a lease. Leave the phone unlocked and run `ghosthand release -l 42` when done.
- Do not delete or restore `state.db`: its persistent counter prevents old lease IDs from controlling new leases. Lease numbers are coordination IDs, not remote authentication; the tunnel requires an API token.
- For secret text, pipe directly to `ghosthand type -l 42 --stdin`. One final LF or CRLF is removed; other whitespace is preserved. Validate focus first, and never repeat input automatically after a verification timeout.
- Check the iPhone with `ghosthand list` before input. A wrong passcode is not retried because failed attempts count toward lockout.
- Read `docs/system-dialogs.md` before diagnosing untappable system alerts: App Store can show Resume during an active download; hidden capture does not prove rejected input.

# CLI help is the agent manual

Agents learn ghosthand from `ghosthand --help` and `ghosthand <command> --help` before they read the README. So every rule an agent needs to use a command correctly goes into the CLI help, in `Sources/ghosthand/main.swift`:

- `description`: one line, what the command does. Shown in the root command list.
- `details`: usage notes and rules, shown only by `<command> --help`: what the output means, what to do on common errors, limits found in tests (for example "Home Screen labels do not open apps").
- `agentLoopHelp`: the rules for every command (coordinate space, `--screenshot` after actions, leave the phone unlocked). Shown by `ghosthand --help`.

When you find a new limit or a rule while testing on a real iPhone, add it to the matching command's `details` first, then to the README if a human needs it too. Keep help text short and concrete: say what to do, not only what went wrong.

# Two front ends: CLI and MCP

The daemon has two thin front ends over the same `Controller` calls. Keep them equal:

```
ghosthand CLI (main.swift) ──HTTP /v1/... (api.swift, openapi.yaml), unix socket──────────────┐
                                                                                             ├──> Controller
MCP client ──POST ghosthand.dev/mcp (OAuth)──────────> per-user hub (website/src/tunnel.ts) ──WS──> │
script ──ghosthand.dev/macs/<mac>/v1/... (API token)─>    tunnel.sock ──/mcp (MCPServer), /v1 (API)──┘
```

There is no TCP listener. Remote access is only the tunnel: the daemon keeps a WebSocket to ghosthand.dev while the Mac is signed in (`tunnel.swift`, authenticated by the Mac's session token). The hub routes MCP calls to one Mac by the lease prefix (`studio:42`) or the `mac` argument, and joins `list` from all Macs. Scripts call the daemon API at `/macs/<mac>/v1/...` with an API token (`ghosthand tunnel url --new-token`, better-auth api-key plugin). Token routes (`/v1/tunnel/tokens`) work on the unix socket only. The protocol and the tools live in the daemon; the hub only authenticates and routes.

The CLI only talks to its local daemon (no `--url`). On the unix socket, `LeaseRoutingMiddleware` (`api.swift`) sends a lease of another Mac (`studio:42`) and an acquire of a phone that only another Mac has to that Mac, via `Tunnel.forward` with this Mac's session token (`/macs/<mac>/v1/...`). `GET /v1/devices` there joins the other Macs' phones (`Tunnel.otherMacs`), each with `mac`.

```
CLI ──daemon.sock──> daemon (laptop) ──/macs/studio/v1/..., session token──> hub ──WS──> daemon (studio)
```

- **Lease ids:** `42` for a phone acquired on the unix socket of its own Mac; `<mac>:<n>` for every lease taken through the hub (MCP, tunnel REST, other Macs). Every daemon accepts its own prefix and strips it (`LeaseTarget`).
- Remote phones of a daemon without `mac` in `/v1/devices` (older version) are skipped: its leases would come back without the prefix and hit the wrong Mac.

- **Logic goes in the daemon**, never in a front end. If the CLI or a tool needs OCR, polling, retries or matching, add it to `Controller` and expose it on the HTTP route, so both front ends share it. The CLI and MCP tools only parse arguments, call routes or `Controller` methods, and format results; selection, sorting, waiting and retries stay in the daemon (`photo pull` asks the daemon for the newest photos, then downloads each). Formatters both use (`fileLines`, `appLines`, `deviceInfoLines`) live in `api.swift`.
- **Remote access is to the phone, not the Mac filesystem.** MCP sends file bytes, never Mac source or destination paths. Local CLI paths stay local. Uploaded bytes are downloads, never executable documents on the account's web origin.
- **One manual for both.** MCP tool descriptions and instructions are built from the CLI help (`mcpDocs()` in `main.swift`): `description`, `details`, option names, `examples`, `agentLoopHelp`. Write help text there, never a second copy in `mcp.swift`.
- **A new route or capability gets both.** Add the HTTP route (`openapi.yaml` + `api.swift`), the CLI command or flag (`main.swift`), and the MCP tool or argument (`tools` in `mcp.swift`) in the same change. A tool name is the CLI command name, words joined by `-` (`file push` is the tool `file-push`, see `MCPDocs.toolName`).
- **A new CLI flag needs its MCP argument:** add it to the tool's `properties`, and to `MCPDescription.arguments` (flag -> argument) or `MCPDescription.positionals`. Otherwise its examples are dropped from the tool description without an error.
- **Leases in MCP carry the Mac:** print them with `MCPArgs.remote`, read them with `MCPArgs.lease`. The hub sends the Mac slug in the `ghosthand-mac` header.
- **Check both:** `swift test` covers the MCP protocol, lease prefixes and the description conversion. For a real check, run `pnpm dev` in website/, start the daemon with `GHOSTHAND_SERVER=http://localhost:8047`, and connect `npx @modelcontextprotocol/inspector` to http://localhost:8047/mcp.

# USB device services (files, photos, apps, info)

`lockdown.swift` talks to iOS lockdown services through the private MobileDevice.framework: AFC (files), house_arrest (app Documents), installation_proxy (apps), springboardservices (Home Screen layout), diagnostics_relay (restart), syslog_relay. `device-management.swift` has the `Controller` methods.

- **No Developer Mode features over lockdown.** Only services a trusted Mac can start (pairing only). Launching apps, GPS simulation, pasteboard and DVT need Developer Mode plus a disk image: do not add them. The one exception is the opt-in XCTest mode below, which goes through Xcode.
- **Never shell out to pymobiledevice3** at run time. Read its source for protocols: https://github.com/doronz88/pymobiledevice3 (`services/afc.py`, `installation_proxy.py`, `springboard.py`, `diagnostics.py`).
- **Never remove /DCIM files over AFC**: Photos keeps a broken entry (tested on iOS 18.6). Delete photos with `PhotoLibrary.delete` (ImageCaptureCore, like Image Capture.app). It needs the optional macOS removable volumes access (setup's Allow Photos); commands check it with `TCCAccessPreflight` and never trigger the dialog.
- **AFC to /DCIM does not add a photo to Photos.** No USB path adds one without an app on the iPhone; see `docs/send-media.md` (served at https://ghosthand.dev/docs/send-media, linked from `file` help).

# Control modes: Bluetooth and XCTest

Input goes through a `PhoneDriver` (controller.swift). Each iPhone has one mode in state.db (an `xctest_phone` row means XCTest):

```
Controller ──▶ PhoneDriver ─┬─▶ BluetoothDriver (bluetooth-driver.swift)  default: HID mouse + keyboard, AssistiveTouch
                            └─▶ XCTestDriver (xctest-driver.swift)        WebDriverAgent over usbmux :8100, also screenshots
```

- **Same commands in both modes.** A command a mode cannot do throws `unsupported-in-mode` from its driver. Never add a separate command namespace for a mode.
- **Drivers only send input.** Lock-state checks, OCR, settle, waitText and coordinate conversion stay in the Controller. Positions reach drivers as 0...1 fractions of the driver's screen (`PhoneDriver.screen`: a USB capture frame in Bluetooth mode, WebDriverAgent's screenshot size and scale in XCTest mode).
- **The control mode is keyed by UDID only** (`xctest_phone`, no FK to the capture match). Bluetooth starts only when a USB iPhone uses Bluetooth mode, or on the first Bluetooth command.
- **XCTest mode is opt-in**: `ghosthand control -l <id> xctest`, or the setup window. Its choice shows only for iPhones with Developer Mode on (`PhoneStatus.developerMode`), or with `ghosthand setup --xctest`. WDA is built from a pinned source tag with the user's Xcode team and kept alive by `xcodebuild test-without-building`. Read `docs/xctest-mode.md` before changing it.
- **Shared WDA source installs atomically**, under one lock across phones. HTTP reads and writes use the remaining request deadline, including fractions of a second.
- **XCTest subprocesses have a pipe-owned supervisor.** Closing the daemon's pipe stops the whole process group, including after a crash. Shutdown cancels builds before waiting for lifecycle locks.

# Relative pointer (iOS 15)

Read `docs/relative-pointer.md` before changing relative pointer code: the acceleration table, the measurements, and the timing rules (150 ms after homing, 100 ms before a press).

# Scroll (HID wheel)

Read `docs/scroll.md` before changing `scroll`: why iOS drops the first 2 wheel reports (IOHIDScrollAccelerator), the lead-in, and the measured points per tick.

# Reference sources

Read these before guessing how iOS handles HID input:

- [IOHIDFamily](https://github.com/apple-oss-distributions/IOHIDFamily/tree/IOHIDFamily-1787.140.2) (Apple open source): how iOS turns HID reports into events: scroll acceleration, pointer, descriptor parsing.
- [iOS 18.2 decompiled system binaries](https://github.com/EthanArbuckle/iPhone17-1_18.2_22C152_Restore) (HID plugins under `System/Library/HIDPlugins`): check that iOS ships the same code as the open source.
- [egarl004/mirrordeck](https://github.com/egarl004/mirrordeck): same design as ghosthand (Mac as Bluetooth Classic HID, iPhone with AssistiveTouch). Descriptors, absolute + relative reports, wheel.
- [yoyicue/glassbox wheel notes](https://github.com/yoyicue/glassbox/blob/main/docs/reference/picokvm_ipad_wheel.md): HID wheel on iPad/iPhone over a USB gadget (PicoKVM).

To find code, search one unique function name or constant (`gh search code 'IOHIDScrollAccelerator'`), not sentences.

# Publishing to npm

`npm/` is the `ghosthand` npm package: one universal binary (arm64 + x86_64) as the bin.

- Bump `version` in `npm/package.json` and `ghosthandVersion` in `Sources/ghosthand/daemon.swift` together. The build fails if they differ.
- Publish with `cd npm && pnpm publish --no-git-checks`. Do not run `pnpm build` first: `prepublishOnly` cleans `dist` and runs the full build (about 3 min).
- The registry can take ~5 min before `npx ghosthand@<version>` resolves. Poll `curl -s https://registry.npmjs.org/ghosthand | jq '."dist-tags"'`; do not publish again.
- Build from the committed tree: `prepublishOnly` compiles whatever Swift code is in the working tree, including uncommitted changes from other sessions.

# Account and billing

Every lease needs a ghosthand.dev account with a trial or plan. The daemon owns it (`Sources/ghosthand/account.swift`); the setup app and CLI only call the daemon.

Remote MCP uses resource-bound opaque OAuth tokens, checked against current grants and sessions. Before deleting a session, delete its refresh grants (revoked-token reuse can end other sessions' grants); then close its hub sockets. Hub session deadlines use alarms, not polling, so idle sockets still hibernate.

```
setup app / ghosthand account login ──POST /v1/account/login──> daemon ──POST /api/cli/login──> website
browser approves /device ─────────────────────────────> daemon polls /api/cli/login/token
acquire ──> Account.authorizeLease() ──GET /api/cli/account──> plan from website/src/lib/billing.ts
```

- The daemon never computes trial dates: the server answers `allowed` and a `notice`. Only acquire and wait check, so a running lease is never stopped. Unreachable server: the lease is allowed (fail-open).
- `GHOSTHAND_SERVER` at daemon start picks the server (default https://ghosthand.dev; `http://localhost:8047` for `pnpm dev` in website/). A saved account counts only for its own server. Restart the daemon after changing it.
- Orgs: identity (sessions, OAuth tokens) belongs to the user; the plan, the trial (`org.createdAt`) and the Mac hub (`getHub(orgId)`) belong to the org. A signup hook creates a personal org with `org_id = user.id`. Always resolve it with `getPersonalOrg(userId)` (through `org_member`); never pass a user id as an org id, or team orgs break later.
- Website: `db/` has the D1 schema (drizzle). Stripe rows store their Stripe account id; today the account is shared with Playwriter (sigillo project `website` in the `ghosthand` org).

# CLI and MCP docs (website)

The website's CLI and MCP tabs are generated from the binary, never written by hand:

```
ghosthand docs-json <file> (main.swift: docsJSON) ──> website/scripts/generate-docs.ts
   ├─> website/src/docs/cli/*.md   one page per command (frontmatter, usage, options, details)
   ├─> website/docs.jsonc          CLI tab groups, between the // cli-pages markers
   └─> website/mcp-tools.json      MCP tab, read by holocron (tools/list shape)
```

- Run `pnpm generate-docs` in website/ after changing any command, option, help text or MCP tool, and commit the output.
- A new command lands in the "Other" group until you add it to `groups` in the script.
- `docs-json` never needs a daemon or an iPhone. It writes to a file because opening the state DB logs to stdout.

# Demo videos

`promo-video/` is a motion design promo rendered from plain HTML with headless Chrome (`seek(t)` per frame, no Remotion). Read `promo-video/README.md` first.

`demo-video/` is a Remotion package for 16:9 promo videos: a ghosthand screen recording (left) next to an animated Claude Code style terminal (right). Record with `record start` plus a `log.jsonl` of every command, then `scripts/prepare.ts` speeds up the recording and writes `timeline.json`. Read `demo-video/README.md` first.
