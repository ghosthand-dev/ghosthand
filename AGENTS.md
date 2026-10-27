# Daemon submodule

The Swift daemon and the private skills live in `daemon/`, the private submodule
[ghosthand-dev/ghosthand-daemon](https://github.com/ghosthand-dev/ghosthand-daemon) (Pro
subscribers get read access). Everything else in this repo is public.

```
ghosthand-dev/ghosthand (public)   website/  db/  npm/  docs/  skills/ghosthand/ (base skill)
└── daemon/ ──submodule──> ghosthand-dev/ghosthand-daemon (private)
                           Package.swift  Sources/  Tests/  skills/ (private skills)  AGENTS.md
```

- **Read `daemon/AGENTS.md`** before editing anything in `daemon/`: the Swift internals (CLI help, USB services, control modes, pointer, scroll, UI testing) are documented there.
- **Keep `daemon/` on branch `main`, never a detached HEAD.** `git -C daemon branch --show-current` must print `main` before you edit or commit there. After a clone or a detached checkout: `git submodule update --init && git -C daemon switch main && git -C daemon pull`. If commits were made on a detached HEAD, switch to `main` and `git merge <sha>` them; never leave them dangling.
- `.gitmodules` sets `branch = main` and `update = merge`, so `git submodule update` merges the recorded commit into `main` instead of detaching. Never run `git submodule update --checkout`.
- **Never copy** daemon code, private skill text or `daemon/AGENTS.md` content into the public repo, its issues or PRs. Public docs describe behavior, not Swift code.
- At session start also run `git -C daemon status -s -u` and `git -C daemon diff`.
- **Commit order:** commit and push in `daemon/` first, then commit the new pointer in the root (`git add daemon`) and push. Never commit or push a pointer to a daemon commit that is not on `origin/main`.
- Both commits carry the `Session:` and `Discord:` trailers. The root commit says in one line what the daemon change does.
- After `git pull` in the root, run `git submodule update` (it merges into `main`). Do not commit a pointer that moved only because of a pull together with unrelated work.
- Critique: run it inside `daemon/` for daemon commits (`bunx critique --commit <sha> --web ...`), and in the root for the pointer.
- **Builds without the submodule:** the website typechecks, tests, builds and deploys from committed files (`website/openapi.yaml`, `website/mcp-tools.json`, `website/src/generated/daemon-api.ts`, `skills/ghosthand/SKILL.md`). `pnpm generate-docs` and `npm/scripts/build.ts` need `daemon/`.
- The old repo `remorses/ghosthand` is a private archive. `daemon/migration/*-commit-map` map its hashes to the new ones.

# Device access

- `.passcode` is stale. Never read, print, upload, or commit its contents. Use only a user-confirmed Sigillo `IPHONE_PASSCODE` if unlocking is needed; never print secrets or put them in command arguments.
- Take a lease first: `ghosthand acquire --label <session id> --reason "<task>"` prints a short ID with its Mac, e.g. `studio:42` (examples below write `42`). Pass `-l studio:42` explicitly to every device command, including `release`. Tool-call environments may not persist; do not rely on an exported `GHOSTHAND_LEASE`.
- Always pass `--reason` with your task. If another session holds it, acquire fails and shows its reason and last command: give up or tell the user, or run `ghosthand wait --reason "<task>" --timeout 600`. Never `--force`. The label is only display text; it does not resume a lease. Leave the phone unlocked and run `ghosthand release -l 42` when done.
- Do not delete or restore `state.db`: its persistent counter prevents old lease IDs from controlling new leases. Lease numbers are coordination IDs, not remote authentication; the tunnel requires an API token.
- For secret text, pipe directly to `ghosthand type -l 42 --stdin`. One final LF or CRLF is removed; other whitespace is preserved. Validate focus first, and never repeat input automatically after a verification timeout.
- Check the iPhone with `ghosthand list` before input. A wrong passcode is not retried because failed attempts count toward lockout.
- Read `docs/system-dialogs.md` before diagnosing untappable system alerts: App Store can show Resume during an active download; hidden capture does not prove rejected input.

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

