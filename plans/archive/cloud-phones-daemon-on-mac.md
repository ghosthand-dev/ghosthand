Status: dropped 2026-11-24. Superseded by `plans/cloud-phones.md`: no ghosthand daemon on rental
Macs, a private Worker translates instead, $49/month per phone instead of minutes.

# Cloud rented phones plan

Rent virtual iPhones (VPhone VMs on our Macs) to ghosthand users, controlled with the same
CLI, MCP and REST API as USB iPhones. This plan says which repo owns each piece, why, and
the build order. It covers Task 7 of `plans/virtual-iphone.md` (Ghosthand integration).

Read first: the private fork's `AGENTS.md` and `Research/Host/hosted_isolation.md` (PR #2),
and `docs/research-notes/vphone-ipa-trial/` (`vm-density-resume.md`, `boot-speed-options.md`,
`memory-reduction-options.md`, `app-removal.md`).

Check a box only when its evidence exists (command output, log line, commit SHA). Write the
evidence next to the box. Builds and VMs run on mintmacbook only; it has no GitHub
credentials, so push from the coordinating Mac.

## Where each piece lives

| Repo | Who can read it | Upstream |
| --- | --- | --- |
| `remorses/vphone-cli-private`, branch `ghosthand` | only us | Lakr233/vphone-cli, MIT, ~110 commits in 11 days |
| `ghosthand-dev/ghosthand-daemon` (`daemon/`) | us and every Pro subscriber | none |
| `ghosthand-dev/ghosthand` (`website/`: hub, billing) | public | none |

**Rule:** put each piece in the most private repo that can own it without a second copy of
daemon logic. Edit upstream VPhone files only with small hooks; put our code in new files.

```
tenant (MCP, REST, CLI) ──> ghosthand.dev hub ──fleet DO: placement, queue, billing──┐
                                                                                     │ WS
rental Mac ┌─ ghosthand daemon (provider org) <──────────────────────────────────────┘
           │     virtual phone driver ──tenant API, loopback + token──> VPhone VM (hosted)
           │     lease ensure/release ──unix socket──> vphone-fleet: boots, stops VMs
           └─ vphone-usb-guard (root): holds each hosted VM's USB link
```

