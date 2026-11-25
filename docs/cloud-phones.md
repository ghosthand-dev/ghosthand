---
title: Cloud phones design
description: How rented virtual iPhones work end to end. Postgres fleet state, Stripe, website cloud module, scheduler rules and the minute cron, translation to vphoned RPC, the vphone-cli fleet host agent, phones pinned to one host, and new CLI commands. Companion to plans/cloud-phones.md.
---

# Cloud phones design

A user pays $49/month and gets one virtual iPhone. It runs on one of our Macs (a **host**) as a
VPhone VM and is driven with the same ghosthand MCP, REST, CLI and phone tasks as a USB iPhone.
The website translates the ghosthand API into vphoned RPC; the host only runs VMs. Each phone is
pinned to one host forever: that host's disk holds the only copy of its VM, and we back up host
Macs with normal machine backups.

```
MCP / REST / CLI ──> ghosthand.dev Worker (auth: OAuth, API key, Mac session -> orgId)
                       │ slug `cloud` (lease cloud:<n>, mac "cloud", /macs/cloud/v1): answered
                       │ in the Worker, the hub DO never wakes ──> src/cloud/api.ts (translation)
                       │                                              │
   Postgres: cloud_host, cloud_phone, cloud_lease <── fleet.ts ───────┘ decide (one transaction),
   subscription.kind (one store for every fact)        │              useLease (one UPDATE)
   cron every minute ──> runFleetCron ─────────────────┤ Workers VPC, no auth, private IP per host
                                                       v
                                       host Mac: cloudflared ──> vphone-cli fleet serve
                                           │ vm launch --headless --hosted, vphone.sock
                                           v
   R2 ghosthand-phones (binding) ──> the Worker sends catalog IPAs over the same tunnel
```

Names used below:

| Name | Meaning |
|---|---|
| host | A Mac of ours that runs VMs. Slug like `mint`, private IP like `10.77.0.1` |
| phone | One rented iPhone, row `cloud_phone`, id `cph_<ulid>`. Also the VM folder name on a host |
| pinned | A phone's host: set at its first start, never changed. Its VM lives only on that host |
| `cloud:<n>` | A cloud lease, as MCP and the CLI see it. `n` is the `cloud_lease` identity column |

## One tap, end to end

1. MCP `tap {lease: "cloud:7", x: 120, y: 640}` reaches `/mcp`. The Worker resolves the org.
2. The Worker sees the lease prefix `cloud` (`toolCallTarget`) and answers the call itself with
   `src/cloud/mcp.ts`; the hub Durable Object is not woken.
3. `mcp.ts` calls `api.ts`, the same code as `POST /macs/cloud/v1/leases/7/tap`.
4. `api.ts` runs one `UPDATE cloud_lease ... RETURNING` (`useLease`): lease 7 must be live, its
   phone must belong to this org, be running and have an allowed subscription. The same statement
   restarts the idle timeout and returns the phone id and its host's address.
5. `host.ts` sends `POST http://10.77.0.1:7400/v1/phones/<id>/sock` with the vphone.sock line
   `{"t":"rpc","method":"input.tap","params":{"x":120,"y":640},"settle":true}`.
6. `fleet serve` relays the line to `<vm>/vphone.sock`. `vphone-vm` runs the tap, waits for the
   screen to settle and answers with the JPEG frame.
7. `api.ts` shapes the reply as the daemon's `ActionResult`, and `mcp.ts` as the daemon's MCP text.

## Database

Postgres holds every fact, once. Facts that follow from others are derived in the query that
needs them, never stored. Migrations `db/drizzle/*_cloud_phones` and `*_cloud_phones_pinned`, applied with
`pnpm db:migrate:prod` before the deploy.

