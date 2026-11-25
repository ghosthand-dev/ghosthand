# Cloud phones plan

Rent virtual iPhones (VPhone VMs on our Macs) at $49/month per phone, controlled with the same
ghosthand MCP, REST, CLI and phone tasks as USB iPhones. The Worker translates the ghosthand
API into vphoned RPC, so new VPhone versions need only a Worker deploy.

Read first: `docs/cloud-phones.md` (the detailed design: database, Stripe, routes, files),
`plans/decisions/cloud-phones-architecture.md`,
`docs/research-notes/vphone-ipa-trial/how-vphone-works.md`, `vm-density-resume.md`, and the
fork's `AGENTS.md` and `Research/Host/hosted_isolation.md` (PR #2).

Check a box only when its evidence exists (command output, log line, commit SHA). Write the
evidence next to the box. VMs run on mintmacbook only; it has no GitHub credentials, so push
from the coordinating Mac. Code privacy is out of scope for now.

## Components

Full file list, routes, tables and Stripe setup: `docs/cloud-phones.md`. In short:

- **Website** `website/src/cloud/`: fleet state in Postgres (`fleet.ts`: one acquire
  transaction, a minute cron) and pure rules (`scheduler.ts`), `api.ts` + `mcp.ts` translating the
  daemon API to vphone.sock and vphoned RPC, catalog, R2 layout. The Worker answers slug `cloud`
  before the hub. Stripe $49 price, `cloud_phone`, `cloud_host`, `cloud_lease`, `subscription.kind`.
- **VPhone fork**: `vphone-cli fleet serve` (start, stop, chunk sync with R2, vphone.sock relay,
  push from URL), vphone.sock `settle`, PR #1 and #2.
- **Daemon**: `app catalog` and `app install --app <id>`: cloud phones get the R2 IPA through
  lease forwarding; USB phones install the same catalog app from the App Store.

## Scheduler v1 rules

Pure functions over Postgres rows (`place`, `reconcile`); the acquire transaction and the minute
cron apply them.

- Each Mac has a fixed slot count (measured RAM per phone plus a host reserve).
- A phone runs on at most one Mac. Its newest copy is where it last ran: that Mac's cache, or R2
  once its upload finished.
- Acquire a running phone: lease it. Acquire a stopped one, first match wins:
  1. the Mac that holds its newest copy, if online with a free slot,
  2. if R2 has the newest copy: any Mac with a free slot (fewest running, then slug),
  3. stop the unleased phone idle longest, if idle at least the grace time (default 10 min),
  4. else wait: acquire polls every 3 s like `ghosthand wait` (no queue: the first poll after a slot frees takes it).
- If the Mac with the newest copy is offline, the phone waits for it. Only the operator script
  moves it to its older R2 copy.
- A lease ends by release or its idle timeout (same as USB leases, default 600 s). That only
  records the idle time. Stops happen only to make room, then upload; the local copy stays.
- Local cache: evict uploaded, stopped phones least recently used when free disk is low.
- Cancelled subscription: no new leases; storage kept forever; renewing gives the same phone.

## Task 1: Tunnel spike (parallel with Tasks 2 and 3, first)