- **Always more than one Mac:** every lease is `<mac>:<n>` while the Mac has a slug (only a signed-out Mac returns `42`), `list` always groups iPhones under `mac <slug>:`, and the control plane always shows each phone's Mac. Every daemon accepts its own prefix and strips it (`LeaseTarget`); the plain `42` still works on its own Mac. The slug stays while the tunnel reconnects (cleared on account change), and the first requests after a daemon start wait for it (`Tunnel.waitConnected`).
- Remote phones of a daemon without `mac` in `/v1/devices` (older version) are skipped: its leases would come back without the prefix and hit the wrong Mac.
- **Never send tunnel messages on a timer.** Every message wakes the hub Durable Object, which costs wake time and money. Send only when something changed (e.g. `phones`: the daemon checks locally, sends on change, the hub relays and stores it). The 30 s ping is the only exception: the edge answers it without waking the DO.
- **Periodic daemon work goes in `Controller.startUpkeep`** (one 2 s timer, `controller.swift`). Add a step there, at a multiple of its tick, instead of a new timer or sleep loop. Left out on purpose: the startup screen capture restarts (`daemon.swift`, tested 5.5 s timing), the Bluetooth stack tick (`bluetooth-hid.swift`), per-request SSE pings and the tunnel ping.

- **Logic goes in the daemon**, never in a front end. If the CLI or a tool needs OCR, polling, retries or matching, add it to `Controller` and expose it on the HTTP route, so both front ends share it. The CLI and MCP tools only parse arguments, call routes or `Controller` methods, and format results; selection, sorting, waiting and retries stay in the daemon (`photo pull` asks the daemon for the newest photos, then downloads each). Formatters both use (`fileLines`, `appLines`, `deviceInfoLines`) live in `api.swift`.
- **Wait for the screen, not for the clock.** After an input the daemon measures the screen to know when to answer: `settledFrame` compares USB frame thumbnails with the screen before the input (`InputMark`, pointer spots masked) and returns once it reacted and stood still. A fixed sleep is only for HID timing that iOS needs (press length, pointer settle), never for "the app may still be loading". The task agent, MCP and CLI get the same wait because it lives in `Controller`, not in a client.
- **Remote access is to the phone, not the Mac filesystem.** MCP sends file bytes, never Mac source or destination paths. Local CLI paths stay local. Uploaded bytes are downloads, never executable documents on the account's web origin.
- **One manual for both.** MCP tool descriptions and instructions are built from the CLI help (`mcpDocs()` in `main.swift`): `description`, `details`, option names, `examples`, `agentLoopHelp`. Write help text there, never a second copy in `mcp.swift`.
- **A new route or capability gets both.** Add the HTTP route (`openapi.yaml` + `api.swift`), the CLI command or flag (`main.swift`), and the MCP tool or argument (`tools` in `mcp.swift`) in the same change. A tool name is the CLI command name, words joined by `-` (`file push` is the tool `file-push`, see `MCPDocs.toolName`).
- **A new CLI flag needs its MCP argument:** add it to the tool's `properties`, and to `MCPDescription.arguments` (flag -> argument) or `MCPDescription.positionals`. Otherwise its examples are dropped from the tool description without an error.
- **Leases in MCP carry the Mac:** print them with `MCPArgs.remote`, read them with `MCPArgs.lease`. The hub sends the Mac slug in the `ghosthand-mac` header.
- **Check both:** `swift test` in `daemon/` covers the MCP protocol, lease prefixes and the description conversion. For a real check, run `pnpm dev` in website/, start the daemon with `GHOSTHAND_SERVER=http://localhost:8047`, and connect `npx @modelcontextprotocol/inspector` to http://localhost:8047/mcp.

