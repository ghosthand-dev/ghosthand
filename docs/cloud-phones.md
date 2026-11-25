---
title: Cloud phones design
description: How rented virtual iPhones work end to end. Database, Stripe, website cloud module, scheduler, translation to vphoned RPC, the vphone-cli fleet host agent, R2 storage and new CLI commands. Companion to plans/cloud-phones.md.
---

# Cloud phones design

A user pays $49/month and gets one virtual iPhone. It runs on one of our Macs (a **host**) as a
VPhone VM and is driven with the same ghosthand MCP, REST, CLI and phone tasks as a USB iPhone.
The website translates the ghosthand API into vphoned RPC; the host only runs VMs.

```
MCP / REST / CLI ──> ghosthand.dev Worker (auth: OAuth, API key, Mac session -> orgId)
                       │ GhosthandHub(org): slug `cloud` ──> src/cloud/api.ts (translation)
                       │                                       │
                       │                   CloudFleet DO <─────┘ runtime, leases, queue,
                       │                   (one instance)        scheduler
                       │                        │ Workers VPC, no auth, private IP per host
                       v                        v
   Postgres: cloud_phone,          host Mac: cloudflared ──> vphone-cli fleet serve
   subscription.kind                   │ vm launch --headless --hosted, vphone.sock
                                       v
   R2 ghosthand-phones <──S3──>    VMs (vphoned RPC), local disk cache, chunk sync
```

Names used below:

| Name | Meaning |
|---|---|
| host | A Mac of ours that runs VMs. Slug like `mint`, private IP like `10.77.0.1` |
| phone | One rented iPhone, row `cloud_phone`, id `cph_<ulid>`. Also the VM folder name on a host |
| version | Storage version of a phone. +1 on every stop. The newest copy is on a host or in R2 |
| `cloud:<n>` | A cloud lease, as MCP and the CLI see it. `n` is a global counter in CloudFleet |

## One tap, end to end

1. MCP `tap {lease: "cloud:7", x: 120, y: 640}` reaches `/mcp`. The Worker resolves the org.
2. `GhosthandHub(org)` routes it: lease prefix `cloud` goes to `src/cloud/mcp.ts`, not a Mac socket.
3. `mcp.ts` calls `api.ts`, the same code as `POST /macs/cloud/v1/leases/7/tap`.
4. `api.ts` asks CloudFleet for lease 7: it must belong to this org and its phone must be running.
   It gets back the phone id and its host.
5. `host.ts` sends `POST http://10.77.0.1:7400/v1/phones/<id>/sock` with the vphone.sock line
   `{"t":"rpc","method":"input.tap","params":{"x":120,"y":640},"settle":true}`.
6. `fleet serve` relays the line to `<vm>/vphone.sock`. `vphone-vm` runs the tap, waits for the
   screen to settle and answers with the JPEG frame.
7. `api.ts` shapes the reply as the daemon's `ActionResult`, and `mcp.ts` as the daemon's MCP text.
8. CloudFleet records lease activity, so the idle timeout restarts.

## Database

Postgres keeps what was bought. CloudFleet keeps where it runs. Migration: one new table and one
new column, `pnpm -C db generate`, applied with `pnpm db:migrate:prod` before the deploy.

```prisma
model CloudPhone {
  id             String    @id @map("cloud_phone_id")   // "cph_" + ulid
  orgId          String    @map("org_id")              // org.org_id, onDelete: Cascade
  name           String                                // "Cloud iPhone 1", renamable
  subscriptionId String?   @unique @map("subscription_id") // Stripe sub id, set by the webhook
  status         String    // pending | active | past_due | canceled; storage is never deleted
  template       String    // VPhone template key the phone was cloned from
  createdAt      DateTime  @map("created_at")
  updatedAt      DateTime  @map("updated_at")
  @@index([orgId])
  @@map("cloud_phone")
}

model Subscription {
  // existing columns unchanged
  kind String @default("pro") // pro | cloud_phone, set by syncSubscription from product metadata
}
```

- `kind` keeps cloud subscriptions out of `entitlementFor`, `subscribeRedirectUrl` and the plan
  shown on the dashboard. Without it a cloud phone would make the org Pro.
- `getPersonalOrg` (`website/src/db.ts`) also loads `cloudPhones`. Add the relation to the `org`
  relations in `db/src/schema.ts`.

## Stripe