- [x] A Worker with a Workers VPC binding reaches a stub on mintmacbook `127.0.0.1` through `cloudflared`, no public hostname. Pass with round-trip times, a streamed JPEG, a WebSocket upgrade and the largest body that passes, written here.
  Evidence (2026-11-25, cloudflared 2026.11.2, QUIC, Worker on `*.workers.dev`, colo MXP):
  - `tunnel_id` binding: `127.0.0.1:7401` on mint answered (`{"name":"mint-loopback"}`); so did `10.77.0.1:7400` (lo0 alias) through both `tunnel_id` and `cf1:network` with a `/32` route.
  - Round trip, 30 sequential `GET /ping`: p50 51-55 ms, p90 60 ms, min 43 ms, from a Worker and from a DO alike. mint to the edge is 20 ms by ICMP, so Workers VPC adds about 30 ms. First call after deploy: 60-200 ms.
  - Streamed JPEG (273 KB, 16 KiB chunks): first byte at 70-100 ms (200 ms cold), all of it at 240-400 ms. With a 50 ms gap per chunk, chunks arrive as sent (first byte 67 ms, end 940 ms), so the response really streams.
  - WebSocket: `fetch(url, {headers: {Upgrade: 'websocket'}})` on the binding gives `101` and `res.webSocket`. Upgrade 80-100 ms, echo p50 43-47 ms from a Worker, 22 ms from a DO.
  - Bodies, streamed both ways, sizes and sha256 checked: 1, 10 and 100 MiB pass each way. Throughput about 2.1-2.2 MB/s both ways; mint's own uplink is 2.4 MB/s, its downlink 10 MB/s, so downloads to the host are slower through the tunnel than direct. Hosts must fetch IPAs and R2 chunks directly, never through the tunnel. 1 GiB request body to the host: 200 in 458 s, sha256 matched. 1 GiB response passed through the Worker unread (`new Response(res.body)`): 200, all bytes, 445 s. 1 GiB response read chunk by chunk in the Worker failed after 384 s with `error code: 1102` (Worker exceeded resource limits, from the JS read loop, not the tunnel). So no size limit was found; `host.ts` must pipe big bodies, never loop over them.
  - 20 parallel JPEGs through one binding: all 200 and complete, 0.3-2.4 s, bound by mint's 2.4 MB/s uplink. Quiet-link round trip: mint p50 51 ms, laptop p50 68 ms.
  - Long responses: `/slow` with no byte for 60 s, 120 s and 300 s returned 200 on time, from a Worker and from a DO. A 300 s response with a line every 10 s streamed all 30 lines.
  - Errors are fast (about 200 ms) and typed: `ProxyError: destination_unavailable` (tunnel down), `connection_refused` (tunnel up, nothing listening), `destination_ip_prohibited` (no route for the IP), `dns_error`. A restarted `cloudflared` answered again within 1 s.
- [x] Two Macs addressed by one binding. Pass with both stubs answering by name.
  Evidence: one binding `{"network_id": "cf1:vnet:<vnet>"}` on the virtual network `ghosthand-cloud-spike-vnet`, two tunnels (mint, and this Mac as the second host), one `/32` route each. `/hosts` mapped the slugs to addresses like the fleet's host table and both answered in parallel: `{"mint": {"address": "10.77.0.1:7400", "reply": {"name": "mint"}, "ms": 68}, "laptop": {"address": "192.168.1.105:7400", "reply": {"name": "laptop"}, "ms": 63}}`. Round trip to each: p50 76-81 ms while a 1 GiB transfer loaded the shared home link.
  - The same binding could not reach mint's `127.0.0.1:7401` or its LAN address `192.168.1.6:22` (`destination_ip_prohibited`), and the default-network binding could not reach the laptop route. The vnet binding reaches only the routed `/32`s.
  - Hostname routes (`mint.ghosthand-cloud-spike.internal` to the mint tunnel) failed with `dns_error` from both binding types, even with the name in mint's `/etc/hosts`: the name is resolved by DNS, not by the host's hosts file. Names need a real DNS record and add nothing over the `Host` table.

  **Addressing for `host.ts`:** by private IP. One Workers VPC binding `HOSTS = {"network_id": "cf1:vnet:<ghosthand-hosts vnet>"}`, in a virtual network used only for hosts. Each host has its own remotely managed tunnel, one route `10.77.0.<n>/32` in that vnet, and the same IP as an `lo0` alias that `fleet serve` listens on (port 7400). `host.ts` builds `http://<Host.address>/v1/...` from its `cloud_host` row; host slugs are names in our table, not DNS. Adding a host is API calls only (tunnel, route, `cloud_host` row), no Worker deploy.
  - Not `tunnel_id` bindings: one binding per host means a deploy per host, and they reach `127.0.0.1` and the whole LAN of the host (the vphone operator API, the router).
  - Not `cf1:network`: it reaches every route of the account's default network, and the public internet through Gateway.
  - `fetch` on the binding throws on network errors; `host.ts` maps `destination_unavailable` to host offline.
  - All `ghosthand-cloud-spike-*` resources are deleted. Production setup (2026-11-25): vnet `ghosthand-hosts`, tunnel `ghosthand-host-mint` with route `10.77.0.1/32`, launchd jobs on mint, `HOSTS` in `website/wrangler.jsonc`. Steps for the next host: `docs/cloud-hosts.md`. A Worker on that vnet got `connection_refused` with nothing listening, the stub's reply with one (p50 67 ms), and `destination_ip_prohibited` through the default network. After `pkill cloudflared`, launchd restarted it and the host answered again in 2 s; `launchctl kickstart` of `host-ip` restored a removed alias. Not tested: a real reboot (it would stop the `app-lab` VM).
  - Creating vnets, tunnels and routes needs the Connectivity Directory Admin role; the wrangler OAuth token has it (`connectivity (admin)`), and `cf tunnels`, `cf network routes cidr` and `cf network virtual-networks` do it.

