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

- **Website** `website/src/cloud/`: CloudFleet DO and pure scheduler, `api.ts` + `mcp.ts`
  translating the daemon API to vphone.sock and vphoned RPC, catalog, R2 layout. Hub routes slug
  `cloud` there. Stripe $49 price, `cloud_phone` table, `subscription.kind`.
- **VPhone fork**: `vphone-cli fleet serve` (start, stop, chunk sync with R2, vphone.sock relay,
  push from URL), vphone.sock `settle`, PR #1 and #2.
- **Daemon**: `app catalog` and `app install --app <id>`: cloud phones get the R2 IPA through
  lease forwarding; USB phones install the same catalog app from the App Store.

## Scheduler v1 rules

One pure function over the DO state. Same events in, same actions out.

- Each Mac has a fixed slot count (measured RAM per phone plus a host reserve).
- A phone runs on at most one Mac. Its newest copy is where it last ran: that Mac's cache, or R2
  once its upload finished.
- Acquire a running phone: lease it. Acquire a stopped one, first match wins:
  1. the Mac that holds its newest copy, if online with a free slot,
  2. if R2 has the newest copy: any Mac with a free slot (fewest running, then slug),
  3. stop the unleased phone idle longest, if idle at least the grace time (default 10 min),
  4. else queue FIFO; acquire waits like `ghosthand wait`.
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
  Evidence: one binding `{"network_id": "cf1:vnet:<vnet>"}` on the virtual network `ghosthand-cloud-spike-vnet`, two tunnels (mint, and this Mac as the second host), one `/32` route each. `/hosts` mapped the slugs to addresses like the CloudFleet `Host` table and both answered in parallel: `{"mint": {"address": "10.77.0.1:7400", "reply": {"name": "mint"}, "ms": 68}, "laptop": {"address": "192.168.1.105:7400", "reply": {"name": "laptop"}, "ms": 63}}`. Round trip to each: p50 76-81 ms while a 1 GiB transfer loaded the shared home link.
  - The same binding could not reach mint's `127.0.0.1:7401` or its LAN address `192.168.1.6:22` (`destination_ip_prohibited`), and the default-network binding could not reach the laptop route. The vnet binding reaches only the routed `/32`s.
  - Hostname routes (`mint.ghosthand-cloud-spike.internal` to the mint tunnel) failed with `dns_error` from both binding types, even with the name in mint's `/etc/hosts`: the name is resolved by DNS, not by the host's hosts file. Names need a real DNS record and add nothing over the `Host` table.

  **Addressing for `host.ts`:** by private IP. One Workers VPC binding `HOSTS = {"network_id": "cf1:vnet:<ghosthand-hosts vnet>"}`, in a virtual network used only for hosts. Each host has its own remotely managed tunnel, one route `10.77.0.<n>/32` in that vnet, and the same IP as an `lo0` alias that `fleet serve` listens on (port 7400). `host.ts` builds `http://<Host.address>/v1/...` from the CloudFleet `Host` row; host slugs are names in our table, not DNS. Adding a host is API calls only (tunnel, route, `Host` row), no Worker deploy.
  - Not `tunnel_id` bindings: one binding per host means a deploy per host, and they reach `127.0.0.1` and the whole LAN of the host (the vphone operator API, the router).
  - Not `cf1:network`: it reaches every route of the account's default network, and the public internet through Gateway.
  - `fetch` on the binding throws on network errors; `host.ts` maps `destination_unavailable` to host offline.
  - All `ghosthand-cloud-spike-*` resources are deleted. Production setup (2026-11-25): vnet `ghosthand-hosts`, tunnel `ghosthand-host-mint` with route `10.77.0.1/32`, launchd jobs on mint, `HOSTS` in `website/wrangler.jsonc`. Steps for the next host: `docs/cloud-hosts.md`. A Worker on that vnet got `connection_refused` with nothing listening, the stub's reply with one (p50 67 ms), and `destination_ip_prohibited` through the default network. After `pkill cloudflared`, launchd restarted it and the host answered again in 2 s; `launchctl kickstart` of `host-ip` restored a removed alias. Not tested: a real reboot (it would stop the `app-lab` VM).
  - Creating vnets, tunnels and routes needs the Connectivity Directory Admin role; the wrangler OAuth token has it (`connectivity (admin)`), and `cf tunnels`, `cf network routes cidr` and `cf network virtual-networks` do it.

## Task 2: Phone storage in R2 (parallel with Tasks 1 and 3)

- [ ] A stopped phone uploads as template id plus changed chunks and restores into a new machine folder. Pass when the restored phone boots with the TikTok sign-in kept, with sizes and times written here.
- [ ] A second upload of an unchanged phone sends almost nothing. Pass with the byte count.

## Task 3: Fork ready for tenants (parallel with Tasks 1 and 2)

- [ ] PR #1 and #2 merged; hosted VMs reach the internet only through the fail-closed proxy while `vphone-usb-guard` holds the USB link. Pass when the hosted e2e and a proxy leak test pass on two guests.
- [ ] `--hosted` works without `--api-listen`, headless. Pass with a hosted VM driven only through `vphone.sock`.
- [ ] vphone.sock `settle` returns the frame after the screen stops changing, captured on the host. Pass with tap-to-frame times on Settings and TikTok.

## Task 4: `vphone-cli fleet serve` (sequential, after Tasks 1 and 2)

- [ ] Runs under launchd on mintmacbook behind `cloudflared` with the routes above. Pass when curl through the tunnel starts two phones, installs a catalog IPA by URL, stops one with upload, and a restart on the same Mac skips the download.

## Task 5: Cloud module in the website (sequential, after Task 4; scheduler after Task 1)

- [ ] `scheduler.ts` passes tests replaying event logs: eviction after grace, FIFO queue, one Mac per phone, waiting for an offline Mac. Pass with vitest output.
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

## Done

- [ ] A new user with no Mac buys a phone, installs TikTok from the catalog, controls it through MCP and a phone task; a second tenant cannot reach it; the phone stops for a waiting one after the grace time and starts later on another Mac with its data kept.

## Open questions (user)

1. **Availability:** may a paid phone queue? Default: yes, at most 2 phones sold per slot at first.
2. **Phone tasks:** included for cloud renters? Default: unlimited, like Pro.
3. **Legal:** renting VMs on Apple firmware and serving decrypted IPAs has licensing risk. Get a view before charging.

Decisions: `plans/decisions/cloud-phones-architecture.md`, `plans/decisions/plan-device-limits.md`,
`plans/decisions/virtual-iphone-account.md`