```prisma
model CloudHost {
  slug        String    @id                     // "mint"
  environment String                            // the Worker's ENVIRONMENT: preview and production share the database
  address     String                            // "10.77.0.1:7400", the private IP its tunnel routes
  slots       Int                               // most phones running at once
  status      String    @default("active")      // active | draining (no new phones pinned; its own phones still start)
  lastSeenAt  DateTime?                         // last status answer; online = within 3 minutes
  phones      CloudPhone[]                      // pinned phones; deleting a host with phones is refused (onDelete: Restrict)
}

model CloudPhone {
  id             String    @id @map("cloud_phone_id")    // "cph_" + ulid, also the VM folder name
  orgId          String                                  // org, onDelete: Cascade
  name           String
  subscriptionId String?   @unique                       // null: not paid yet; access = this subscription's status
  template       String                                  // VPhone template key
  state          String    @default("stopped")           // stopped | starting | running | stopping
  hostSlug       String?                                 // pinned host: null until the first start, then never changed
  firstRunAt     DateTime?                               // its host first reported it running; set: never clone the template again
  stateChangedAt DateTime  @default(now())
  leases         CloudLease[]
  @@unique([orgId], where: "subscription_id is null")     // one unpaid phone per org
}

model CloudLease {
  id          Int       @id @default(autoincrement()) @map("cloud_lease_id")  // the n of cloud:<n>
  phoneId     String                                  // cloud_phone, onDelete: Cascade (no org_id: join the phone)
  label       String?
  reason      String
  idleTimeoutS Int
  lastUsedAt  DateTime  @default(now())
  lastCommand String?
  endedAt     DateTime?                               // release, forced takeover, or the VM stopped under it
  createdAt   DateTime  @default(now())               // acquiredAt
}

model Subscription {
  // existing columns unchanged
  kind String @default("pro") // pro | cloud_phone, set by syncSubscription from product metadata
}
```

| Fact | Derived from |
|---|---|
| A phone may be leased | `isCloudPhoneAllowed(subscription.status)`: active, trialing or past_due |
| Pending (not paid yet) | `subscription_id is null`; the cron deletes these after a day |
| Dashboard status (pending, active, past_due, canceled) | `cloudPhoneStatus(subscription.status)` |
| A host is online | `last_seen_at` within `HOST_ONLINE_MS` (3 min); the cron asks every minute |
| A lease is live | `ended_at is null and last_used_at + idle_timeout_s > now()` |
| A phone is idle since | `greatest(state_changed_at, its last lease's end)`, null while a lease is live |
| Its VM must exist on its host | `first_run_at is not null`; a host that does not report it has lost it |

`first_run_at` is the one runtime fact `host_slug` cannot give: `host_slug` is set when the first
start is decided, and that start may fail before the host clones anything. Until the host reports
the VM running, a start may clone the template (`create`); after it, never.

- `kind` keeps cloud subscriptions out of `entitlementFor`, `subscribeRedirectUrl` and the plan
  shown on the dashboard. Without it a cloud phone would make the org Pro.
- `getPersonalOrg` (`website/src/db.ts`) loads `cloudPhones` with their subscription; the Worker
  uses it to tell the hub whether the org has cloud iPhones (`x-ghosthand-cloud`).

## Stripe

**Product and price**, created once by `website/scripts/stripe-cloud-phone.ts` (idempotent, by
lookup key), for test and live mode:

- Product `ghosthand cloud iPhone`, metadata `{app: "ghosthand", kind: "cloud_phone"}`.
- Price $49/month, lookup key `ghosthand_cloud_phone_monthly`, constant next to
  `PRO_PRICE_LOOKUP_KEY` in `website/src/lib/billing.ts`.
- Portal configuration `bpc_...`: add the product, quantity fixed at 1, cancel at period end.

**Checkout**, new `cloudPhoneCheckoutUrl({org, email, returnUrl})` in `website/src/lib/stripe.ts`:

1. Insert a `cloud_phone` row with no subscription (pending) and a new id, or reuse the org's unpaid one.
2. `getOrCreateStripeCustomer` (the same customer as Pro, never a second one).
3. `checkout.sessions.create`: `mode: subscription`, one line item, quantity 1, no adjustable
   quantity, `metadata` and `subscription_data.metadata` = `{orgId, app, kind: "cloud_phone",
   cloudPhoneId}`. Idempotency key includes the phone id.
4. Route `GET /cloud-phones/new` in `server.tsx` (login first if signed out, like `/subscribe`).

Abandoned checkouts leave unpaid rows. The minute cron deletes rows older than one day that have
no subscription and never ran (`first_run_at is null`).

**Webhook** (`website/src/stripe-webhook.ts`), the same four events:

- `syncSubscription` sets `kind` from the product metadata and finds the phone by
  `metadata.cloudPhoneId`.