| Feature | Lives in | Why |
| --- | --- | --- |
| Hosted isolation, `vphone-usb-guard`, per-VM SOCKS5 egress (PR #1, #2) | VPhone fork | Only the VM process and a root helper can enforce it. |
| Tenant provisioning: own SEP and Data keys per phone, trimmed profile, App Store removal, VMs under a dedicated macOS user | VPhone fork | Uses VPhoneCoreKit and guest RPC; changes with every VPhone version. |
| Fleet agent `vphone-fleet`: slot limit from measured RAM, boot on demand, stop idle phones, warm pool, per-tenant disks, health | VPhone fork, new target in its own folder | The secret part: capacity numbers and pool policy. A new folder never conflicts with upstream. |
| Virtual phone driver: `list`, screenshot, tap, swipe, type, key, settle and OCR over VPhone's tenant API; file and app commands mapped to its routes or `unsupported-in-mode` | daemon | Every CLI, MCP and task feature lives in `Controller`. It calls only VPhone's tenant API, which upstream already publishes, so Pro readers learn nothing secret. Self-hosted Pro users can also drive their own VPhone VMs. |
| Lease waits while a phone boots; acquire and release call the fleet agent | daemon, one thin socket client | Leases already live here. The policy behind the call stays in the fleet agent. |
| Tenant authorization: a lease of org A never reaches a phone of org B | hub and daemon | The hub owns the phone-to-org map. The daemon checks the org again, because one rental Mac serves many orgs. |
| Fleet registry and scheduler: rental Macs, capacity (sent on change, never on a timer), sticky phone-to-Mac placement, lease queue | website, a Durable Object next to `GhosthandHub` | Only the server sees all tenants and all Macs. Hub routing is per org today (`getHub(orgId)`); cloud phones route a tenant org to our provider org's Macs. |
| Billing: phone minutes from ready to release, reserved slots, Stripe metering | website (`lib/billing.ts`, Stripe) | Same place as today's plans. The website deploys from the public repo without the submodule. |
| Mac-less users | website, maybe daemon CLI | MCP and REST work without a Mac. The CLI talks only to a local daemon. Open question 3. |
| Native eSIM and SMS in the guest | VPhone fork, research only | Blocked: no modem or eUICC seam. Hosted SMS numbers, if wanted, go in the website. |

**Why not everything in the VPhone fork:**

- **Privacy:** the fork is the right home for the fleet agent and VM changes. But leases,
  tunnel, MCP, settle, OCR and the task agent already live in the daemon. A copy in the fork
  doubles the code and gives cloud tenants a different API than USB users.
- **Merge cost:** every edit to an upstream file is a future conflict. PR #1 rewrites
  upstream network files and PR #2 edits the API proxy and VM delegate; those are the
  expensive parts. Daemon and website code never conflicts with upstream.
- **What Pro readers see:** how to call VPhone's tenant API and one "ensure phone X" socket
  call. Pool policy, capacity, provisioning and isolation stay private.
- **Public website:** scheduling and billing rules become readable, but users see that
  behavior anyway. Keeping them private needs a separate private Worker, which breaks
  "the website builds without the submodule". Not the default.

## Task 1: Fork builds and ships (sequential, first)

- [ ] The `ghosthand` branch builds the full VPhone bundle, `vphone-usb-guard` included, on a Mac with Xcode. Pass with a build log and a hosted guest booted from that bundle.
- [ ] PR #1 and #2 merged; hosted mode allows tunnel networking only through the fail-closed proxy. Pass when the hosted e2e and a proxy leak test pass on two guests.
- [ ] One real merge of upstream `main` into `ghosthand`. Pass with the conflict count written here, and our upstream-file edits reduced to hooks where a conflict appeared.
- [ ] A rental Mac install from scratch: bundle, `vphone-escalator allow`, usb-guard launchd job. Pass when a written procedure brings a clean Mac to a running hosted guest.

## Task 2: Tenant provisioning (sequential, after Task 1)

- [ ] Each tenant phone has its own SEP root secret and Data volume keys. Pass when two phones are measured different, with creation time recorded (template clone is 0.13 s; `--no-template` is slower).
- [ ] The tenant profile: trimmed services, App Store per open question 1, VM process under a dedicated macOS user. Pass on a fresh phone with TikTok playback.
- [ ] RAM floor: bisect 1152 to 2048 MiB with signed-in playback. Pass with numbers in `vm-density-resume.md`.

## Task 3: Fleet agent (sequential, after Task 2)

- [ ] `vphone-fleet` boots phones on demand under a measured slot limit, stops idle ones, keeps a warm pool and answers ensure/release on a local socket. Pass with an overload test: requests past the limit wait, no VM is killed by memory pressure, density written here.

## Task 4: Daemon virtual phone driver (parallel with Tasks 2 and 3, after Task 1)

- [ ] A hosted VPhone guest is a phone in `list` with the same CLI, MCP and task behavior as a USB iPhone. Pass with `screenshot`, `tap`, `type`, `screentext` and one `task` on a hosted guest, plus `swift test`.
- [ ] Acquire waits through `booting` when the fleet socket exists, and the lease clock starts at ready. Pass with a cold phone acquired from the CLI and MCP.

## Task 5: Hub fleet routing and tenant auth (sequential, after Tasks 3 and 4)

- [ ] A tenant org gets its cloud phone through ghosthand.dev MCP and REST; a full Mac queues the lease. Pass with a queued lease that returns when a slot frees.
- [ ] Another org cannot reach that phone, at the hub or at the daemon. Pass with a test that sends org B's token to org A's lease on both layers.

## Task 6: Billing and onboarding (sequential, after Task 5)

- [ ] Phone minutes are metered from ready to release. Pass when Stripe test-mode usage matches lease durations.
- [ ] A new account with no Mac rents and controls a phone; every empty state says the next step. Pass with a fresh account end to end.

## Done

- [ ] A new user with no Mac and no iPhone signs up, rents a phone, opens an app, controls it through MCP and is billed for the minutes. A second tenant on the same Mac cannot reach it.

## Open questions (user)

1. **App source:** tenants need apps. Store login in the VM is unproven (`plans/virtual-iphone.md` Task 3). What may tenants install until it passes?
2. **Pricing:** minutes, monthly with included minutes, or reserved slots. Default: minutes plus reserved slots.
3. **CLI for Mac-less users:** a remote CLI mode, or MCP and REST only. Default: MCP and REST only.
4. **Upstream `--hosted`:** sending it to Lakr233 removes most merge cost but makes it public. Default: keep private.
5. **Legal:** renting VMs that run Apple firmware has licensing risk. Get a view before charging.

Decisions: `plans/decisions/daemon-source-access.md`, `plans/decisions/plan-device-limits.md`,
`plans/decisions/virtual-iphone-account.md`