# Publishing to npm

`npm/` is the `ghosthand` npm package: the signed `Ghosthand.app` (one universal binary, arm64 + x86_64) whose executable is the bin. The same build writes the Mac installer for https://ghosthand.dev/download:

```
npm/scripts/build.ts ──> dist/Ghosthand.app (npm bin) ── --release: Developer ID, hardened runtime, notarized
                     └─> release/Ghosthand-<v>.pkg (current user, ~/Applications, opens the app) + .zip
                         --upload ──wrangler──> R2 ghosthand-releases (pkg, zip, then latest.json)
website: /download page, /download/ghosthand.pkg and /releases/:file read that bucket
```

- Bump `version` in `npm/package.json` and `ghosthandVersion` in `daemon/Sources/ghosthand/daemon.swift` together. The build fails if they differ.
- Publish with `cd npm && pnpm publish --no-git-checks`. Do not run `pnpm build` first: `prepublishOnly` cleans `dist` and runs the full `--release --upload` build with the Sigillo project `macos-release` (Developer ID identities in the keychain, App Store Connect key for notarization), so the installer goes to R2 in the same run (~10 min with notarization).
- **The CLI never signs or assembles a bundle on a user's Mac.** `GhosthandApplication.install` only copies a bundle built by `build.ts` (`GhosthandRelease` in Info.plist) as is, and never over a newer installed release. Every build is signed with our Developer ID (bundle id + team), so macOS permissions stay across npm, installer and dev builds. `~/.ghosthand/app-source` records which bundle was copied, so a rebuild of the same source restarts the daemon.
- Signing reads the Developer ID `.p12` files from Sigillo `macos-release` into a temporary keychain (`signingKeychain()`). Without them the build is ad-hoc and the pkg unsigned: enough to inspect (`pkgutil --expand`), not to ship. Load the `apple-code-signing` skill for certificates, notarization and Gatekeeper checks.
- The registry can take ~5 min before `npx ghosthand@<version>` resolves. Poll `curl -s https://registry.npmjs.org/ghosthand | jq '."dist-tags"'`; do not publish again.
- Build from the committed tree: `prepublishOnly` compiles whatever Swift code is in the working tree, including uncommitted changes from other sessions.

# Dev builds