**Product and price**, created once by `website/scripts/stripe-cloud-phone.ts` (idempotent, by
lookup key), for test and live mode:

- Product `ghosthand cloud iPhone`, metadata `{app: "ghosthand", kind: "cloud_phone"}`.
- Price $49/month, lookup key `ghosthand_cloud_phone_monthly`, constant next to
  `PRO_PRICE_LOOKUP_KEY` in `website/src/lib/billing.ts`.
- Portal configuration `bpc_...`: add the product, quantity fixed at 1, cancel at period end.

**Checkout**, new `cloudPhoneCheckoutUrl({org, email, returnUrl})` in `website/src/lib/stripe.ts`:

1. Insert a `cloud_phone` row with status `pending` and a new id.
2. `getOrCreateStripeCustomer` (the same customer as Pro, never a second one).
3. `checkout.sessions.create`: `mode: subscription`, one line item, quantity 1, no adjustable
   quantity, `metadata` and `subscription_data.metadata` = `{orgId, app, kind: "cloud_phone",
   cloudPhoneId}`. Idempotency key includes the phone id.
4. Route `GET /cloud-phones/new` in `server.tsx` (login first if signed out, like `/subscribe`).

Abandoned checkouts leave `pending` rows. The daily cron deletes `pending` rows older than one day
that have no subscription.

**Webhook** (`website/src/stripe-webhook.ts`), the same four events:

- `syncSubscription` sets `kind` from the product metadata and returns it with `cloudPhoneId`
  from the subscription metadata.
- For `cloud_phone`: set `cloud_phone.subscription_id` and `status` from the subscription status.
  `syncSourceAccess` runs only for `pro`.
- Then `CloudFleet.setAccess(phoneId, allowed)`. Allowed is `active`, `trialing` or `past_due`
  (Stripe is still retrying, same as Pro). `canceled` and `unpaid` block new leases and end the
  running one at the next scheduler step. Storage stays forever. Renewing from the dashboard runs
  a new checkout with the same `cloudPhoneId`, so the same phone comes back.

