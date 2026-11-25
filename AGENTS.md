# Daemon submodule

Active plan: `plans/virtual-iphone.md`. Read it before starting work on virtual iPhone support.
Active plan: `plans/cloud-phones.md`. Read it before starting work on rented cloud phones.
Decisions: `plans/decisions/`. Search them before designing or refactoring.

**VPhone submodule:** `vphone/` is our private VPhone fork, [remorses/vphone-cli-private](https://github.com/remorses/vphone-cli-private),
branch `ghosthand` (upstream Lakr233/vphone-cli). It holds the cloud phone host side
(`vphone-cli fleet serve`, hosted isolation, proxy). Read `vphone/AGENTS.md` before editing it.
Same rules as `daemon/`: keep it on `ghosthand`, never a detached HEAD; commit and push inside
`vphone/` first, then commit the pointer here. Build the bundle on a Mac with Xcode; VMs run on
mintmacbook (no Xcode, no GitHub credentials: copy builds over SSH). The website never needs it.

The Swift daemon and the private skills live in `daemon/`, the private submodule
[ghosthand-dev/ghosthand-daemon](https://github.com/ghosthand-dev/ghosthand-daemon) (Pro
subscribers get read access). Everything else in this repo is public.

```
ghosthand-dev/ghosthand (public)   website/  db/  npm/  docs/  skills/ghosthand/ (base skill)
└── daemon/ ──submodule──> ghosthand-dev/ghosthand-daemon (private)
                           Package.swift  Sources/  Tests/  skills/ (private skills)  AGENTS.md
```

- **Read `daemon/AGENTS.md`** before editing anything in `daemon/`: the Swift internals (CLI help, USB services, control modes, pointer, scroll, UI testing) are documented there.
- **Keep `daemon/` on branch `main`, never a detached HEAD.** `git -C daemon branch --show-current` must print `main` before you edit or commit there. After a clone, a new worktree or a detached checkout: `git submodule update --init && git -C daemon switch main && git -C daemon pull`. If commits were made on a detached HEAD, switch to `main` and `git merge <sha>` them; never leave them dangling.
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
- **Wait for the screen, not for the clock.** After an input the daemon measures the screen to know when to answer: `settledFrame` compares USB frame thumbnails with the screen before the input (`InputMark`, pointer spots masked) and returns once it reacted and stood still. An input sent right after another one without a settled screenshot first waits for that settle (`settleBeforeInput`, Bluetooth mode), so chains like `key cmd+space && type TikTok` never type into an opening Spotlight. A fixed sleep is only for HID timing that iOS needs (press length, pointer settle), never for "the app may still be loading". The task agent, MCP and CLI get the same wait because it lives in `Controller`, not in a client.
- **Remote access is to the phone, not the Mac filesystem.** MCP sends file bytes, never Mac source or destination paths. Local CLI paths stay local. Uploaded bytes are downloads, never executable documents on the account's web origin.
- **One manual for both.** MCP tool descriptions and instructions are built from the CLI help (`mcpDocs()` in `main.swift`): `description`, `details`, option names, `examples`, `agentLoopHelp`. Write help text there, never a second copy in `mcp.swift`.
- **A new route or capability gets both.** Add the HTTP route (`openapi.yaml` + `api.swift`), the CLI command or flag (`main.swift`), and the MCP tool or argument (`tools` in `mcp.swift`) in the same change. A tool name is the CLI command name, words joined by `-` (`file push` is the tool `file-push`, see `MCPDocs.toolName`).
- **A new CLI flag needs its MCP argument:** add it to the tool's `properties`, and to `MCPDescription.arguments` (flag -> argument) or `MCPDescription.positionals`. Otherwise its examples are dropped from the tool description without an error.
- **Leases in MCP carry the Mac:** print them with `MCPArgs.remote`, read them with `MCPArgs.lease`. The hub sends the Mac slug in the `ghosthand-mac` header.
- **Onboarding:** every empty state (no Mac, Mac offline, no iPhone, setup not done, plan limit) tells the agent the user's next step; `setup-status` returns it as `next`, also from the hub before any Mac exists. Read `docs/onboarding-flows.md` before changing setup, MCP empty states or their text.
- **Check both:** `swift test` in `daemon/` covers the MCP protocol, lease prefixes and the description conversion. For a real check, run `pnpm dev` in website/, start the daemon with `GHOSTHAND_SERVER=http://localhost:8047`, and connect `npx @modelcontextprotocol/inspector` to http://localhost:8047/mcp.

# Publishing to npm

`npm/` is the `ghosthand` npm package: the signed `Ghosthand.app` (one universal binary, arm64 + x86_64) whose executable is the bin. The same build writes the Mac installer for https://ghosthand.dev/download:

```
npm/scripts/build.ts ──> dist/Ghosthand.app (npm bin) ── --release: Developer ID, hardened runtime, notarized
                     └─> release/Ghosthand-<v>.pkg (current user, ~/Applications, opens the app) + .zip
                         --upload ──wrangler──> R2 ghosthand-releases (pkg, zip, then latest.json)
website: /download page, /download/ghosthand.pkg and /releases/:file read that bucket
daemon updater (updater.swift): hourly latest.json ──newer build──> zip, checked, installed when no lease
```

- **Uploading latest.json ships the release to every Mac**, .pkg and npm alike: daemons with auto-update on download the zip within an hour and install it once no lease is active. Only `--release` builds may reach R2 (the updater requires our notarized Developer ID). Read the "Auto-update" section of `docs/install-paths.md` before changing it.

**Release checklist**, in this order (each outward step needs the user's go):

1. **Website first** when the daemon needs a new route (e.g. `/api/cli/lease-check`): in website/, `pnpm db:migrate:prod`, `pnpm secrets:prod` if Sigillo prod gained a secret, then `pnpm run deploy:prod`. Old daemons must keep working against it; a new daemon against an old website fails.
2. **Bump** `version` in `npm/package.json` and `ghosthandVersion` in `daemon/Sources/ghosthand/daemon.swift` together. The build fails if they differ.
3. **CHANGELOG.md**: a `## <version>` section with numbered, user-facing items (same style as the last one).
4. **Commit and push**: the daemon bump in `daemon/` (on `main`), then the pointer, `npm/package.json` and the changelog in the root. The working tree must be clean: the build compiles it as is.
5. **Publish**: `cd npm && pnpm publish --no-git-checks` (details below). It builds, signs, notarizes and uploads the pkg, zip and `latest.json` to R2 (`wrangler` must be logged in), then publishes to npm.
6. **Tag and GitHub release** in the root: `git tag ghosthand@<version> && git push origin ghosthand@<version>`, then `gh release create ghosthand@<version> -R ghosthand-dev/ghosthand --notes-file <the changelog section>`.
7. **Check**: `cd website && bun scripts/release-check.ts` (exit 1 on any failure). It checks the live site against this checkout (skill, CLI docs), the manifest, notarized pkg and zip, the npm dist-tag and `npx ghosthand@<version> --version`, auth walls, a seeded fuzz of unauthenticated routes (no 5xx; replay with `--seed`), and, with this Mac signed in, every online Mac's daemon through the tunnel and a text upload, using a temporary API token it revokes. `--phone` adds a lease on a free test iPhone (screenshots, OCR, one wake key); `--phone --task` adds one read-only phone task. Daemons on older versions are warnings: auto-update takes up to an hour.

- Bump `version` in `npm/package.json` and `ghosthandVersion` in `daemon/Sources/ghosthand/daemon.swift` together. The build fails if they differ.
- Publish with `cd npm && pnpm publish --no-git-checks`. Do not run `pnpm build` first: `prepublishOnly` cleans `dist` and runs the full `--release --upload` build with the Sigillo project `macos-release` (Developer ID identities in the keychain, App Store Connect key for notarization), so the installer goes to R2 in the same run (~10 min with notarization).
- **The CLI never signs or assembles a bundle on a user's Mac.** `GhosthandApplication.install` only copies a bundle built by `build.ts` (`GhosthandRelease` in Info.plist) as is, and only when it is a newer build (`buildIsNewer`: version, then build time), so ~/Applications never goes back. The daemon always runs the installed build: a CLI restarts an older daemon when idle, and the daemon restarts itself once idle after the app was replaced. Every build is signed with our Developer ID (bundle id + team), so macOS permissions stay across npm, installer and dev builds. States and transitions: `docs/install-paths.md`.
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

Every lease needs a ghosthand.dev account. **Free**: one iPhone, 10 phone task prompts per UTC month. **Pro**: $99/month per Mac (Stripe quantity), unlimited iPhones on each paid Mac, unlimited phone tasks, read access to the daemon repo. No time limits. The daemon owns the account (`daemon/Sources/ghosthand/account.swift`); the setup app and CLI only call the daemon.

Remote MCP uses resource-bound opaque OAuth tokens, checked against current grants and sessions. Before deleting a session, delete its refresh grants (revoked-token reuse can end other sessions' grants); then close its hub sockets. Hub session deadlines use alarms, not polling, so idle sockets still hibernate.

```
setup app / ghosthand account login ──POST /v1/account/login──> daemon ──POST /api/cli/login──> website
browser approves /device ─────────────────────────────> daemon polls /api/cli/login/token
acquire ──> Account.authorizeLease() ──POST /api/cli/lease-check {phone, mac hashes}──> leaseDecision (lib/billing.ts)
                                                                         binds org_device rows
Stripe webhook / dashboard / daily cron ──> syncSourceAccess (lib/github.ts) ──GITHUB_TOKEN──> daemon repo collaborators
```

- The daemon never decides the plan: `lease-check` answers `allowed`, a `message` and `validUntil`. Only acquire and wait check, so a running lease is never stopped. Devices bind on first lease into `org_device` slots (unique per kind, so racing Macs cannot both take the last one); a Mac is paid while its slot is below the quantity. Unreachable server: the daemon allows only iPhones it cached as allowed, until `validUntil`.
- Phone tasks: every `POST /api/cli/tasks` prompt is a `task_run` row. Free orgs get `FREE_TASKS_PER_MONTH` (10) per UTC month (`taskDecision`, billing.ts); past it the route answers 402 with the `/subscribe` link, which the daemon passes to CLI, MCP and chat as `subscription-required`.
- `/subscribe` works signed out (login, then Checkout) and from any plan; the pricing page and dashboard link it directly, so nobody needs to hit a limit to buy Pro.
- Source access: Postgres (`source_access`) is the desired state, GitHub the actual one; every sync is safe to repeat. Only org-owned repos give read-only (`pull`) collaborators.
- `GHOSTHAND_SERVER` at daemon start picks the server (default https://ghosthand.dev; `http://localhost:8047` for `pnpm dev` in website/). A saved account counts only for its own server. Restart the daemon after changing it.
- Orgs: identity (sessions, OAuth tokens) belongs to the user; the plan, the bound devices and the Mac hub (`getHub(orgId)`) belong to the org. A signup hook creates a personal org with `org_id = user.id`. Always resolve it with `getPersonalOrg(userId)` (through `org_member`); never pass a user id as an org id, or team orgs break later.
- Website: `db/` has the Postgres schema and migrations (drizzle). The database is PlanetScale Postgres `ghosthand` (org `clamordev`, us-east, PS-5 single node, billed through Cloudflare), reached through Hyperdrive with caching off; preview uses the same database. Migrate with `pnpm db:migrate:prod` in website/ (Sigillo prod `DATABASE_URL`). Local dev and tests use the local Postgres (Sigillo dev `DATABASE_URL`, tests create a throwaway database). `getDb()` pools close idle sockets after 1 s: an open socket keeps a Durable Object from hibernating. Stripe rows store their Stripe account id; today the account is shared with Playwriter (sigillo project `website` in the `ghosthand` org).

# Phone tasks (agent on ghosthand.dev)

`ghosthand task -l 42 "open the TikTok likes tab"` (also MCP `task`, `POST /v1/leases/{lease}/task`) runs a fast agent on the website. The daemon only starts the turn and passes the AI SDK UI message stream through unchanged.

```
daemon (task.swift) ──POST /api/cli/tasks {id, lease: "<mac>:42", messages}, session token──> GhosthandTask DO (website/src/task.ts)
   ◀── SSE `data: <UIMessageChunk>` ... `data: [DONE]` ──────────────────────────────────────  │ streamText (task-agent.ts)
                                                                                                │ tools: openapi-fetch over hub.daemonFetch
this or another Mac's daemon /v1/leases/<mac>:42/tap?screentext=true <──WS── GhosthandHub <───┘
```

- **Model:** Vercel AI Gateway (`AI_GATEWAY_API_KEY` in Sigillo), `anthropic/claude-haiku-5.5` with reasoning off and gateway `caching: 'auto'` (Anthropic caches only with breakpoints), `zai/glm-5.3-flash` as fallback. A new prompt to a running task aborts its turn and starts at once (no 409). A stopped turn (Stop or a new prompt) is saved with `metadata.stopped` and its action in flight failed ("interrupted, may or may not have run"). The model reads it ending with its own `[Interrupted]`, never a user note: "the user stopped the task" as user text made it refuse the next prompt. The system prompt says to be proactive (do it, never ask "Should I continue?"). Check changes with the interruption tests in `task.test.ts`, several runs: Haiku without reasoning flips on small wording changes. Measure a change with `website/scripts/task-bench.ts` against a real iPhone before switching.
- **Each tool calls one MCP tool with a few of its arguments** (`TASK_TOOLS`: `screentext`, `screenshot`, `tap` x,y, `tapText` text, `swipe`, `scroll`, `key`, `type`). The model sees the MCP description and argument descriptions from `website/mcp-tools.json`; an argument the MCP tool lacks throws, and a test checks the types. The task sets `lease`, `mac`, `scale`; no `waitText` (the model cannot know the next screen's text) and no OCR `language`. Every input asks for `screenshot=jpeg`, the settled screen (`settledFrame`: still for 150 ms once the screen differs from before the input, and not before 500 ms after it; up to 1 s for a reaction when it does not; after a tap, hold or swipe that changed under 20% of the screen, until 1.5 s, because a dialog it opens can come late; at most ~3.5 s), so one model step is one action. Screenshot bytes go only to the model (`toModelOutput`), never into the UI stream; history from earlier turns says the image was not kept. They call the daemon REST API, typed from `openapi.yaml` (`website/src/generated/daemon-api.ts`, written by `pnpm generate-docs`). The fake Mac in `task.test.ts` serves `src/fixtures/task-*.jpg`. One more tool, `webfetch`, runs in the Worker (no daemon): the AI SDK web fetch tool (`@ai-sdk/tool-web-fetch`, markdown, cut at 20k characters, `offset` for more); the system prompt lists the ghosthand.dev docs pages to read when stuck. The system prompt also holds the "Phone tips" section of `skills/ghosthand/SKILL.md` (`?raw` import): write phone-use tips there, once, for CLI agents and the task agent.
- **One DO per task**, named `<orgId>:<taskId>`. Rows written are billed (setAlarm and deletes too), so chunks stay in memory and are stored in batches: one row before each tool call (a phone action may follow) and one at the end of the turn. The heartbeat alarm is set once per turn and re-armed only by the alarm. `GET .../stream` follows a running turn (AI SDK resume), `?from=<n>&message=<id>` gives a reconnecting client the rest. A deploy or crash stops a turn; the alarm (or the next resume) continues it and marks unfinished tool calls as interrupted. One day after the last turn the alarm calls `deleteAll()`.
- **Phone context:** each turn sends the leased iPhone (`TaskPhone`: name, model, iOS, language, region), read by `taskTarget` over USB or, for another Mac's lease, from that Mac's `info` route. It goes at the end of the system prompt, so the cached prefix stays the same.
- **Control plane chat** (`chat-panel.swift`): one chat per iPhone; each prompt is acquire, the same `POST /v1/leases/{lease}/task` stream, release. Text shows when its part ends (no streaming text); tool calls are one monospaced line each (`taskToolLabel`, shared with the CLI progress). Check the design with `ghosthand dashboard --foreground --mock chat --snapshot out.png`.
- **Tests:** `website/src/task.test.ts` runs the real model against a scripted Mac (`sigillo run -- pnpm test`).

# Cloud phones (rented virtual iPhones)

Customers rent a virtual iPhone ($49/month, one Stripe subscription per phone) and drive it with
the same CLI, MCP, REST and phone tasks as a USB iPhone. Phones are VPhone VMs on our own Macs
(**hosts**). Each phone is pinned to one host forever: that host's disk holds the only copy of its
VM, backed up with normal machine backups. Full design: `docs/cloud-phones.md`. New host
checklist: `docs/cloud-hosts.md`. Why: `plans/decisions/cloud-phones-pinned-hosts.md`.

```
tenant (MCP, REST, CLI) ──session / OAuth / API key──> ghosthand.dev Worker: auth -> org
   slug `cloud`, lease `cloud:<n>` (before getHub, the hub DO never wakes) ──> src/cloud/api.ts, mcp.ts
   fleet.ts: Postgres cloud_host, cloud_phone, cloud_lease; cron every minute   R2 `PHONES`: catalog IPAs
      │ Workers VPC binding `HOSTS`, private IP per host (10.77.0.<n>), no auth
      v
host Mac: cloudflared ──> vphone-cli fleet serve (no keys, never calls out) ──> vphone.sock
      ──> vphone-vm --hosted (vphone-usb-guard holds the USB link) ──VSOCK──> vphoned
      guest traffic ──> per-VM SOCKS5 proxy (tunnel mode, fail closed) ──> internet
```

- **The Worker is the only tenant gate.** Every call checks the org owns the lease and the
  phone's subscription allows it. Tenants never see hosts, R2 or any key.
- **Phones never move.** `cloud_phone.host_slug` is set at the first start and never changed; a
  host with phones cannot be deleted. Phone disks never go to R2 (parked: PR #2 here, fork PR #3).
  An offline host makes acquire fail at once ("its machine is offline"); a host that lost a VM
  that ran (`first_run_at` set) is a lost phone, never a fresh clone.
- **Hosts hold no keys and never call out.** Reaching a host through its tunnel is the only
  authority, and only the Worker's `HOSTS` binding can. The Worker sends catalog IPAs from R2.
  Pipe bodies, never read them in JS (a 1 GiB body read in a Worker failed with error 1102).
- **One store, Postgres, one fact per column.** Access is the linked subscription's status
  (pending = none yet), a host is online while `last_seen_at` is recent, a lease is live until
  `last_used_at + idle_timeout_s`, idle time comes from the last lease. Derive these in the query;
  never add a column that copies them. `subscription.kind` keeps cloud phones out of Pro.
- **No timers.** Acquire is one transaction (`FOR UPDATE` on the phone and the environment's
  hosts, `SKIP LOCKED` for the idle victim), host calls after commit in `waitUntil`, then it polls.
  Each command is one `UPDATE cloud_lease ... RETURNING`. The minute cron (`runFleetCron`) polls
  hosts and continues transitions.
- **Rules** (`website/src/cloud/scheduler.ts`): pure `place()` and `reconcile()`. A stop happens
  only to free a slot on the same host for a waiting acquire, after a 10 min idle grace. A new
  phone goes to the host with the most free slots. Row writes are compare-and-set before any host
  call. Rules are listed at the top of the file.
- Preview and production share the database: `cloud_host.environment` (the `ENVIRONMENT` var) says
  which Worker runs a host.

Where to change what:

| Change | Do it in |
|---|---|
| How a ghosthand command maps to the phone | `website/src/cloud/api.ts` (REST) and `mcp.ts` (MCP text). Website deploy only |
| A new phone capability | A vphoned RPC or a vphone.sock command in `vphone/`, then map it in `api.ts`. `fleet serve` relays any vphone.sock line, so it needs no change |
| Scheduling rules | `website/src/cloud/scheduler.ts` plus a row in the tables of `scheduler.test.ts` |
| Fleet state, acquire, cron | `website/src/cloud/fleet.ts`, schema in `db/src/schema.ts` |
| Admin fleet page, its problems | `website/src/cloud/admin-view.ts` (pure, `admin-view.test.ts`), page `components/fleet-page.tsx` |
| Host operations (start, stop, IPA blobs, status) | Edit `vphone/VPhoneExecutable/VPhoneCommand/VPhoneCommand/Fleet/openapi.yaml`. Regenerate Swift (`vphone/scripts/generate-fleet-openapi.zsh`) and `fleet-api.ts` (`cd website && bun scripts/generate-fleet-api.ts`) in the same change |
| Supported apps | `website/src/cloud/apps.ts`, IPA uploaded to R2 `apps/`. USB iPhones install the same id from the App Store |
| Templates (phone model, iOS) | `TEMPLATES` in `website/src/cloud/storage.ts`, template folder copied into each host's fleet library |
| Billing | `website/src/lib/billing.ts` (`isCloudPhoneAllowed`, `linksCloudPhone`), `lib/stripe.ts`, `stripe-webhook.ts` |

Scripts (in `website/scripts/`):

- `cloud-host.ts`: operator commands: `list`, `add <slug> --address 10.77.0.<n>:7400` (slots
  come from the host's RAM, copied on every poll), `drain` (no new phones pinned there), `enable`,
  `remove` (refused while phones are pinned to it), `phones`. Auth is your normal API key
  (`source <(ghosthand tunnel url --new-token)`); the route checks the user id is in
  `CLOUD_ADMINS`. Each site manages only its own environment's hosts (`GHOSTHAND_URL`).
- Fleet health: `/admin/fleet` in the browser (admins only, linked from the dashboard), or
  `curl -H "authorization: Bearer $GHOSTHAND_TOKEN" $GHOSTHAND_URL/api/cloud-admin/view` for
  `{ok, problems, ...}`. Both call `loadFleetView()` (`admin.ts`); the pure view and problem rules
  are in `admin-view.ts`.
- `stripe-cloud-phone.ts`: creates the cloud phone product and price by lookup key; test mode
  unless `--live`.

Checks: `cd website && sigillo run -c dev -- npx vitest --run src/cloud/ src/lib/` (scripted fake
hosts stand in for `fleet serve`; `/__test/cloud-cron` runs the cron now). VMs run only on mintmacbook; never touch its logged-in VM
`app-lab`.

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

`grok-launch-video/` is a HyperFrames video (HTML + GSAP + a three.js Grok Bot mascot): the ghosthand launch for Grok Bot, with the real TikTok recording next to a Grok Bot chat. Read `grok-launch-video/AGENTS.md` first; render with `npx hyperframes render` inside it.