## Task 2: Phone storage in R2 (parallel with Tasks 1 and 3)

- [ ] A stopped phone uploads as template id plus changed chunks and restores into a new machine folder. Pass when the restored phone boots with the TikTok sign-in kept, with sizes and times written here.
  Done except TikTok (2026-11-25, fork `d02500e3`, numbers in the fork's `Research/Host/fleet.md`): through the tunnel with `website/src/cloud/storage.ts` (`saveBatch`, `loadBatch`) in a throwaway Worker, phone `cph_a` (template `13e3716a2e12`, one IPA installed) saved version 1 as 291 chunks + 13 files, 662 MB LZ4, in 275 s (mint uplink, 2.4 MB/s). Its folder was moved off the host, then version 2 loaded from R2: 367 blobs in 238 s, restore 2.1 s (1.55 GB written), start 24 s, the installed app still listed. On loopback (`vphone/scripts/tests/fleet-storage-roundtrip.zsh`) a marker file and a preference written in the guest survived save (8.5 s), load (6.6 s), restore (4.2 s) and start (24.5 s).
  Open: no TikTok sign-in to keep. The only TikTok IPA (`~/.local/share/vphone-ipa-trial/tiktok-original.ipa`, 47.8.0, ipatool) is FairPlay encrypted (`cryptid 1`), so it does not run on a VM; the catalog needs a decrypted IPA first.
- [ ] A second upload of an unchanged phone sends almost nothing. Pass with the byte count.
  Fails as written: a phone that only booted again changes 229 to 290 chunks per stop (445 MiB LZ4 on loopback; 287 chunks, 265 s through the tunnel). A disk compare before and after one boot and 20 s idle: 150 MiB changed at 4 KiB granularity, 523 MiB at 1 MiB, about 1 GiB at 4 MiB. The guest's boot writes are spread over the disk, so smaller chunks only halve it. A stop of a phone that did not run sends nothing (`stop` answers 200, same version). Next: measure the trimmed-services template `7db0faf75773`, or keep running phones longer between stops.
  Since 2026-11-25 storage is 64 KiB blocks in ~32 MiB packs (format in the fork's `Research/Host/fleet.md`). Loopback on mint, phone cloned from the template: a second version after one more boot sends 168 MB in 5 packs (was about 445 MiB LZ4); a restored phone stopped again without running sends nothing. Restores of both versions into new phones matched the source `Disk.img` sha256 and booted. Not yet run through the tunnel.

## Task 3: Fork ready for tenants (parallel with Tasks 1 and 2)

- [x] PR #1 and #2 merged; hosted VMs reach the internet only through the fail-closed proxy while `vphone-usb-guard` holds the USB link. Pass when the hosted e2e and a proxy leak test pass on two guests.
  Evidence (2026-11-25, mint, bundle built from fork `d02500e3`): `scripts/tests/hosted-isolation-e2e.zsh` on `iso-tenant-a` and `iso-tenant-b`: 62 PASS, 0 failures. `scripts/tests/fleet-proxy-leak.zsh` on two fleet phones in tunnel mode with hev-socks5-server: 16 PASS, 0 failures (http and https through the proxy; the Mac canary on `*:18777` unreadable at the gateway, `127.0.0.1`, the LAN and Tailscale addresses; nothing loads with the proxy stopped; loads again without a VM restart). The guard log shows each fleet VM held (`holding USB device ... of VM service`).
  The vphoned "Could not install update" loop: not debugged. A guest gets this bundle's vphoned offline with `sudo vphone-cli cfw update-environment <machine>` (21 s), and `fleet serve` runs it before starting a phone whose recorded bundle differs; no live update happens after it.
- [x] `--hosted` works without `--api-listen`, headless. Pass with a hosted VM driven only through `vphone.sock`.
  Evidence: `fleet serve` launches every phone `vm launch <id> --headless --hosted` with no API port; `cph_t1`, `cph_p1`, `cph_p2`, `cph_a`, `cph_b` were unlocked, opened Settings, tapped, installed an IPA and ran guest scripts only through `POST /v1/phones/<id>/sock`. Folder mode `drwx------`.
- [ ] vphone.sock `settle` returns the frame after the screen stops changing, captured on the host. Pass with tap-to-frame times on Settings and TikTok.
  Settings done (fork `211bd99f`, frames from `VPhoneGraphicsDisplayCapture`, headless screenshots use it too): through `fleet serve` on a hosted phone, `screen.unlock` 2.05 s (settled 1101 ms), `apps.launch` Settings 1.84 s (1254 ms), tap General 2.00 s (reaction 320 ms, settled 1565 ms: a new list page differs under 20%, so it waits the 1.5 s dialog window like the daemon). Open: TikTok, same IPA problem as Task 2.

## Task 4: `vphone-cli fleet serve` (sequential, after Tasks 1 and 2)

- [x] Runs under launchd on mintmacbook behind `cloudflared` with the routes above. Pass when curl through the tunnel starts two phones, installs a catalog IPA by URL, stops one with upload, and a restart on the same Mac skips the download.
  Evidence (2026-11-25, fork `d02500e3`): LaunchDaemon `dev.ghosthand.fleet` (user tommy) serves `10.77.0.1:7400` from the root-owned bundle `/opt/ghosthand-host/VPhone.bundle`, library `~/.vphone/fleet` (setup in `docs/cloud-hosts.md`). Every call was curl to a throwaway Worker with the `HOSTS` binding (ghosthand-hosts vnet) and `PHONES` (ghosthand-phones): template manifest to R2 in 2.2 s; `cph_a` and `cph_b` started from the template in 64 s; IPA `apps/canary/1.ipa` R2 to host 0.8 s, push and `apps.install` (bundle `dev.isolation.canarybee385f5`) 2.6 s; stop and hash 10 s; save 291 chunks in 275 s; start of version 1 again 25 s with no restore and no blob request in the host log, app still installed. VMs survived restarts of `fleet serve`. One save attempt failed mid-copy with `ProxyError: destination_not_found` when `cloudflared` was restarted (SIGTERM at 15:31:32, not by this task); the retry passed.

## Task 5: Cloud module in the website (sequential, after Task 4; scheduler after Task 1)

- [ ] `scheduler.ts` passes table tests: eviction after grace, one Mac per phone, waiting for an offline Mac, every host report per phone state. Pass with vitest output.
  2026-11-25: the CloudFleet DO was replaced by Postgres + a minute cron (decision in `plans/decisions/cloud-phones-architecture.md`); `scheduler.test.ts` and `cloud.test.ts` pass on the new fleet against fake hosts.
- [ ] `api.ts` and `mcp.ts` serve list, acquire, release, wait, screenshot, screentext, tap, tap text, swipe, scroll, key, type, app list, launch, catalog install, and task tools on a real phone; others answer `unsupported-in-mode`. Pass with an MCP session and a test that org B cannot reach org A's lease.

## Task 6: Rent and bill (sequential, after Task 5)

- [ ] Stripe test mode: checkout for $49/month creates a `CloudPhone`; cancel blocks new leases and keeps storage; renewing restores the same phone. Pass with the webhook log and the phone's data present after renewal.
- [ ] Dashboard rents, lists and manages phones. Check with playwriter.
- [ ] A fresh account with no Mac gets a phone through MCP and REST; empty states name the next step. Pass end to end.

## Task 7: Daemon app catalog (parallel with Tasks 5 and 6)

- [ ] `ghosthand app catalog` and `app install --app tiktok -l cloud:<n>` work from this Mac's CLI and MCP; docs regenerated with `pnpm generate-docs`. Pass with the install visible in `app list`, and `swift test`.
- [ ] `app install --app <id>` on a USB iPhone installs from the App Store. Pass on a test iPhone with an app that is not installed yet, signed in to a test Apple ID.
  Done so far (daemon db2a30a): CLI, REST (`listCatalogApps`, `installCatalogApp`, SSE) and MCP (`app-catalog`, `app` on `app-install`); catalog in `website/src/cloud/apps.ts` at `GET /api/cli/apps/catalog`; docs regenerated; `swift test` 62/62 with an `appStoreGetButton` test on two real App Store screenshots.
  Manual run of the same steps (2026-11-25, SE2 iOS 18.6.2, identity `iphoneseblack`, test Apple ID): Spotlight `itms-apps://apps.apple.com/app/id1064216828` + enter opened Reddit's page; one tap on the download icon; `app list` showed `[installing]`, then missing for one read, then installed after about 55 s. Reddit was uninstalled after.
  Open: a live run of the daemon code needs the website route deployed and a dev daemon on the phone's Mac (both on hold: no deploy and no daemon restart without the user). Cloud leases need Task 5 (`app-catalog` tool and the SSE install route in `api.ts`/`mcp.ts`).

## Task 8: Slots from host memory, admin fleet page (parallel with Tasks 5 to 7)

Mockup: `docs/cloud-fleet-admin-mockup.html`. Decision: `plans/decisions/cloud-vm-memory.md`.

- [x] `fleet serve` derives its slots from `hw.memsize`: ⌊(RAM − 4 GiB) / 2 GiB⌋, from two constants in `Fleet/` that also set each VM's memory at start; the `--slots` and `--memory` flags are gone. `GET /v1/status` also reports RAM, memory used, compressed, swap, pressure level, CPU load, cores, uptime, and each phone's host footprint. Pass with mint reporting 10 slots and the metrics matching `memory_pressure` and `footprint`.
  Evidence (2026-11-25, fork `68af847a`, launchd on mint, 24 GiB): `GET /v1/status` reports `slots: 10`, `vmMemoryBytes: 2147483648`, `reserveBytes: 4294967296`, `machine: {memoryBytes: 25769803776, usedBytes: 8413495296, compressedBytes: 2128642048, swapUsedBytes: 565837824, pressure: "normal", load1: 1.25, cores: 18, uptimeS: 167649}`. `memory_pressure` showed 129922 compressor pages (x 16 KiB = 2128642048) and level 1; `vm.swapusage` used 539.62M (565837824). A running phone (config `memorySize` 2147483648) reported `footprintBytes: 2184548792`; `footprint` gave 2073 MB for its Virtualization service plus 11 MB for vphone-vm.
- [x] The cron writes `cloud_host.slots` from each report (the host is the only source); `cloud-host.ts add` drops `--slots`. Pass with a test: a fake host that reports 3 slots gets at most 3 running phones.
  Evidence (2026-11-25): `pollHost` (cron, acquire, `add`) writes `slots` with `last_seen_at`; a new host has 0 until it answers; `PUT /hosts/:slug` takes only `{address, status}`. `cloud.test.ts` "a host runs as many phones as the slots it reports": `trio` reports 3, three acquires get 201, the fourth gets 404 `no-device` (every server full) with 3 starts on the host; then the fake reports 4, one cron, and the fourth acquire gets 201. `sigillo run -c dev -- npx vitest --run src/cloud/ src/lib/`: 5 files, 21 tests passed.
- [x] `/admin/fleet`, signed-in users in `CLOUD_ADMINS` only (404 for others), with a link on their dashboard. One row per host of this environment: health from `last_seen_at`, a memory map (4 GiB macOS block, one 2 GiB block per slot, colored by org, leased solid, unleased hatched, starting or stopping pulsing, free dashed) with measured use under it, CPU, disk, cached and unsaved phones. Tooltip: email, phone, lease, reason, memory. Host status is fetched live in the page load, never stored. Check with playwriter.
  Done locally, not on preview (no deploy): a throwaway dev server (port 8049) with `HOSTS` bound to a passthrough worker, two fake hosts on 127.0.0.1 (mint with the new `machine`, `vmMemoryBytes`, `reserveBytes`, `footprintBytes`; studio as an older build without them) and one down, seeded into the local database. Playwriter in light and dark: memory map with reserve block, leased, hatched, pulsing and dashed cells, "VMs use" under it only when every footprint is known, "–" for studio's missing metrics, tooltip with email, phone, lease, reason and 2.2 GiB. curl: the admin gets 200, a signed-in non-admin and a signed-out request get 404 on the page (403 and 401 on the JSON route); only the admin's `/dashboard` has the `/admin/fleet` link. Seed rows removed after.
- [ ] Contention without a queue table: hosts that are full, phones in `starting` or `stopping`, idle phones that may be stopped at their grace time, and recent leases from `cloud_lease` (created, ended, idle) as the activity list. Pass on preview with two hosts, one full.
  Built and checked locally with the fake hosts above (studio full, one phone starting, one stopping, two idle with "stoppable now" and "stoppable in 4m", lease events acquired, ended, expired) and in `admin-view.test.ts`. Open: the preview check with two real hosts.
- [x] Customers table: phones, running and leased per org, emails through `org_member`. Colors are a fixed 8-color palette picked by a hash of the org id, the same on every page.
  Evidence: `ORG_COLORS` and `orgColor()` (FNV-1a) in `admin-view.ts`; the page showed 4 customers with their counts, and the `admin-view.test.ts` snapshot pins counts and colors.
- [x] One loader for the page and agents: `loadFleetView()` in `website/src/cloud/admin-view.ts` builds the whole view (hosts with live status, slots, contention, recent leases, customers) plus `problems: [{severity, code, host?, phone?, detail}]` from a pure `fleetProblems(view, now)`: host offline, memory pressure or swap, low disk, bundle versions differ, phone stuck in a transition, save backlog, every usable host full. The page's `.loader('/admin/fleet')` and `GET /api/cloud-admin/view` in `admin.ts` both call it (Spiceflow loaders are not endpoints). Auth on the route: API key or session of a `CLOUD_ADMINS` user. Pass with `curl` returning `{ok: problems.length === 0, problems, ...}` and inline-snapshot tests of `fleetProblems`.
  Evidence: `loadFleetView()` lives in `admin.ts` (it needs the database and the hosts); the pure `buildFleetView()` and `fleetProblems()` are in `admin-view.ts`, so their tests run without a Worker. `curl -H "authorization: Bearer <admin session>" localhost:8049/api/cloud-admin/view` returned `ok: false` with host-offline (critical), save-backlog, host-low-disk, bundle-versions-differ and phone-stuck. `admin-view.test.ts` snapshots every code, including no-usable-host and fleet-full; `cloud.test.ts` checks the route's auth and `{ok: false, problems: [fleet-full]}` for a full host.

## Done

- [ ] A new user with no Mac buys a phone, installs TikTok from the catalog, controls it through MCP and a phone task; a second tenant cannot reach it; the phone stops for a waiting one after the grace time and starts later on another Mac with its data kept.

## Open questions (user)

1. **Availability:** may a paid phone queue? Default: yes, at most 2 phones sold per slot at first.
2. **Phone tasks:** included for cloud renters? Default: unlimited, like Pro.
3. **Legal:** renting VMs on Apple firmware and serving decrypted IPAs has licensing risk. Get a view before charging.

Decisions: `plans/decisions/cloud-phones-architecture.md`, `plans/decisions/plan-device-limits.md`,
`plans/decisions/virtual-iphone-account.md`