**Fixes needed in existing code:** `entitlementFor`, `subscribeRedirectUrl` (including its "open
checkout" reuse and "live subscription goes to portal" shortcuts) and the dashboard's subscription
pick filter on `kind = "pro"`.

**Phone tasks:** an org with an allowed cloud phone gets unlimited task prompts (`taskDecision`),
unless the user decides otherwise (open question).

## Website: `website/src/cloud/`

### `fleet.ts`: CloudFleet Durable Object

One instance (`idFromName("fleet")`), SQLite storage. It is the only writer of runtime state, so
every decision is serialized.

```prisma
model Host {          // set by scripts/cloud-host.ts
  slug       String  @id
  address    String  // "10.77.0.1:7400", private IP routed to the host's tunnel
  slots      Int     // max running phones, from measured RAM per phone and a host reserve
  enabled    Boolean // false drains: no new starts
  online     Boolean // last status call answered
  lastSeenAt DateTime
}
model PhoneRuntime {
  phoneId      String  @id
  orgId        String
  allowed      Boolean   // from setAccess
  state        String    // stored | starting | running | stopping
  host         String?   // where it runs or is cached
  version      Int       // newest version anywhere
  newestOn     String    // host slug or "r2"
  r2Version    Int       // newest uploaded version, 0 = never
  idleSince    DateTime? // set when the last lease ended
}
model Lease {
  n            Int     @id // the `<n>` in cloud:<n>
  phoneId      String
  orgId        String
  label        String
  reason       String
  idleTimeout  Int      // seconds, default 600, like USB leases
  lastUsedAt   DateTime
}
model Waiter {          // FIFO queue of acquires that wait
  id        Int @id
  phoneId   String
  orgId     String
  createdAt DateTime
}
model Event {           // last 1000 scheduler events, for replay and debugging
  id      Int @id
  at      DateTime
  json    String
}
```

RPC methods, called by `api.ts`, the webhook and the scripts:

| Method | Does |
|---|---|
| `devices(orgId)` | The org's phones with state, for `/v1/devices` and `list` |
| `acquire({orgId, phoneId, label, reason, idleTimeout, waitSeconds})` | Lease now, or start the phone and resolve when it runs, or wait in the queue up to `waitSeconds` |
| `release({orgId, n})` | End a lease |
| `lease({orgId, n})` | Phone id and host for a running, owned lease; bumps `lastUsedAt` |
| `setAccess({phoneId, orgId, allowed})` | From the webhook |
| `addHost`, `removeHost`, `recover(phoneId)` | From `scripts/cloud-host.ts` |
| `alarm()` | Lease idle expiry, and polling hosts while a start or stop is in flight |

The DO runs `step(state, event)` from `scheduler.ts` for every event, saves the new state and the
event, then performs the returned actions through `host.ts`. Results come back as new events.
Start and stop take seconds to minutes, so the host answers `202` and the DO polls
`GET /v1/status` every 3 s from its alarm, only while a transition is in flight. No timers run
when nothing moves.

### `scheduler.ts`: pure rules

```ts
type Event =
  | { type: 'acquire'; phoneId; orgId; waiterId }
  | { type: 'lease-ended'; n; at }                  // release or idle timeout
  | { type: 'host-status'; host; status }           // from polling or a call
  | { type: 'started' | 'stopped'; phoneId; host; version }
  | { type: 'access'; phoneId; allowed }
type Action =
  | { type: 'start'; phoneId; host; version }        // host downloads first if its copy is older
  | { type: 'stop'; phoneId; host; uploadVersion }
  | { type: 'grant'; waiterId }                      // resolve a waiting acquire
  | { type: 'reject'; waiterId; code }               // subscription-required, ...
```

Rules, applied in order on every event:

1. A phone runs on at most one host. Never start a phone whose newest copy is on an offline host;
   it waits for that host (Mac crash case). Only `recover` moves it to `r2Version`.
2. For each waiter in FIFO order whose phone is stopped and allowed:
   - the host with its newest copy, if online, enabled and with a free slot;
   - else, if the newest copy is in R2: the enabled online host with the most free slots, then
     slug;
   - else stop the unleased running phone with the oldest `idleSince`, if idle at least
     `GRACE` (10 min), on the host the waiter can use; the waiter stays first in line;
   - else keep waiting.
3. A running phone with no lease and no waiter for its slot keeps running.
4. A phone whose access is removed loses its lease and is treated as idle since now.
5. Stopping always uploads; `newestOn` becomes R2 only after the upload finished.

`scheduler.test.ts` replays event lists and checks the actions with inline snapshots: grace time,
FIFO order, one host per phone, waiting for an offline host, access removal, host drain.

### `api.ts`: ghosthand REST to vphoned

Spiceflow app mounted for `/macs/cloud/v1/*` and called in-process by `mcp.ts` and tasks. Types
come from `src/generated/daemon-api.ts`. Coordinates are screen points on both sides (daemon
default scale and vphoned gestures), so no conversion is needed at scale 1.

| Daemon route | vphone.sock / vphoned |
|---|---|
| `GET /v1/devices` | `CloudFleet.devices`, model and iOS from the template |
| `POST /v1/leases`, `DELETE /v1/leases/{n}` | `CloudFleet.acquire`, `release` (SSE wait like the daemon when `waitSeconds`) |
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
- `storage.ts`: R2 key layout and manifest types, shared with the fleet docs. The Worker only
  reads manifests (sizes for the dashboard); hosts do the uploads.
- `apps.ts`: the catalog. `{id: "tiktok", name: "TikTok", bundleId, appStoreId: 835599320,
  version, key: "apps/tiktok/33.8.0.ipa", sha256}`. `install` presigns a GET for the host (1 hour).
  Also served at `GET /api/cli/apps/catalog` for the daemon's App Store path.

### Changes to existing website files

| File | Change |
|---|---|
| `tunnel.ts` | The Worker passes `x-ghosthand-org` to the hub (trusted, set after stripping client headers). `GET /macs` adds `{slug: "cloud", name: "Cloud", online: true}` when the org has a cloud phone. `forwardApi` and `daemonFetch` send slug `cloud` to `api.ts` before the online-Mac check. `collect` handles `cloud` for the `list` fan-out |
| `lib/mcp-routing.ts` | New input `cloud: boolean`. Lease prefix `cloud` and `mac: "cloud"` route to `{kind: "cloud"}`. `list` fans out to `cloud` too. A cloud-only org never gets the no-Mac reply; instructions and `setup-status` say the phone is ready to acquire |
| `task.ts` | Nothing, if the branch is in `daemonFetch`. The task system prompt says "iPhone", which fits |
| `server.tsx` | `/cloud-phones/new` route, `CloudFleet` export, dashboard data |
| `components/account-pages.tsx` | "Cloud iPhones" section after Plan: one row per phone (name, running/stopped/queued, renews or ended), Rent button, Manage (portal), Rename |
| `actions.tsx` | `renameCloudPhone` |
| `telemetry.ts` | `cloud_phone_checkout_opened`, `cloud_phone_activated`, `cloud_phone_canceled`, `cloud_phone_started` (ids and counts only) |
| `wrangler.jsonc` (top level and `env.preview`) | DO `CLOUD_FLEET` + migration `cloud-fleet-v1`; R2 `PHONES` (`ghosthand-phones`, preview bucket separate); `vpc_networks` binding `HOSTS`; secrets `R2_PHONES_ACCESS_KEY_ID`, `R2_PHONES_SECRET_ACCESS_KEY` (presigning) |
| `test-runtime-worker.ts` | Export `CloudFleet` |
| `scripts/cloud-host.ts` | `add <slug> --address --slots`, `remove`, `drain`, `list`, `recover <phone>` through an admin-only route |

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
| `VPhoneFleetStorage.swift` | Chunk sync with R2 over the S3 API (SigV4 with CryptoKit, `URLSession`) |
| `VPhoneFleetCache.swift` | Free-disk check, least recently used eviction of uploaded stopped phones, IPA cache by sha256 |

Fleet API, all JSON, no auth (reachable only through the tunnel):

| Route | Does |
|---|---|
| `GET /v1/status` | `{host, slots, freeDiskBytes, bundleVersion, templates, phones: [{id, state, version, uploadedVersion, lastUsedAt, error?}]}` |
| `POST /v1/phones/{id}/start {version, template}` | `202`. Clone or download to reach `version` if needed, then launch |
| `POST /v1/phones/{id}/stop {uploadVersion}` | `202`. Shut down, upload as `uploadVersion` |
| `POST /v1/phones/{id}/sock` | Relay one vphone.sock JSON line, return its reply. Any new vphone.sock command works without a fleet change |
| `POST /v1/phones/{id}/push-url {url, sha256, path}` | Download to the IPA cache (or reuse), then vphone.sock `push` |

**R2 layout** (bucket `ghosthand-phones`; the host has an R2 token for this bucket only):

```
templates/<key>/manifest.json       chunk list of the template Disk.img and its small files
chunks/<sha256>                      4 MiB chunk, LZ4 compressed (libcompression)
phones/<id>/<version>/manifest.json  {template, size, chunks: [sha256 | "0"], files: {...}}
phones/<id>/<version>/config.plist, SEPStorage, nvram.bin, PatchReceipt.plist, restore-info.json
apps/<id>/<version>.ipa              catalog IPAs, uploaded by hand
```

- **Upload on stop:** walk only allocated ranges of `Disk.img` (`SEEK_DATA`), hash 4 MiB chunks,
  upload chunks whose hash is not in the previous manifest or the template manifest, then the small
  files, then the manifest last. A missing manifest means the version does not exist.
- **Download on start:** `clonefile` the local template, read the manifest, write chunks that
  differ (from another local cached phone when its manifest has the hash, else from R2), punch
  holes for `"0"`, then copy the small files. Write `fleet.json` with the version last.
- The template must exist on every host with the same bytes: hosts download it from
  `templates/<key>/` once, never build their own.

**Machine setup** (written as `docs/cloud-hosts.md` in this repo): VPhone bundle install,
`vphone-escalator allow`, `vphone-usb-guard` launchd job (PR #2), `cloudflared` tunnel with the
host's `/32` route and an `lo0` alias for that IP, `fleet serve` launchd job with the R2 token from
Sigillo, template download.

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
| `website/src/cloud/scheduler.test.ts` | Event log replays, inline snapshots |
| `website/src/cloud/cloud.test.ts` | `api.ts` + `mcp.ts` against a scripted fake host (like the fake Mac in `task.test.ts`), org isolation, MCP tool coverage |
| `website/src/lib/billing.test.ts` | `kind` filter: a cloud subscription does not make an org Pro |
| fork `VPhoneCommandTests` | Manifest diff and restore on sparse files |
| e2e on mintmacbook | Buy in Stripe test mode, acquire, tap, install TikTok, stop, start on a second machine folder |
