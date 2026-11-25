# Cloud phones: pinned to one host, host backups instead of R2 (human)

- User, 2026-11-25: moving phone disks over the internet through R2 is too complex. Park the R2 work in PRs, remove phone save and load from main.
- User, 2026-11-25: each cloud phone stays on one worker Mac forever. That Mac's disk holds the only copy; the hosts get normal machine backups.
- User, 2026-11-25: if the host is offline, acquire fails with a clear error (the phone's machine is offline, try later). No recovery path: losing a host loses its phones, like a broken iPhone. The user rents a new one and signs in again.
- User, 2026-11-25: later, back up only app data (even encrypted), modeled on upstream's data-preserving iOS OTA workflow (https://github.com/Lakr233/vphone-cli/pull/709). R2 stays for catalog IPAs.

Shape:

```
cloud_host ──< cloud_phone.host_slug   set at the first start, never changed, ON DELETE RESTRICT
                cloud_phone.first_run_at  its host first reported the VM running
acquire ──> its host only: offline ──> 503 tunnel-offline at once
                           full ──> stop an idle phone on the same host after the 10 min grace
                           lost VM (first_run_at set, host does not report it) ──> 404 no-device
start ──> fleet serve {template, create: first_run_at is null}: create clones only a missing phone
```

- (agent) **Why:** a boot alone rewrote 230 to 290 chunks (about 1 GiB) per stop, and saves ran at the host's 2.4 MB/s uplink (265 s per stop). Every stop was a long upload, every move a long download, and the scheduler, hosts and admin page carried versions, cursors, manifests and recovery for it. Pinned phones need none of that.
- (agent) **`first_run_at`, not a flag on the host:** `host_slug` is set before the first start, which may fail before the clone, so it cannot say whether the VM exists. Without the fact, a host that lost a phone would silently clone a fresh template under an existing phone's id. The same column replaces `version = 0` for deleting abandoned unpaid rows.
- (agent) **Draining** now means "no new phones pinned here"; its own phones still start. Phones never move, so draining cannot empty a host.
- (agent) **New phones** go to the online, active host with the most free slots. No per-host cap on pinned phones (disk, oversell) yet: TODO.
- Lost: phone moves between hosts, R2 copies (`version`, `saved_version`, `save_cursor`), `recover`, the host's manifests, chunk and restore routes, `fleet hash`, eviction of stopped phones.
- Parked, not merged: https://github.com/ghosthand-dev/ghosthand/pull/2 and https://github.com/remorses/vphone-cli-private/pull/3 (the R2 storage, with its measurements).
- Supersedes in `cloud-phones-architecture.md`: "store this phone storage in a bucket ... use the local disk as a kind of cache" and the Mac-crash rule.
- Lives in: `website/src/cloud/scheduler.ts`, `fleet.ts`, `db/src/schema.ts`, `vphone/.../Fleet/`, `docs/cloud-phones.md`.