`swift build` alone is not runnable against the daemon (a bare binary cannot install). Build the dev app, then use its executable (the global `ghosthand` wrapper on Tommy's Macs points there):

```bash
cd npm && sigillo run -- node scripts/build.ts --dev   # daemon/.build/Ghosthand.app, Developer ID, ~20 s
daemon/.build/Ghosthand.app/Contents/MacOS/ghosthand list   # copies it to ~/Applications, restarts the daemon
```

# Account and billing

Every lease needs a ghosthand.dev account with a trial or plan. The daemon owns it (`daemon/Sources/ghosthand/account.swift`); the setup app and CLI only call the daemon.

Remote MCP uses resource-bound opaque OAuth tokens, checked against current grants and sessions. Before deleting a session, delete its refresh grants (revoked-token reuse can end other sessions' grants); then close its hub sockets. Hub session deadlines use alarms, not polling, so idle sockets still hibernate.

```
setup app / ghosthand account login ──POST /v1/account/login──> daemon ──POST /api/cli/login──> website
browser approves /device ─────────────────────────────> daemon polls /api/cli/login/token
acquire ──> Account.authorizeLease() ──GET /api/cli/account──> plan from website/src/lib/billing.ts
```

- The daemon never computes trial dates: the server answers `allowed` and a `notice`. Only acquire and wait check, so a running lease is never stopped. Unreachable server: the lease is allowed (fail-open).
- `GHOSTHAND_SERVER` at daemon start picks the server (default https://ghosthand.dev; `http://localhost:8047` for `pnpm dev` in website/). A saved account counts only for its own server. Restart the daemon after changing it.
- Orgs: identity (sessions, OAuth tokens) belongs to the user; the plan, the trial (`org.createdAt`) and the Mac hub (`getHub(orgId)`) belong to the org. A signup hook creates a personal org with `org_id = user.id`. Always resolve it with `getPersonalOrg(userId)` (through `org_member`); never pass a user id as an org id, or team orgs break later.
- Website: `db/` has the Postgres schema and migrations (drizzle). The database is PlanetScale Postgres `ghosthand` (org `clamordev`, us-east, PS-5 single node, billed through Cloudflare), reached through Hyperdrive with caching off; preview uses the same database. Migrate with `pnpm db:migrate:prod` in website/ (Sigillo prod `DATABASE_URL`). Local dev and tests use the local Postgres (Sigillo dev `DATABASE_URL`, tests create a throwaway database). `getDb()` pools close idle sockets after 1 s: an open socket keeps a Durable Object from hibernating. Stripe rows store their Stripe account id; today the account is shared with Playwriter (sigillo project `website` in the `ghosthand` org).

# Phone tasks (agent on ghosthand.dev)

`ghosthand task -l 42 "open the TikTok likes tab"` (also MCP `task`, `POST /v1/leases/{lease}/task`) runs a fast agent on the website. The daemon only starts the turn and passes the AI SDK UI message stream through unchanged.

```
daemon (task.swift) ──POST /api/cli/tasks {id, lease: "<mac>:42", messages}, session token──> GhosthandTask DO (website/src/task.ts)
   ◀── SSE `data: <UIMessageChunk>` ... `data: [DONE]` ──────────────────────────────────────  │ streamText (task-agent.ts)
                                                                                                │ tools: openapi-fetch over hub.daemonFetch
this or another Mac's daemon /v1/leases/<mac>:42/tap?screentext=true <──WS── GhosthandHub <───┘
```

- **Model:** Vercel AI Gateway (`AI_GATEWAY_API_KEY` in Sigillo), `anthropic/claude-haiku-5.5` with reasoning off and gateway `caching: 'auto'` (Anthropic caches only with breakpoints), `zai/glm-5.3-flash` as fallback. A new prompt to a running task aborts its turn and starts at once (no 409). Measure a change with `website/scripts/task-bench.ts` against a real iPhone before switching.
- **Each tool calls one MCP tool with a few of its arguments** (`TASK_TOOLS`: `screentext`, `screenshot`, `tap` x,y, `tapText` text, `swipe`, `scroll`, `key`, `type`). The model sees the MCP description and argument descriptions from `website/mcp-tools.json`; an argument the MCP tool lacks throws, and a test checks the types. The task sets `lease`, `mac`, `scale`; no `waitText` (the model cannot know the next screen's text) and no OCR `language`. Every input asks for `screenshot=jpeg`, the settled screen (`settledFrame`: still for 150 ms once the screen differs from before the input; up to 1 s for a reaction when it does not, at most ~3 s), so one model step is one action. Screenshot bytes go only to the model (`toModelOutput`), never into the UI stream; history from earlier turns says the image was not kept. They call the daemon REST API, typed from `openapi.yaml` (`website/src/generated/daemon-api.ts`, written by `pnpm generate-docs`). The fake Mac in `task.test.ts` serves `src/fixtures/task-*.jpg`. One more tool, `webfetch`, runs in the Worker (no daemon): the AI SDK web fetch tool (`@ai-sdk/tool-web-fetch`, markdown, cut at 20k characters, `offset` for more); the system prompt lists the ghosthand.dev docs pages to read when stuck. The system prompt also holds the "Phone tips" section of `skills/ghosthand/SKILL.md` (`?raw` import): write phone-use tips there, once, for CLI agents and the task agent.
- **One DO per task**, named `<orgId>:<taskId>`. Rows written are billed (setAlarm and deletes too), so chunks stay in memory and are stored in batches: one row before each tool call (a phone action may follow) and one at the end of the turn. The heartbeat alarm is set once per turn and re-armed only by the alarm. `GET .../stream` follows a running turn (AI SDK resume), `?from=<n>&message=<id>` gives a reconnecting client the rest. A deploy or crash stops a turn; the alarm (or the next resume) continues it and marks unfinished tool calls as interrupted. One day after the last turn the alarm calls `deleteAll()`.
- **Phone context:** each turn sends the leased iPhone (`TaskPhone`: name, model, iOS, language, region), read by `taskTarget` over USB or, for another Mac's lease, from that Mac's `info` route. It goes at the end of the system prompt, so the cached prefix stays the same.
- **Control plane chat** (`chat-panel.swift`): one chat per iPhone; each prompt is acquire, the same `POST /v1/leases/{lease}/task` stream, release. Text shows when its part ends (no streaming text); tool calls are one monospaced line each (`taskToolLabel`, shared with the CLI progress). Check the design with `ghosthand dashboard --foreground --mock chat --snapshot out.png`.
- **Tests:** `website/src/task.test.ts` runs the real model against a scripted Mac (`sigillo run -- pnpm test`).

# Errors and product analytics (Strada)

Both the daemon and the website report to the Strada project `ghosthand` (`strada issues list -p ghosthand`), as services `ghosthand-daemon` and `ghosthand-website`. Load the `strada` skill before touching it.

```
daemon: strada.swift (Swift port of @strada.sh/sdk) <── telemetry.swift: capture, events, hourly usage, crash reports
website: @strada.sh/sdk <── src/telemetry.ts: initStrada, typed trackEvent, reportErrors
```

- **Errors handled inline must still be reported**: `captureException` (website) or `Telemetry.capture` (daemon), with a `handler` or `route` tag. Never swallow one with only `console.error` or `daemonLog`.
- Do not capture errors you rethrow on the website: Spiceflow records them on the request span (its `tracer`), and `/mcp`, `/macs`, `/tunnel/*` run inside `startSpan` (server.tsx). Durable Object alarms and WebSocket messages go through `reportErrors`.
- In the daemon, API and MCP errors go to Strada only when they are `internal-error` or `recording-failed` (`Telemetry.captureIfUnexpected`): the other codes are expected answers.
- **Product events are typed**: add them to `WebsiteEvents` (telemetry.ts) or `Telemetry.Event` (telemetry.swift), never `track()` with a free string. Properties are ids, counts, names and booleans: never prompts, typed text, screen text or tokens. Update the Telemetry section of website/src/docs/privacy.mdx when what is sent changes.
- The daemon never ships a Strada token (ingest is anonymous); `STRADA_TOKEN` is a website secret in Sigillo.
- **Daemon traces are opt-in:** `launchctl setenv GHOSTHAND_TRACES 1`, then `ghosthand daemon stop && ghosthand daemon start` (`restart` keeps the old env). Each API call is a trace with spans for `input.send`, `hid.tap`, `screen.before`, `screen.settle` (attrs `settle.before_diff`, `settle.reaction_ms`), `image.encode` and `ocr`. Read them with `strada traces list -p ghosthand -s ghosthand-daemon --json`, then `strada traces view <32-hex id> -p ghosthand --attrs 20`. Polled routes (`Telemetry.uncounted`) are never traced.

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

`promo-video/` has motion design videos rendered from plain HTML and three.js with headless Chrome (`seek(t)` per frame, no Remotion): the 2D promo (`src/video.ts`) and the toon-shaded 3D launch video (`src/launch.ts`). Read `promo-video/README.md` first.

`demo-video/` is a Remotion package for 16:9 promo videos: a ghosthand screen recording (left) next to an animated Claude Code style terminal (right). Record with `record start` plus a `log.jsonl` of every command, then `scripts/prepare.ts` speeds up the recording and writes `timeline.json`. Read `demo-video/README.md` first.