- For `cloud_phone`: link `cloud_phone.subscription_id` (`linksCloudPhone`: the linked one stays;
  a renewal takes over only when it allows leases and the linked one does not).
  `syncSourceAccess` runs only for `pro`.
- Nothing else is told: every lease and every command reads the linked subscription's status.
  Allowed is `active`, `trialing` or `past_due` (Stripe is still retrying, same as Pro).
  `canceled` and `unpaid` refuse new leases and the next command of a running one. The VM stays
  on its host forever. Renewing from the dashboard runs a new checkout with the same `cloudPhoneId`, so the
  same phone comes back.

**Fixes needed in existing code:** `entitlementFor`, `subscribeRedirectUrl` (including its "open
checkout" reuse and "live subscription goes to portal" shortcuts) and the dashboard's subscription
pick filter on `kind = "pro"`.

**Phone tasks:** an org with an allowed cloud phone gets unlimited task prompts (`taskDecision`),
unless the user decides otherwise (open question).

## Website: `website/src/cloud/`

### `fleet.ts`: the fleet in Postgres

No Durable Object, no event log, no timers. Every decision reads and writes the tables above;
expiry and grace are compared with `now()` in SQL.

| Function | Does |
|---|---|
| `listPhones({orgId})` | The org's paid phones with state and live lease, for `/v1/devices` and `list` |
| `acquire({orgId, phoneId, label, reason, idleTimeoutS, waitS, force, signal})` | Polls every 3 s until it leases, or the deadline (`waitS`, default 300 s). Each poll: `advance` the phone, then `decide` |
| `decide` (inside acquire) | One transaction. `SELECT ... FOR UPDATE` on the phone (and its subscription): two acquires of one phone take turns. A running phone whose host answered gets a lease. A stopped phone: lock the environment's host rows `FOR UPDATE` (no two starts count one free slot), run `place()`, then either set it `starting` on its host (pinning it there on the first start), lock the victim `FOR UPDATE SKIP LOCKED` and set it `stopping`, or refuse at once with `tunnel-offline` when its host is offline |
| `useLease({orgId, n, command})` | One `UPDATE cloud_lease ... FROM cloud_phone JOIN subscription JOIN cloud_host ... RETURNING`: live lease, this org's phone, running, allowed. Restarts the idle timeout |
| `release({orgId, n})` | Sets `ended_at` on a live lease of this org |
| `advance(phoneId)` | Reads the row, asks its host for status, runs `reconcile()`, writes the change with compare-and-set on (state, host), and only then makes the host call. Deduplicated per phone in an isolate |
| `runFleetCron()` | Every minute: status of every host of this environment (refreshes `last_seen_at` and copies the host's `slots`), then `advance` for every phone pinned to one |
| `listHosts`, `setHost`, `removeHost`, `listFleetPhones` | Operator routes (`admin.ts`). `removeHost` refuses while any phone is pinned to the host |
| `readFleet()` | Rows of the admin fleet page: hosts, paid phones with idle time, live and recent leases, org emails |

Host calls happen after commit. After a decision, the acquire runs `advance` of the phones it
changed in `waitUntil`, so a start or a stop goes out even if the client leaves; the next poll
and the cron carry it on. There is no queue: waiting acquires poll, and the first one to decide
after a slot frees gets it.

```
acquire ──> advance(phone) ──> decide ─┬─ running, host answered ──> INSERT cloud_lease ──> 201
            (status, reconcile)        ├─ stopped, its host offline ──> 503 tunnel-offline (never moves)
            lost VM ──> 404 no-device  ├─ stopped, free slot on its host ──> starting ──> waitUntil(advance): start
                                       ├─ stopped, host full, idle >= 10 min there ──> victim stopping ──> waitUntil(advance): stop
                                       └─ leased / starting / freeing ──> sleep 3 s, poll again
cron (1 min) ──> status of each host ──> advance(each pinned phone): mark running, stopped, crashed, lost
```

### `scheduler.ts`: pure rules

Two pure functions, tested as tables in `scheduler.test.ts`:

- `place({phone, hosts, placed, now})`: where a stopped phone starts, which idle phone stops for
  it, or why it waits (`host-offline`, `freeing`, `full`).
- `reconcile({phone, report})`: what a host's report of one phone means: a new state, its first
  run, ending leases after a crash, a lost VM, and the host call (`start`, `stop`).
  Level-triggered: the same row and report always give the same step, so repeating it after a
  lost call is safe.

Rules:

1. A phone is pinned to one host forever. Its first start sets `host_slug`; nothing changes it.
2. A stopped phone with a host starts there, first match:
   - the host is offline: acquire fails at once with `tunnel-offline` ("the machine that holds
     this cloud iPhone is offline right now"). It never starts elsewhere;
   - the host has a free slot: start;
   - a stop in flight on that host: wait for it;
   - stop the unleased running phone idle longest on that host, if idle at least `GRACE_MS`
     (10 min);
   - else wait (full).
3. A phone with no host yet gets the online, active host with the most free slots, then slug; if
   all are full, an idle phone on any of them stops for it. TODO: no cap on phones pinned per host
   (disk, oversell) yet.
4. A running phone with no lease keeps running until a stopped one needs its slot.
5. A start sends `create: true` only while `first_run_at` is null. A host that does not report a
   phone that already ran has lost it: the row goes to `stopped`, its leases end, the error goes
   to Strada and the admin page (`phone-lost`), and acquire answers `no-device` telling the user
   to rent a new phone. It is never cloned again under the same id.
6. Only a host report moves a phone out of a transition. A failed or timed-out call proves
   nothing: the next `advance` sends it again (the host answers 409 while it is busy).

### `api.ts`: ghosthand REST to vphoned

Spiceflow app mounted for `/macs/cloud/v1/*` and called in-process by `mcp.ts` and tasks. Types
come from `src/generated/daemon-api.ts`. Coordinates are screen points on both sides (daemon
default scale and vphoned gestures), so no conversion is needed at scale 1.

| Daemon route | vphone.sock / vphoned |
|---|---|
| `GET /v1/devices` | `fleet.listPhones`, model and iOS from the template |
| `POST /v1/leases`, `DELETE /v1/leases/{n}` | `fleet.acquire`, `release` (SSE keepalive like the daemon while it waits) |
| `GET .../screenshot` | `{"t":"screenshot"}`, `settle` passed through; `screentext` adds `ui.ocr` |
| `GET .../text` | `ui.ocr`; `waitText` polls it until `timeoutMs` |
| `POST .../tap` (x,y or text) | `input.tap`; text: `ui.ocr`, then tap the match center |
| `double-tap`, `triple-tap`, `hold` | `input.double_tap`, `input.touch_sequence`, `input.long_press` |
| `swipe`, `hold-drag`, `scroll` | `input.swipe`, `input.drag`, `input.swipe` by ticks |
| `key`, `type` | `input.key` / `input.button` (home, power, volume), `input.type` + `enter` |
| `wake`, `unlock`, `lock`, `mute` | `input.button wake`, `screen.unlock`, `input.button power`, `input.button mute` |
| `GET .../apps`, `DELETE .../apps/{bundle}` | `apps.list {filter: user}`, `apps.uninstall {force: true}` |
| `GET .../apps/catalog`, `POST .../apps/catalog/{app}` | `apps.ts` list; fleet `push-url` of the IPA, then `apps.install` |
| `GET .../info` | `device.info` shaped as `DeviceInfo` |
| `PUT .../name` | `cloud_phone.name` in Postgres |
| `POST .../task` | the existing task DO, whose `daemonFetch` calls this file |
| everything else | `unsupported-in-mode` with a one-line reason |

`ROUTES` is keyed by every daemon route (`METHOD /path` from `daemon-api.ts`), each a handler or an
`unsupported` reason, so a new daemon route fails tsc until it gets one. The daemon logic cloud
iPhones redo (tap-by-text matching, waitText checks, scroll strokes like XCTest mode, OCR shaping)
lives in the pure `core.ts`, checked with the daemon against the same cases (`daemon-parity.json`).

Every input with `?screenshot=jpeg` sends `"settle": true` and returns the frame in
`ActionResult.screenshot`. Problems use the daemon's codes (`lease-invalid`, `device-leased`,
`subscription-required`, `unsupported-in-mode`).

### `mcp.ts`

Answers `tools/call` for `cloud:` leases by calling `api.ts`, and formats text like the daemon's
MCP tools (same formatters ported: app lines, info lines, lease lines). Tools and argument types
come from `src/generated/mcp-tools.ts` (written with `mcp-tools.json` by `pnpm generate-docs`):
every tool is in `HANDLERS` or `UNSUPPORTED_TOOLS`, and each handler lists every argument it reads
or why it ignores it, so tsc fails on a new tool or argument. Arguments are checked against the
tool's inputSchema with the daemon's messages before a handler runs.

### `admin.ts`, `admin-view.ts`: the operator's view

`/admin/fleet` (signed-in users in `CLOUD_ADMINS`, 404 for everyone else, linked from their
dashboard) and `GET /api/cloud-admin/view` (API key or session of an admin) both call
`loadFleetView()` in `admin.ts`: `readFleet()`, then `GET /v1/status` of every host of this
environment, live and never stored. The pure `buildFleetView()` and `fleetProblems(view, now)` in
`admin-view.ts` turn that into hosts with slot cells, contention (full hosts, starting and
stopping phones, idle phones and when the grace lets them stop), lease events, customers, and
`problems: [{severity, code, host?, phone?, detail}]`. The route answers
`{ok: problems.length === 0, problems, ...view}`.

```bash
curl -s -H "authorization: Bearer $GHOSTHAND_TOKEN" https://ghosthand.dev/api/cloud-admin/view | jq '{ok, problems}'
```

### `host.ts`, `storage.ts`, `apps.ts`

- `host.ts`: typed client for the fleet API below, through the `HOSTS` VPC binding.
- `storage.ts`: `TEMPLATES` (model, iOS, screen size per VPhone template) and `sendBlob`, which
  pipes a catalog IPA from the `PHONES` binding to a host. No S3 keys.
- `apps.ts`: the catalog. `{id: "tiktok", name: "TikTok", bundleId, appStoreId: 835599320,
  version, key: "apps/tiktok/33.8.0.ipa", sha256}`. `install` streams the IPA from R2 to the
  host's blob store (skipped when the host has that sha256), then pushes it into the guest.
  Also served at `GET /api/cli/apps/catalog` for the daemon's App Store path.

### Changes to existing website files

| File | Change |
|---|---|
| `tunnel.ts` | The Worker answers `/macs/cloud/v1/...` and MCP calls naming `cloud` itself, before `getHub()`. Other calls go to the hub with the trusted header `x-ghosthand-cloud` (the org has a paid phone), so `GET /macs` adds `{slug: "cloud", name: "Cloud", online: true}` and `list` fans out to `cloud` |
| `lib/mcp-routing.ts` | Input `cloud: boolean`; `toolCallTarget(message)` is the Mac a call names. Lease prefix `cloud` and `mac: "cloud"` route to `{kind: "cloud"}`. A cloud-only org never gets the no-Mac reply; instructions and `setup-status` say the phone is ready to acquire |
| `task.ts` | Task tools of a `cloud:<n>` lease call `api.ts` directly, not `hub.daemonFetch` |
| `server.tsx` | `/cloud-phones/new` route, dashboard data, `/admin/fleet` loader and page, `scheduled()`: the fleet cron every minute, Stripe and source access daily |
| `components/account-pages.tsx` | "Cloud iPhones" section after Plan: one row per phone (name, paid status, renews or ended), Rent button, Manage (portal), Rename |
| `actions.tsx` | `renameCloudPhone` |
| `telemetry.ts` | `cloud_phone_checkout_opened`, `cloud_phone_activated`, `cloud_phone_canceled`, `cloud_phone_started` (ids and counts only) |
| `wrangler.jsonc` (top level and `env.preview`) | Cron `* * * * *` in both; R2 `PHONES` (`ghosthand-phones` in both: catalog IPAs); `vpc_networks` binding `HOSTS` (separate vnets); var `ENVIRONMENT` (telemetry and `cloud_host.environment`); var `CLOUD_ADMINS` (user ids). No R2 keys, no admin token |
| `test-runtime-worker.ts` | `/__test/cloud-cron` runs `runFleetCron` now |
| `scripts/cloud-host.ts` | `add <slug> --address` (slots come from the host), `remove` (refused while phones are pinned), `drain`, `enable`, `list`, `phones` through admin routes. Auth is the operator's normal ghosthand API key; the route checks the user id is in `CLOUD_ADMINS` |

## Host: `vphone-cli fleet serve` (VPhone fork)

Host code lives in `VPhoneExecutable/VPhoneCommand/VPhoneCommand/Fleet/` in the VPhone fork.

| File | Holds |
|---|---|
| `VPhoneFleetCommand.swift` | `fleet` group (`serve`, `status`), registered in `VPhoneCommand.swift` |
| `openapi.yaml` | Source for the Hummingbird API and the Worker's `website/src/generated/fleet-api.ts` types |
| `VPhoneFleetServer.swift` | Hummingbird on `--listen 10.77.0.1:7400`, with generated route handlers |
| `VPhoneFleetPhones.swift` | Phone lifecycle: clone from template (only with `create`), launch `vphone-cli vm launch <id> --headless --hosted` in its own session, ready when `vphone.sock` answers `ping`, stop with `vm stop`. State in `<vm>/fleet.json`. The IPA blob store, eviction of old IPAs below `--min-free-gb` (never phones), host metrics |

The fleet API has no auth. Only the tunnel reaches it. Bodies use JSON except for the streamed blob upload.

After you edit `openapi.yaml`, regenerate both sides from the root:

```sh
vphone/scripts/generate-fleet-openapi.zsh
(cd website && bun scripts/generate-fleet-api.ts)
```

| Route | Does |
|---|---|
| `GET /v1/status` | `{host, slots, freeDiskBytes, bundleVersion, templates, machine, phones: [{id, state, template, lastUsedAt, footprintBytes, error?}]}`; state is starting, stopping, running or stopped |
| `POST /v1/phones/{id}/start {template, create}` | `202`, then launch. `create` clones the template first when the phone is not there; without it a missing phone answers `409` |
| `POST /v1/phones/{id}/stop` | `202`, then `vm stop` |
| `POST /v1/blobs/missing {hashes}` | Which of these IPA hashes the host lacks |
| `PUT /v1/blobs/{sha256}` | Store an IPA; the host checks the hash |
| `POST /v1/phones/{id}/sock` | Relay one vphone.sock JSON line and return its reply. `VPhoneFleetSocketGate` controls which commands pass |
| `POST /v1/phones/{id}/push {sha256, path}` | vphone.sock `push` of a blob into the guest |

**R2** (bucket `ghosthand-phones`, read only by the Worker's `PHONES` binding) holds only
`apps/<id>/<version>.ipa`, catalog IPAs uploaded by hand.

### Phones stay on their host

The host's disk holds the only copy of each of its phones. Phones never move: no copy in R2, no
restore on another host, no eviction.

```
IPA install   host POST /blobs/missing [sha] ──> PHONES.get ──stream──> PUT /blobs/<sha>
              ──> POST /push ──> sock rpc apps.install
```

- **Backups are machine backups.** Tommy backs up host Macs with normal backups. A host that
  loses its disk loses its phones, like a broken iPhone: their users rent a new phone and sign in
  again (the Worker detects it, rule 5).
- **Hosts hold no keys and never call out.** Reaching a host's private IP through its tunnel is
  the only authority, and only our Worker's `HOSTS` binding can. Bodies are piped, never read in
  JS (Task 1: reading a 1 GiB body in a Worker hit error 1102).
- **Tenants never see any of this.** The CLI and MCP use only the user's session, OAuth token or
  API key; the Worker resolves the org and does the rest.
- Moving phone disks through R2 (4 MiB chunk manifests, saves after each stop, restore on another
  host) was built and measured, then parked as too complex: ghosthand PR #2 and the fork's PR #3.
  A boot alone changed 230 to 290 chunks (about 1 GiB) per stop.
- **TODO: back up app data only.** Later, save each phone's app data (even if encrypted) instead
  of whole disks, so a phone can come back on a fresh template after a lost host. Model it on
  upstream's data-preserving iOS OTA workflow (https://github.com/Lakr233/vphone-cli/pull/709).

**Machine setup** (written as `docs/cloud-hosts.md` in this repo): VPhone bundle install,
`vphone-escalator allow`, `vphone-usb-guard` launchd job (PR #2), `cloudflared` tunnel with the
host's `/32` route and an `lo0` alias for that IP, `fleet serve` launchd job (no secrets),
`cloud-host.ts add`. Templates are copied into each host's fleet library by hand.

## VPhone fork: other changes

| Change | Where |
|---|---|
| Settle: `"settle": true` on vphone.sock `rpc`, `tap`, `swipe`, `key`, `type` and `screenshot`. After the action, compare downscaled frames from `VPhoneGraphicsDisplayCapture` (host side, the guest does no work) with the daemon's rules: still for 150 ms once changed, not before 500 ms, up to 1 s for a reaction, at most 3.5 s. Return the JPEG | `UI/VPhoneHostAutomationServer.swift`, new `UI/HostDevices/VPhoneScreenSettle.swift` |
| `--hosted` without `--api-listen` (fleet uses only vphone.sock), and tunnel networking with the fail-closed proxy | PR #1, PR #2 |
| Headless screen capture through `VPhoneGraphicsDisplayCapture` (today headless screenshots ask the guest) | `captureScreenImage` in the automation server |

Fleet uses vphone.sock, the operator socket with the full root API. The website is the only
tenant gate: `api.ts` exposes only the mapped routes, never a raw RPC.

## Daemon: new CLI commands

| CLI | REST | MCP |
|---|---|---|
| `ghosthand app catalog -l cloud:7` | `GET /v1/leases/{lease}/apps/catalog` (`listCatalogApps`) | `app-catalog` |
| `ghosthand app install --app tiktok -l cloud:7` | `POST /v1/leases/{lease}/apps/catalog/{app}` (`installCatalogApp`) | `app-install` with `app`; `data` becomes optional |

- **One command, two backends.** On `cloud:<n>`, `LeaseRoutingMiddleware` already forwards to
  `/macs/cloud/v1/...`, and the website installs the decrypted IPA from R2. On a USB lease the
  daemon installs from the App Store: it opens `itms-apps://apps.apple.com/app/id<appStoreId>`,
  taps Get (or the cloud download icon), handles the known dialogs in `docs/system-dialogs.md`,
  and returns when `app list` shows the bundle id without `installing`. It needs an Apple ID
  signed in on the phone; without one it answers with that next step.
- The catalog is one list shared by both: `website/src/cloud/apps.ts` holds `{id, name,
  bundleId, appStoreId, key, sha256}`. The daemon reads it from `GET /api/cli/apps/catalog` (public
  data, cached for the daemon run), so adding an app needs no daemon release.
- Why not install IPAs on USB phones: a decrypted IPA must be re-signed for the device (Developer
  Mode, UDID in the profile, push and app groups lost, free Apple IDs expire in 7 days), and an
  ipatool IPA only runs for the Apple ID that bought it ([ipatool #344](https://github.com/majd/ipatool/issues/344)).
- Files: `main.swift` (commands, `--app` in `MCPDescription.arguments`), `openapi.yaml`, `api.swift`,
  `mcp.swift`. Then `pnpm generate-docs` in `website/`.
- `list`, `acquire -d <phone id>`, `wait` and every input command already work through
  `Tunnel.otherMacs` and lease forwarding once `/macs` lists `cloud`. No other daemon change.

## Security

- The only gate is the website: org owns phone, lease owned by org, subscription allowed. Tests
  send org B's credentials to org A's lease through MCP, REST and tasks.
- Hosts listen on a private IP reachable only through their tunnel; nothing on the internet or the
  LAN reaches `fleet serve`.
- Template clones share SEP and Data volume keys. Tenants never get disk images, so this matters
  only if a host disk leaks. A full restore per phone (`vm create --no-template`) gives own keys at
  the cost of minutes per phone and no shared template chunks.

## Tests

| Test | Covers |
|---|---|
| `website/src/cloud/scheduler.test.ts` | `place()` and `reconcile()` as tables, inline snapshots |
| `website/src/cloud/cloud.test.ts` | `api.ts` + `mcp.ts` + `fleet.ts` on Postgres against scripted fake hosts (like the fake Mac in `task.test.ts`): org isolation, MCP tool coverage, an idle phone on the same host stopped for another after the grace time, a phone that never moves to a free host, a lost VM and an offline host as user errors, catalog IPAs |
| `website/src/lib/billing.test.ts` | `kind` filter: a cloud subscription does not make an org Pro |
| e2e on mintmacbook | Buy in Stripe test mode, acquire, tap, install TikTok, stop, start again with its data kept |
