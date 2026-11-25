---
title: Cloud phones design
description: How rented virtual iPhones work end to end. Postgres fleet state, Stripe, website cloud module, scheduler rules and the minute cron, translation to vphoned RPC, the vphone-cli fleet host agent, R2 storage and new CLI commands. Companion to plans/cloud-phones.md.
---

# Cloud phones design

A user pays $49/month and gets one virtual iPhone. It runs on one of our Macs (a **host**) as a
VPhone VM and is driven with the same ghosthand MCP, REST, CLI and phone tasks as a USB iPhone.
The website translates the ghosthand API into vphoned RPC; the host only runs VMs.

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
   R2 ghosthand-phones (binding) ──> the Worker moves chunks and IPAs over the same tunnel
```

Names used below:

| Name | Meaning |
|---|---|
| host | A Mac of ours that runs VMs. Slug like `mint`, private IP like `10.77.0.1` |
| phone | One rented iPhone, row `cloud_phone`, id `cph_<ulid>`. Also the VM folder name on a host |
| version | Storage version of a phone. +1 on every stop. The newest copy is on a host or in R2 |
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
needs them, never stored. Migration `db/drizzle/*_cloud_phones`, applied with
`pnpm db:migrate:prod` before the deploy.

```prisma
model CloudHost {
  slug        String    @id                     // "mint"
  environment String                            // the Worker's ENVIRONMENT: preview and production share the database
  address     String                            // "10.77.0.1:7400", the private IP its tunnel routes
  slots       Int                               // most phones running at once
  status      String    @default("active")      // active | draining (no new starts)
  lastSeenAt  DateTime?                         // last status answer; online = within 3 minutes
  phones      CloudPhone[]
}

model CloudPhone {
  id             String    @id @map("cloud_phone_id")    // "cph_" + ulid, also the VM folder name
  orgId          String                                  // org, onDelete: Cascade
  name           String
  subscriptionId String?   @unique                       // null: not paid yet; access = this subscription's status
  template       String                                  // VPhone template key
  state          String    @default("stored")            // stored | starting | running | stopping
  hostSlug       String?                                 // where it runs, or the host whose disk has its newest copy
  version        Int       @default(0)                   // newest hashed version, +1 on every stop
  savedVersion   Int       @default(0)                   // newest version in R2 (0: the template)
  saveCursor     Int       @default(0)                   // chunks of `version` already copied to R2
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
| Only its host has the newest copy | `version > saved_version` |
| A save is in progress | stored and `version > saved_version`; `save_cursor` is its only progress |

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
no subscription and never ran (`version = 0`).

**Webhook** (`website/src/stripe-webhook.ts`), the same four events:

- `syncSubscription` sets `kind` from the product metadata and finds the phone by
  `metadata.cloudPhoneId`.
- For `cloud_phone`: link `cloud_phone.subscription_id` (`linksCloudPhone`: the linked one stays;
  a renewal takes over only when it allows leases and the linked one does not).
  `syncSourceAccess` runs only for `pro`.
- Nothing else is told: every lease and every command reads the linked subscription's status.
  Allowed is `active`, `trialing` or `past_due` (Stripe is still retrying, same as Pro).
  `canceled` and `unpaid` refuse new leases and the next command of a running one. Storage stays
  forever. Renewing from the dashboard runs a new checkout with the same `cloudPhoneId`, so the
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
| `decide` (inside acquire) | One transaction. `SELECT ... FOR UPDATE` on the phone (and its subscription): two acquires of one phone take turns. A running phone whose host answered gets a lease. A stored phone: lock the environment's host rows `FOR UPDATE` (no two starts count one free slot), run `place()`, then either set it `starting` on a host, or lock the victim `FOR UPDATE SKIP LOCKED` and set it `stopping` |
| `useLease({orgId, n, command})` | One `UPDATE cloud_lease ... FROM cloud_phone JOIN subscription JOIN cloud_host ... RETURNING`: live lease, this org's phone, running, allowed. Restarts the idle timeout |
| `release({orgId, n})` | Sets `ended_at` on a live lease of this org |
| `advance(phoneId)` | Reads the row, asks its host for status, runs `reconcile()`, writes the change with compare-and-set on (state, version, host), and only then makes the host call. Deduplicated per phone in an isolate |
| `runFleetCron()` | Every minute: status of every host of this environment (refreshes `last_seen_at`), then `advance` for every phone placed on one, and saves to R2, 500 chunks per run |
| `listHosts`, `setHost`, `removeHost`, `recover`, `listFleetPhones` | Operator routes (`admin.ts`) |

Host calls happen after commit. After a decision, the acquire runs `advance` of the phones it
changed in `waitUntil`, so a start or a stop goes out even if the client leaves; the next poll
and the cron carry it on. There is no queue: waiting acquires poll, and the first one to decide
after a slot frees gets it.

```
acquire ──> advance(phone) ──> decide ─┬─ running, host answered ──> INSERT cloud_lease ──> 201
            (status, reconcile)        ├─ stored, free slot ──> state starting ──> waitUntil(advance): start
                                       ├─ stored, full, idle >= 10 min ──> victim stopping ──> waitUntil(advance): stop
                                       └─ leased / starting / freeing ──> sleep 3 s, poll again
cron (1 min) ──> status of each host ──> advance(each placed phone): mark running, stopped,
                                         crashed; continue a load; save a stored version to R2
```

### `scheduler.ts`: pure rules

Two pure functions, tested as tables in `scheduler.test.ts`:

- `place({phone, hosts, placed, now})`: where a stored phone starts, which idle phone stops for
  it, or why it waits (`host-offline`, `freeing`, `full`).
- `reconcile({phone, report})`: what a host's report of one phone means: a new state, a new
  version, forgetting an evicted cached copy, ending leases after a crash, and the host call
  (`start`, `load`, `stop`, `save`). Level-triggered: the same row and report always give the
  same step, so repeating it after a lost call is safe.

Rules:

1. A phone runs on at most one host. Never start a phone whose newest copy is on an offline host;
   it waits for that host (Mac crash case). Only `recover` moves it to its R2 version.
2. A stored, allowed phone starts on, first match:
   - its own host, if online, active and with a free slot (no download);
   - else, if R2 has its newest copy: the usable host with the most free slots, then slug;
   - else a slot freed by stopping the unleased running phone idle longest, if idle at least
     `GRACE_MS` (10 min), on a host it can use; while a stop is in flight there, it waits for it;
   - else it waits.
3. A running phone with no lease keeps running until a stored one needs its slot.
4. A stop hashes the disk as `version + 1` on the host; the cron copies it to R2 and sets
   `saved_version`. A VM that stopped by itself (crash, host restart) is hashed the same way, and
   its lease ends.
5. Only a host report moves a phone out of a transition. A failed or timed-out call proves
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

Every input with `?screenshot=jpeg` sends `"settle": true` and returns the frame in
`ActionResult.screenshot`. Problems use the daemon's codes (`lease-invalid`, `device-leased`,
`subscription-required`, `unsupported-in-mode`).

### `mcp.ts`

Answers `tools/call` for `cloud:` leases by calling `api.ts`, and formats text like the daemon's
MCP tools (same formatters ported: app lines, info lines, lease lines). Tool names and argument
names come from `mcp-tools.json`; a test fails if a tool there has no handler or `unsupported`
entry.

### `host.ts`, `storage.ts`, `apps.ts`

- `host.ts`: typed client for the fleet API below, through the `HOSTS` VPC binding.
- `storage.ts`: R2 key layout, manifest types, and the chunk moves: host to R2 after a stop,
  R2 to host before a start (see "Storage moves through the Worker" below). Uses the `PHONES`
  binding only, no S3 keys.
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
| `server.tsx` | `/cloud-phones/new` route, dashboard data, `scheduled()`: the fleet cron every minute, Stripe and source access daily |
| `components/account-pages.tsx` | "Cloud iPhones" section after Plan: one row per phone (name, paid status, renews or ended), Rent button, Manage (portal), Rename |
| `actions.tsx` | `renameCloudPhone` |
| `telemetry.ts` | `cloud_phone_checkout_opened`, `cloud_phone_activated`, `cloud_phone_canceled`, `cloud_phone_started` (ids and counts only) |
| `wrangler.jsonc` (top level and `env.preview`) | Cron `* * * * *` in both; R2 `PHONES` (`ghosthand-phones` in both: preview shares the database, so it shares phone storage); `vpc_networks` binding `HOSTS` (separate vnets); var `ENVIRONMENT` (telemetry and `cloud_host.environment`); var `CLOUD_ADMINS` (user ids). No R2 keys, no admin token |
| `test-runtime-worker.ts` | `/__test/cloud-cron` runs `runFleetCron` now |
| `scripts/cloud-host.ts` | `add <slug> --address --slots`, `remove`, `drain`, `enable`, `list`, `recover <phone>`, `phones` through admin routes. Auth is the operator's normal ghosthand API key; the route checks the user id is in `CLOUD_ADMINS` |

## Host: `vphone-cli fleet serve` (VPhone fork)

New folder `VPhoneExecutable/VPhoneCommand/VPhoneCommand/Fleet/`. The VPhoneCommand group is a
synchronized folder, so new files need no pbxproj edit. The swift-nio products (`NIOCore`,
`NIOPosix`, `NIOHTTP1`, already pinned at 2.83.0 for `vphone-vm`) are added to the `vphone-cli`
target; that is the only pbxproj change.

| File | Holds |
|---|---|
| `VPhoneFleetCommand.swift` | `fleet` group (`serve`, `status`), registered in `VPhoneCommand.swift` |
| `VPhoneFleetServer.swift` | NIO HTTP/1.1 on `--listen 10.77.0.1:7400`, JSON routes below |
| `VPhoneFleetPhones.swift` | Phone lifecycle: clone from template, launch child `vphone-cli vm launch <id> --headless --hosted` (`VPhoneManagedProcess`), ready when `vphone.sock` answers `ping`, stop with SIGINT then SIGKILL like `vm stop`. State in `<vm>/fleet.json` |
| `VPhoneFleetStorage.swift` | Manifests of a stopped phone, serving chunks by hash, the local blob store, restoring a version from template + blobs. No network client: the Worker moves every byte |
| `VPhoneFleetCache.swift` | Free-disk check, least recently used eviction of uploaded stopped phones, IPA cache by sha256 |

Fleet API, all JSON, no auth (reachable only through the tunnel):

| Route | Does |
|---|---|
| `GET /v1/status` | `{host, slots, freeDiskBytes, bundleVersion, templates, phones: [{id, state, version, savedVersion, lastUsedAt, error?}]}`; state is starting, stopping, restoring, running, stopped or damaged |
| `POST /v1/phones/{id}/start {version, template}` | `202`. Clone or download to reach `version` if needed, then launch |
| `POST /v1/phones/{id}/stop {version}` | `202`. Shut down, then hash the disk into the manifest of `version`, which must be newer than the local copy (a crashed VM too). `409` for an equal version while it runs: a late duplicate never stops a new run |
| `GET /v1/phones/{id}/versions/{v}` | That version's manifest (chunk hashes and small files) |
| `GET /v1/phones/{id}/chunks/{sha256}`, `.../files/{name}` | One chunk or small file of a local version, with `Content-Length` |
| `POST /v1/phones/{id}/versions/{v}/saved` | R2 has this version now: the local copy may be evicted |
| `POST /v1/blobs/missing {hashes}` | Which of these hashes the host has in no template, cached phone or blob |
| `PUT /v1/blobs/{sha256}` | Store a chunk or IPA; the host checks the hash |
| `POST /v1/phones/{id}/restore {version, manifest}` | Build that version from the template and blobs (before `start` on a new host) |
| `POST /v1/phones/{id}/sock` | Relay one vphone.sock JSON line, return its reply. Any new vphone.sock command works without a fleet change |
| `POST /v1/phones/{id}/push {sha256, path}` | vphone.sock `push` of a blob into the guest |

**R2 layout** (bucket `ghosthand-phones`, written and read only by the Worker's `PHONES` binding):

```
templates/<key>/manifest.json       chunk list of the template Disk.img and its small files
chunks/<sha256>                      4 MiB chunk, LZ4 compressed (libcompression)
phones/<id>/<version>/manifest.json  {template, size, chunks: [sha256 | "0"], files: {...}}
phones/<id>/<version>/config.plist, SEPStorage, nvram.bin, PatchReceipt.plist, restore-info.json
apps/<id>/<version>.ipa              catalog IPAs, uploaded by hand
```

### Storage moves through the Worker

Hosts hold **no keys** and never call out. Reaching a host's private IP through its tunnel is
the only authority, and only our Worker's `HOSTS` binding can. The Worker moves every byte:

```
save (after stop)    host GET /versions/v ──> diff vs previous + template manifest
                     for each new hash: host GET /chunks/<h> ──stream──> PHONES.put(chunks/<h>)
                     small files, then phones/<id>/<v>/manifest.json last ──> POST .../saved
load (new host)      R2 manifest ──> host POST /blobs/missing ──> for each: PHONES.get ──stream──>
                     host PUT /blobs/<h> ──> POST /restore ──> POST /start
IPA install          host POST /blobs/missing [sha] ──> PHONES.get ──stream──> PUT /blobs/<sha>
                     ──> POST /push ──> sock rpc apps.install
```

- **Upload on stop:** the host walks only allocated ranges of `Disk.img` (`SEEK_DATA`) and hashes
  4 MiB chunks. The Worker copies chunks whose hash is not in the previous manifest or the template
  manifest, then the small files, then the manifest last. A missing manifest means the version does
  not exist.
- **Bodies are piped, never read in JS** (Task 1: reading a 1 GiB body in a Worker hit error 1102).
  Chunks are 4 MiB with a known length, so `PHONES.put` takes the host response body directly.
- **Batches:** a copy is 2 subrequests per chunk, so the cron copies at most 500 chunks per run
  and continues in the next (Workers allow 10,000 subrequests per invocation); an acquire copies
  50 per poll. A save's only progress is `save_cursor`; a load's is the host's own
  `blobs/missing` answer.
- **Restore:** `clonefile` the local template, write chunks that differ (from another local cached
  phone when its manifest has the hash, else the blob store), punch holes for `"0"`, copy the small
  files. Write `fleet.json` with the version last.
- The template must exist on every host with the same bytes: the Worker loads it like a phone
  (`templates/<key>/`), hosts never build their own.
- **Tenants never see any of this.** The CLI and MCP use only the user's session, OAuth token or
  API key; the Worker resolves the org and does the rest.

**Machine setup** (written as `docs/cloud-hosts.md` in this repo): VPhone bundle install,
`vphone-escalator allow`, `vphone-usb-guard` launchd job (PR #2), `cloudflared` tunnel with the
host's `/32` route and an `lo0` alias for that IP, `fleet serve` launchd job (no secrets),
`cloud-host.ts add`, which also loads the template.

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
| `website/src/cloud/cloud.test.ts` | `api.ts` + `mcp.ts` + `fleet.ts` on Postgres against scripted fake hosts (like the fake Mac in `task.test.ts`): org isolation, MCP tool coverage, an idle phone stopped for another after the grace time, the cron's save to R2, a load on a second host |
| `website/src/lib/billing.test.ts` | `kind` filter: a cloud subscription does not make an org Pro |
| fork `VPhoneCommandTests` | Manifest diff and restore on sparse files |
| e2e on mintmacbook | Buy in Stripe test mode, acquire, tap, install TikTok, stop, start on a second machine folder |
