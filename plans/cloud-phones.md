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

- [ ] A Worker with a Workers VPC binding reaches a stub on mintmacbook `127.0.0.1` through `cloudflared`, no public hostname. Pass with round-trip times, a streamed JPEG, a WebSocket upgrade and the largest body that passes, written here.
- [ ] Two Macs addressed by one binding. Pass with both stubs answering by name.

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

## Done

- [ ] A new user with no Mac buys a phone, installs TikTok from the catalog, controls it through MCP and a phone task; a second tenant cannot reach it; the phone stops for a waiting one after the grace time and starts later on another Mac with its data kept.

## Open questions (user)

1. **Availability:** may a paid phone queue? Default: yes, at most 2 phones sold per slot at first.
2. **Phone tasks:** included for cloud renters? Default: unlimited, like Pro.
3. **Legal:** renting VMs on Apple firmware and serving decrypted IPAs has licensing risk. Get a view before charging.

Decisions: `plans/decisions/cloud-phones-architecture.md`, `plans/decisions/plan-device-limits.md`,
`plans/decisions/virtual-iphone-account.md`
