# Cloud phones: Worker translates, Mac runs vphone-cli fleet, $49 per phone (human)

- User, 2026-11-24: "rent phones that we will sell at $49 per month", "we associate each VM to a specific subscription on Stripe".
- User, 2026-11-24: "store this phone storage in a bucket on Cloudflare so that the phone can move around in other machines ... use the local disk as a kind of cache."
- User, 2026-11-24: "the connection between the machine and the Cloudflare Worker does not have authentication. Instead, we put authentication in the Cloudflare Worker", "I would like to use Tailscale if possible, or maybe a tunnel, not a Durable Object."
- User, 2026-11-24: scheduler "very simple ... when a lease ends, we wait some time, and if the phone is idle, we shut it down if there is another one that wants to come up ... very deterministic."
- User, 2026-11-25: "Don't cancel storage. We just keep it forever."
- User, 2026-11-25: "For the Mac crash, let's try to use the cached on this one, obviously, because it's the most up to date."
- User, 2026-11-25: "we have a command and API to install a specific app, and we have a list of supported apps like Reddit, TikTok ... Assume that this is available on the bucket for download."
- User, 2026-11-25: "anything that we will need to add support for in the machine that we install vPhone to, let's assume that we existing CLI and API via RPC works ... we add new commands to do stuff via RPC."
- User, 2026-11-25: "we translate our own API to RPC commands in Cloudflare Worker, so that that code is not in the CLI, and we can quickly update it."
- User, 2026-11-25: "For now, let's ignore the fact that we need to keep some parts of the code private. Just decide what is the best place to put each component ... Then later we can think of using submodules of private."

Shape:

```
tenant (MCP, REST, CLI on any Mac) ──> ghosthand.dev Worker: auth, Stripe, hub routing
   slug `cloud` ──> website/src/cloud: CloudFleet DO (scheduler) + ghosthand API -> vphoned RPC
   ──Workers VPC over Cloudflare Tunnel (no auth, no public hostname)──> vphone-cli fleet serve
        (fork: VM start and stop, R2 sync, disk cache, push from URL) ──> VPhone VMs, vphoned RPC
R2: template chunks, per-phone deltas, SEPStorage, nvram, config; supported app IPAs
```

- (agent) **Tunnel, not Tailscale:** Workers cannot join a tailnet without a WASM node inside a Durable Object. Cloudflare Tunnel plus a Workers VPC binding gives a private origin with no public hostname. Workers VPC is beta.
- (agent) **Cloud code lives in the website for now** (`website/src/cloud/`), one deploy with auth, billing and hub. Moving it to a private submodule later is a folder move.
- (agent) **Cloud phones are one more Mac, slug `cloud`,** leases `cloud:<n>`. The daemon already lists `/macs` and forwards leases, so the CLI needs almost no change.
- (agent) **Machine side is VPhone commands:** the host agent is a `vphone-cli fleet` subcommand in the fork.
- (agent) **Settle is captured on the host** (`vphone-vm`, `VPhoneGraphicsDisplayCapture`, exposed as vphone.sock `settle`), not in vphoned: the guest does no work for it.
- (agent) **Fleet talks only to vphone.sock** and relays raw lines, so new vphone.sock commands need no fleet change. The website never exposes a raw RPC to tenants.
- (agent) **Hosts hold an R2 token for the phones bucket** and sync chunks themselves; the Worker only presigns catalog IPAs. Worker subrequest limits rule out presigning thousands of chunks.
- (agent) **One Stripe subscription per phone**, `subscription.kind` separates it from Pro. Cancel stops access, never deletes storage.
- (agent) **Two stores, split by owner:** Postgres holds what was bought (phone, org, subscription); the CloudFleet DO holds where it runs (placement, versions, leases, queue).
- Lost: running the ghosthand daemon on rental Macs (`plans/archive/cloud-phones-daemon-on-mac.md`), per-minute billing, a WebSocket DO link to the Macs, a separate private Worker (for now).
- Open: availability promise per phone (oversell ratio), phone tasks quota, legal risk.
- Lives in: `docs/cloud-phones.md` (design), `plans/cloud-phones.md` until built.
