---
title: Implicit state machines in ghosthand
description: Every place where ghosthand keeps a lifecycle in flags, optional fields, rows, timers or process lifetimes instead of one explicit state, ranked by bug risk, with the unsafe states and races each one allows.
---

# Implicit state machines in ghosthand

An **implicit state machine** is a lifecycle whose state is spread over several flags, optional
fields, DB rows, timers, Tasks or process lifetimes, instead of one state value with named
transitions. Each one below lists where it lives, its real states, and the combinations or races
the current representation allows.

Audit of 2026-11-06, read only. Daemon parts describe behavior and name files and functions; no
daemon code is copied here. Findings marked **(verified)** were checked line by line a second
time; the rest come from one careful read of the code and can contain mistakes. Risk is
likelihood times damage.

## Ranking

| # | Machine | Where | Risk | Worst outcome |
|---|---|---|---|---|
| 1 | Task turn and the meaning of its alarm | `website/src/task.ts` | high | Stop near a deploy deletes the whole task history after 30 s **(verified)** |
| 2 | Source access to the daemon repo | `website/src/lib/github.ts` | high | A failed revoke leaves permanent read access to the private repo **(verified)** |
| 3 | Control plane chat turn and lease | `chat-panel.swift` | high | Lease orphaned for 120 s; Stop does nothing during a slow acquire |
| 4 | XCTest runner lifecycle | `xctest-driver.swift`, `controller.swift` | high | Setup stuck on "Starting" forever; healthy runner restarted (passcode prompt) |
| 5 | Bluetooth link, split over Swift and ObjC | `bluetooth-hid.swift`, `ClassicBluetooth.m` | high | Mac never reconnects after a bluetoothd restart |
| 6 | Capture ID to UDID match | `capture.swift` `DeviceJoin` | medium-high | Two new iPhones swapped for good: input goes to the wrong phone **(verified)** |
| 7 | Stripe subscription mirror | `website/src/lib/stripe.ts`, `billing.ts` | medium-high | Out-of-order webhooks leave Pro forever **(verified: no ordering guard)** |
| 8 | Task recovery without try/finally | `website/src/task.ts` | medium-high | Every later `send` hangs until eviction **(verified)** |
| 9 | App relaunch after bundle replace | `setup-app.swift` | medium | Turn killed by `exit(0)` without release; failed relaunch never retried |
| 10 | Lease idle clock and "daemon is idle" | `controller.swift`, `state-db.swift` | medium | A long command expires its own lease; restart cuts running input **(verified)** |
| 11 | Hub Mac slug and zombie sockets | `website/src/tunnel.ts` | medium | Old leases route to another Mac that reused the slug |
| 12 | Daemon task stream reconnect | `task.swift` | medium | A finished turn is reported as "no running turn" after a deploy |
| 13 | Tunnel connection lifecycle | `tunnel.swift` | medium | Signed-out Mac connects and shows online; 4409 park is invisible |
| 14 | Lease routing by in-memory slug | `api.swift` `LeaseTarget`, `tunnel.swift` | medium | After a restart while offline, the Mac's own leases cannot be used or released |
| 15 | Hub pending requests | `website/src/tunnel.ts` | medium | A stuck daemon makes a task turn that never ends and is billed forever |
| 16 | Task chunk indices after a crash | `website/src/task.ts` | medium | Reconnecting client and server history disagree |
| 17 | Capture slot, stream and recorder | `capture.swift`, `recording.swift` | medium | Recorder finish blocks the upkeep queue for up to 30 s |
| 18 | Take Control session | `control-plane.swift`, `controller.swift` | medium | Keys go to an unplugged phone |
| 19 | Three "ready" rules | `controller.swift`, `setup-app.swift` | medium | Window says Ready while `setup-status` says "replug" |
| 20 | `/subscribe` Checkout idempotency | `website/src/lib/stripe.ts` | medium | A user who canceled cannot subscribe again until the next UTC day |
| 21 | MCP OAuth grants and session delete | `website/src/db.ts`, better-auth | medium | One stale refresh replay kills all of a user's grants for that client |
| 22 | Pointer, turn and link generation caches | `bluetooth-driver.swift` | medium | Finger lifts mid-hold after a reconnect; Take Control taps rotated |
| 23 | Startup screen capture restart timer | `daemon.swift` | medium-low | Drops in-use capture in the first minute; loops forever with no iPhone |
| 24 | AssistiveTouch ownership | `controller.swift`, `state-db.swift` | medium-low | AssistiveTouch left on with no owner |
| 25 | Daemon stop and start | `daemon-client.swift`, `daemon.swift` | medium-low | `stop && start` ends with no daemon running |
| 26 | Shutdown flags and install-to-restart gap | `daemon.swift`, `updater.swift` | medium-low | Daemon runs a replaced bundle for a whole lease |
| | Lower risk | see [Lower risk](#lower-risk) | low | |

## Fixed so far

| # | Fix |
|---|---|
| 1, 8 | Stop on an orphaned task rebuilds the turn first, so it ends through `endTurn()`: stopped answer saved, alarm becomes the expiry. Every step of a turn, the heartbeat too, runs inside one try, and a failed rebuild ends the turn. |
| 2 | Remove and account change revoke the old GitHub account before the row goes, so a failed revoke keeps the row and the cron retries. The cron skips past one failing account. |
| 4 | Setup's background XCTest start is one explicit value per iPhone; `starting` is derived from it and ends with it. It no longer restarts a runner that already answers. |
| 5 | On end of file, the ObjC host forgets the channel too, so a reconnect opens it again. |
| 7 | A daily cron mirrors every live Stripe subscription again. A GitHub failure no longer fails the webhook. |
| 10 | A lease's idle time starts when its command ends. |
| 11 | A hub connect closes sockets of deleted sessions, not only their slug. |
| 12 | `seen` counts like the server, reconnect delays restart after progress, a 204 after `finish` is success. |
| 20 | Checkout idempotency key per minute, not per day. |
| 25 | A new daemon waits for the old one's forced stop before it gives up on the lock. |

Left on purpose (rare, or the fix costs more than the bug): #3 chat lease, #6 two new iPhones at once
(capture names can differ from lockdown names, so names cannot decide), #9 relaunch, #13 to #19,
#21 to #24, #26 and the lower-risk list.

## Patterns behind most of them

```
1. desired state written before the external call      #2 #7 #21 (row gone, call fails, nobody retries)
2. state that lives only in memory                      #5 unplugged, #14 slug, #24 personInputAt, #9 chats
3. one value with two meanings                          #1 alarm (heartbeat or expiry), #10 device lock
4. fire-and-forget Tasks without timeout or identity    #3 acquire, #15 pending, #13 forward
5. the same derived state computed in several places    #19 ready, #3 running (UI vs busy)
```

Fixing the pattern fixes several findings at once. For example, an explicit `phase` field in the
task DO (idle, running, orphaned, expired) removes #1, #8 and part of #16.

---

## 1. Task turn and the meaning of its alarm (high)

**Where:** `website/src/task.ts`, `GhosthandTask`: `send`, `abort`, `alarm`, `run`, `endTurn`,
`recover`.

**State:** `meta.running`, `meta.turn`, `meta.recoveries`, `meta.prompt` in storage; `this.turn`
in memory; one alarm whose meaning (heartbeat at +30 s, expiry at +24 h) is not stored. `alarm()`
guesses it from `meta.running` and `this.turn`.

```
          send                         runTurn ends (endTurn)
 Idle ───────────> Running ──────────────────────────────────> Idle (alarm = expiry, +24 h)
  ▲                  │ deploy or crash                           │ alarm, !running
  │                  ▼                                           ▼
  │              Orphaned ── send / resume / alarm ──> Recovering ──> Running      Deleted
  │                  │
  └── abort() ───────┘  writes running=false, alarm still = heartbeat (+30 s) ──> deleteAll()
```

**Race (verified):**
1. A deploy kills a running turn. The heartbeat alarm is pending, at most 30 s ahead.
2. The user presses Stop or Ctrl-C in `ghosthand task` (`POST /tasks/:id/abort`).
3. `abort()` does not call `recover()`. With no turn in memory it only writes
   `running: false` and leaves the alarm alone.
4. The heartbeat fires, sees `!running`, and calls `deleteAll()`. The whole task history is gone
   about 30 s after Stop, not 24 h later.

That `abort()` path also saves no stopped answer and sends no `trackTurn`.

**Evidence:** no test covers abort while orphaned. The crash test only resumes through `/stream`.

## 2. Source access to the daemon repo (high)

**Where:** `website/src/lib/github.ts`: `requestedAccounts`, `syncGithubAccount`,
`syncSourceAccess`, `reconcileSourceAccess`, `requestSourceAccess`, `removeSourceAccess`. Callers:
`stripe-webhook.ts`, `actions.tsx`, the daily cron in `server.tsx`.

**State:** `source_access` rows (desired), every requesting org's `subscription.status`, GitHub
collaborators and pending invitations (actual). "Managed" means some row names the GitHub id;
"wanted" means managed and a requesting org is Pro.

**States per GitHub account:** unrequested, requested and not Pro, invited, collaborator, and
**orphan** (access on GitHub, no row).

**Unsafe states and races (verified):**
- **Orphans are permanent.** `removeSourceAccess` deletes the row before the revoke, and
  `requestSourceAccess` overwrites `github_user_id` before revoking the old account. If the
  revoke fails (GitHub 5xx, timeout, aborted `request.signal`), the account is no longer
  managed, and `reconcileSourceAccess` skips accounts that are not managed. It keeps read access
  forever.
- **Webhook grant vs dashboard Remove:** the webhook reads A as wanted, the dashboard deletes the
  row and revokes A, then the webhook invites A. A is now an orphan with an invite.
- **One bad account stops the loop.** `grant` throws when the GitHub account no longer exists.
  The cron's grant loop has no per-item catch, so every later grant is skipped every day, and
  every Stripe webhook for that org answers 500 (see #7).
- Invitations are counted as present without checking expiry. If GitHub lists expired invites,
  the cron never invites that person again (not checked).

**Evidence:** no tests for `github.ts`. "Every sync is safe to repeat" holds only for managed
accounts.

## 3. Control plane chat turn and lease (high)

**Where:** `chat-panel.swift` `PhoneChats` (`send`, `acquire`, `endTurns`, `stop`, `busy`,
`stopAll`), `ChatTurn`, `DaemonSource.acquireChatLease` / `releaseChatLease` and
`applicationShouldTerminate` in `setup-app.swift`.

**State:** six dictionaries keyed by phone (turn Tasks, newest id, a gate per turn, the acquire
Task, releases, the chat model) plus per-turn `ended`, `stopped`, `problem`, `aborted`, `error`.
"Running" is derived twice: the UI uses the last turn's `ended`, quit and relaunch use `busy`.

**States per phone:** idle, acquiring, waiting for the previous turn, streaming, releasing,
releasing then acquiring again.

**Races:**
- **Stop or quit during a slow acquire.** The acquire is an unstructured Task with no timeout, so
  cancelling the turn does not cancel it. Stop does nothing visible until the daemon answers. On
  quit, the 25 s cap exits; an acquire that commits later is orphaned until the 120 s idle
  timeout.
- **Acquire commits on the daemon, fails on the client** (connection drop, decode error): no
  lease id, so no release. The next prompt fails as busy for 120 s.
- **The lease label is used as ownership.** Any lease labeled "Control plane chat" counts as
  ours, including one left by a crashed app or another Mac's control plane. Send is enabled and
  the acquire then fails.
- A replacing turn reuses the first turn's lease, so `list` keeps showing the old prompt as the
  reason.
- The gate wait ignores cancellation.

**Evidence:** comments say the acquire has no timeout. Turn replacement was rewritten twice
recently. No tests.

## 4. XCTest runner lifecycle (high)

**Where:** `xctest-driver.swift` `WDARunner` (`state`, `adopt`, `start`, `markStarting`,
`markFailed`, `stop`, `launch`), `RunnerJob`, `XCTestDriver` (`runners`, `sessions`, autostart in
`call`); `controller.swift` `setPhoneControl`, `setControl`, `developerModeWaits`, `step`.

**State:** the runner's own enum (only part of the truth), the in-flight operation, the launchd
job and its plist, the build stamp, whether WebDriverAgent answers HTTP, the `xctest_phone` row,
the Developer Mode wait token, the background thread, the lifecycle lock and the device lock.

**Real states:** no runner object, stopped, waiting for Developer Mode (shown as starting),
building, launching, running, running but WDA dead, job died (shown as stopped), failed, orphan
job (alive, no plist), adopted.

**Races:**
- **"Starting" forever.** Setup calls `markStarting`, then its background thread exits without
  touching the state in two cases: a lease's `control xctest` cleared the token and then failed
  before `start`, or a lease was active when the thread was ready ("the lease starts it"). If the
  lease never sends a WDA command, `step()` returns starting and `setup-status.next` tells agents
  to wait, forever.
- **Setup restarts a healthy runner.** Developer Mode off, setup waits; the user turns it on; an
  agent's tap autostarts WDA; the agent releases; the thread sees no lease and calls `start`,
  which stops the running job first. Each new start can show the passcode prompt. Only the
  autostart path checks "already ready?".
- **A short USB failure kills the runner.** Any usbmux connect error counts as unreachable; if
  the 3 s re-check also fails, `start` stops the job without checking that it is alive.
- `control bluetooth` cannot cancel a build; it waits for the lifecycle and device locks, for
  minutes.
- `RunnerJob.stop` deletes the plist even when launchd did not drop the job, which leaves an
  orphan that `adoptRunners` cannot see.
- `adoptRunners` reads a DB error as "Bluetooth mode" and stops a healthy runner.
- Reading `state` of a running runner spawns `launchctl print` inside the driver lock, which
  blocks every phone's session access during the 6 s phone poll.

**Evidence:** `docs/xctest-mode.md` documents the passcode prompt on each start. No tests for
runner state or `setPhoneControl`.

## 5. Bluetooth link, split over Swift and ObjC (high)

**Where:** `bluetooth-hid.swift` `HIDDevice` (`tick`, `opened`, `closed`, `receive`, `unpair`,
`keepOnly`, `keepLink`); `ClassicBluetooth.m` `ICBClassicHost` (`channels`, `linking`,
`connectPeer`, `openWhenLinked`, `openMissing`); callers `BluetoothDriver.followUSB`,
`Controller.devices` and `phones`.

**State:** Swift `channels`, `wanted`, `unplugged`, `connecting` (a retry timer and a first-try
flag at once), `connectedAt`; ObjC its own `channels` and `linking`; the macOS bond outside the
daemon.

**States per iPhone:** not paired, paired and idle, wanted and disconnected (retry every 5 s),
linking, half open (1 channel), connected (2 channels), unplugged (the iPhone forgot this Mac).

**Unsafe states and races:**
- **The two channel tables disagree.** On end of file, Swift drops its channel but never tells
  ObjC. After a bluetoothd restart Swift has 0 channels, ObjC still has 2; `tick` connects, the
  link comes up, `openMissing` sees both PSMs "open" and opens nothing. The Mac never reconnects
  until the iPhone opens the channels itself or the daemon restarts. A comment says bluetoothd
  "may never report this close".
- **A peer can stay in `linking` forever** if an open after link-up never answers; then
  `connectPeer` returns success and does nothing (depends on bluetoothd behavior, not checked).
- **`unplugged` is lost on restart.** The bond is still there, so `waitForLink` waits 60 s for a
  reconnect, fails with a pairing timeout, and never opens discovery. This is the "pairing trap"
  in `docs/relative-pointer.md`.
- `forget` races `followUSB` and the 1 s `phones()` poll, which call `keepLink` again.
- `keepOnly` does not stop a Mac connect that is in progress.
- Permission loss clears channels but not `wanted`, `unplugged` or LEDs. Power off keeps old
  channels.
- `dropLink` is dead code.

**Evidence:** reconnect fix commits, the pairing trap notes. No tests for `HIDDevice` or the ObjC
host.

## 6. Capture ID to UDID match (medium-high)

**Where:** `capture.swift` `DeviceJoin.join`; `controller.swift` `joins`, `udid(_:)`.

**State:** `phone` rows (saved forever), the live capture list, the live lockdown list, names.
States: unmatched, matched (saved, only-new-phone, same-name). No path un-matches or corrects a
match; the only fix is a manual `sqlite3` delete.

**Race (verified):** rule "only new phone" matches when one capture device and one USB iPhone are
free and both lists have the same length. Equal length does not prove it is the same phone, and
the code itself says capture and lockdown update at different times during a plug-in.
1. Plug in new iPhones A and B together (a hub).
2. Capture lists A first, lockdown lists B first.
3. A's capture ID is saved as B's UDID. Later B's capture ID gets A's UDID.
4. The pair is swapped for good. Screenshots come from one phone, Bluetooth input (UDID to
   address) goes to the other.

Same with a known third phone present in both lists.

**Evidence:** `deviceJoin()` tests cover the rules, not opposite lag on each side.

## 7. Stripe subscription mirror (medium-high)

**Where:** `website/src/lib/stripe.ts` `syncSubscription`, `stripe-webhook.ts`,
`website/src/lib/billing.ts` `entitlementFor`, `PRO_STATUSES`, `EXISTING_STATUSES`.

**State:** per org N `subscription` rows with free-text `status`, `cancel_at_period_end`,
nullable `current_period_end`, `paid_macs`. Stripe holds the truth. Pro is any row with `active`
or `past_due`; `paidMacs` is summed over Pro rows; the notice comes from the newest one.

**Races and gaps:**
- **No ordering guard (verified).** Each event re-fetches the subscription and upserts it, last
  writer wins. An `updated` handler that fetched `active` before the cancel and writes after the
  `deleted` handler leaves the row `active` forever. No Stripe timestamp is compared.
- **Pro ignores time.** `entitlementFor` never compares `currentPeriodEnd` to now.
- **No subscription reconcile.** The daily cron is for GitHub only and reads the same rows. A
  missed webhook is never repaired.
- **The webhook answer depends on GitHub.** A GitHub failure returns 500 after the row was
  written. With an expired PAT or one deleted GitHub account (see #2), every event for those orgs
  fails; Stripe can disable the endpoint and syncing stops for all orgs.
- `trialing` is "existing" but not Pro: latent if trials are added.

**Evidence:** `billing.test.ts` tests the pure function only.

## 8. Task recovery without try/finally (medium-high)

**Where:** `website/src/task.ts` `recover`, `run`, `send`.

**State (verified):** `recover` sets `this.turn` before its awaits (`readUIMessageStream`, then
`run`, which awaits `setAlarm`). Only `endTurn` resolves `turn.ended`, and nothing wraps these
awaits. If one throws:
- every later `send` aborts the turn and waits on `ended` forever, so the request hangs;
- `resume()` follows a stream that never ends;
- `alarm` sees a turn in memory and re-arms the heartbeat every 30 s (one billed row per tick)
  until eviction;
- `meta.recoveries` was already raised, so each eviction spends the recovery budget.

The same happens when `run()`'s `setAlarm` throws inside `send`.

## 9. App relaunch after bundle replace (medium)

**Where:** `setup-app.swift` `AppController.relaunchIfReplaced`, `relaunching`, `launchedBuild`,
`takeAppLock` / `releaseAppLock`, `handOff`.

**States:** running, relaunching (lock released, new process launching), exited or running again.

**Races:**
- **Check, then act.** `!busy` and "no Take Control" are checked once, then an async launch, then
  `exit(0)`. The window still works in between. A Send started there is killed by `exit(0)`,
  which skips `applicationShouldTerminate`, so its lease is orphaned. A Take Control started
  there leaves AssistiveTouch on until the 60 s sweep.
- **`relaunching` is never reset on failure.** The old process takes the lock back and never
  tries again, running a removed bundle that Accessibility refuses.
- No lock during the launch, so `ghosthand setup` can open a third process.
- Chat history and task ids are lost on every relaunch.

## 10. Lease idle clock and "daemon is idle" (medium)

**Where:** `controller.swift` `withLease`, `endStaleRecordings`; `state-db.swift` `useLease`,
`lease`, `activeLeases`, `prepareRestart`, `whileNoActiveLease`; `Updater.run`;
`DaemonConnection.ensureReady`.

**State:** `lease.last_used_at`, `lease.idle_timeout_s`, the wall clock, the device lock. A
lease can be **expired while its command still runs**; nothing names that state.

**Races:**
- **A long command expires its own lease (verified).** `withLease` refreshes `last_used_at`
  before the body and never after. With a 60 s timeout and a 90 s `app install`, the upkeep ends
  the lease's recording at 60 s and the agent's next command gets `lease-invalid`.
- **Idle means "no lease rows", not "no work".** `prepareRestart(ifIdle:)` and the updater check
  only unexpired rows. They miss: commands under an expired lease, Take Control input, the setup
  XCTest start thread, a force acquire waiting on the device lock. A newer CLI build can restart
  the daemon over a person's input; the forced finish can `execv` in the middle of a HID
  sequence.
- All expiry uses the wall clock: a clock jump or lid close expires every lease together.

**Related, same lock:** the device lock means "lease change", "input running", "AssistiveTouch
sweep", "person input" and "control mode change" at once. A plain acquire right after a release
can fail with `device-leased` while the release thread turns AssistiveTouch off and no lease
exists. Release also stops the capture session outside the lock, so it can stop the next lease's
session.

## 11. Hub Mac slug and zombie sockets (medium)

**Where:** `website/src/tunnel.ts` `openUpstream` (registry prune), `revoke`, `onlineMacs`,
`relayPhones`; `website/src/lib/mcp-routing.ts` `macSlug`; `db.ts` `session.delete.after`.

**State:** session row, socket attachment `expiresAt` (cached at connect), registry entry
sessionId to slug, socket state. The slug belongs to the session, not to a stable Mac id.

**Unsafe states:**
- **Zombie Mac:** no session row, socket open, attachment not expired. Reached when the
  `delete.after` RPC fails; only the dashboard sign-out retries. The Mac stays routable until
  the old `expiresAt`, possibly days.
- **Slug reuse:** from a zombie, any other Mac's connect prunes the zombie's registry entry
  (freeing its slug) but does not close its socket. A new Mac named Studio gets `studio`; the
  zombie still prints `studio:N` leases, which now reach the new Mac.
- Re-sign-in while the old session is live gives `studio-2`, breaking `/macs/studio/...` scripts
  and held leases. Sign-out of A then B with the same name gives B the old slug; a stale
  `studio:42` can hit B's lease 42.

**Evidence:** `tunnel-auth.test.ts` names the zombie state ("no row, but an open socket").

## 12. Daemon task stream reconnect (medium)

**Where:** `task.swift` `Account.streamTask`, `runTask`, `TaskStreamState`, `TaskTurn`.

**State:** turn, `seen`, `done`; flags `finished`, `aborted`, `error`; position in the reconnect
delays; the request (POST first, then GET with `from`).

**Gaps:**
- **A drop near the end reports success as an error.** If the turn ended while the client
  reconnected, the GET answers 204 and the client throws "task has no running turn". The
  `finish` it already saw is not checked. Likely on every deploy that lands at a turn's end.
- The 5 retries are for the whole turn, not per drop. The sixth drop fails the task while the
  server turn keeps running; the chat then releases the lease under it.
- A chunk that fails to decode is not counted in `seen`, so `from` replays chunks.
- A follower's disconnect (`--resume`) aborts a turn another client started.
- `finished`, `aborted` and `error` can all be set; MCP `task` checks only `error`, so an aborted
  turn returns as success.

## 13. Tunnel connection lifecycle (medium)

**Where:** `tunnel.swift` `Tunnel`: `run`, `connectOnce` and its `defer`, `accountChanged`,
`pathChanged`, `backoff`, `waitConnected`.

**State:** `_connected`, `_connecting`, `socket`, `_mac`, `connectWaiters`, `backoffWaiter`,
`pathRevision`, loop locals (`delay`, close code), and which inner loop is running (4409 park).

**States:** signed out, connecting, connected, backoff, parked on 4409, shutting down.

**Races:**
- **Sign-out during connect.** The loop reads token A; `logout()` deletes the row and wakes the
  tunnel, but `socket` is nil so nothing is cancelled; `connectOnce(A)` connects. The server
  revoke runs after, best effort. The signed-out Mac shows online and publishes phones until the
  server closes the socket (server side not checked).
- **4409 park looks like backoff.** Status says "signed out, or connecting". The Mac stays offline
  until a new sign-in or restart.
- A buffered `accepted` frame handled after `accountChanged` sets `_mac` again after sign-out.
- Any path change (VPN on, Wi-Fi switch) cancels in-flight forwards; a 70-minute `wait` dies, and
  the caller cannot tell if the action happened.

## 14. Lease routing by in-memory slug (medium)

**Where:** `api.swift` `LeaseTarget`, `LeaseRoutingMiddleware`, `acquireLease`; `tunnel.swift`
`_mac`.

**State:** the prefix in the client's lease id (fixed at acquire), `Tunnel._mac` (nil at start,
set on accept, cleared on account change), the lease row (local, survives restarts).

**Unsafe state:** a lease row valid on this Mac whose id routes to "another Mac". After a daemon
restart while ghosthand.dev is unreachable, every `studio:42` command waits 8 s, is forwarded to
the hub and fails; `release` fails too, so the iPhone stays held until the idle timeout. This
contradicts the offline lease design (`lease_check.valid_until`). Same after sign-out and
sign-in. During backoff right after boot, `acquire` also returns a bare `42` on a signed-in Mac.

## 15. Hub pending requests (medium)

**Where:** `website/src/tunnel.ts` `Pending`, `pending` map, `dispatch`, `handleMessage`,
`cancel`, `failSession`; `task.ts` `untilAborted` around `hub.daemonFetch`.

**States:** sent, streaming (`body` set), done (removed).

**Gaps:**
- **No deadline.** A Mac that keeps its socket but never answers keeps the entry forever; the task
  turn waits forever and its heartbeat re-arms forever. Turns have no time limit.
- The task's abort signal does not cross DO RPC, so an aborted turn leaves the entry and the
  daemon command running.
- A second `response` for the same id replaces the body with an orphan controller; the first
  stream never closes (needs a daemon bug).

## 16. Task chunk indices after a crash (medium)

**Where:** `website/src/task.ts` `push`, `saveChunks`, `recover`, `resume({ from })`.

Chunks are stored only before a tool call and at turn end. After a crash the recovered turn
continues from the stored count S, but a client may have seen N > S chunks. It reconnects with
`from=N`; the `start` chunk's message id still matches, so it skips the first N−S new chunks,
including the INTERRUPTED error, and keeps text from the dead stream that the server no longer
has.

## 17. Capture slot, stream and recorder (medium)

**Where:** `capture.swift` `FrameStream`, `CaptureSlot`, `CaptureSessions` (`close`, `frame`,
`stopNow`, `runningStream`, `scheduleIdleStop`, `endRecordingLocked`); `recording.swift`
`Recorder`; `controller.swift` `startRecording`, `consumeRecording`, `endStaleRecordings`,
`takeRecordings`.

**State:** `slot.stream`, `stream.isRunning` (changes on its own), `frameWaits`, `lastUse`,
`finished`, `recorder`, idle-stop timers, one max-duration timer per recording, and the
recorder's `first`, `failure`, writer status. Finishing exactly once is safe (identity check).

**Gaps:**
- **`Recorder.finish` blocks up to 30 s while holding the slot lock.** From `endStaleRecordings`
  it blocks the single upkeep queue: Bluetooth follow, keep-awake, AssistiveTouch sweep, phone
  publish, plus that phone's screenshots.
- A session that stops by itself (AVCapture runtime error) keeps its recorder; nothing detects
  it, and the file has a frozen gap.
- A lease that expires during the 8 s first-frame wait still returns success to the start.
- One `finished` slot: a new recording drops an unread auto-stopped result.
- Each frame schedules a new idle-stop block: about 1,800 per minute per phone during preview.
- Lease expiry: `release` returns "already ended" without the recording, which stays in the slot.

## 18. Take Control session (medium)

**Where:** `control-plane.swift` `PhoneControl` (`start`, `stop`, `handle`, `drain`),
`model.control`, the `didResignKey` observer; `controller.swift` `personInput`,
`endPersonInput`.

**States:** off, on and idle, on and sending, stopping.

**Races:**
- **Unplugged controlled phone.** The selection falls back to the first phone, but
  `model.control` keeps the old id and the key monitor keeps swallowing keys and sending them to
  the missing phone, until a send fails with a fatal error. The fallback never calls `stop`.
- `endPersonInput` does not take the device lock; release can turn AssistiveTouch off during a
  tap, which is then lost.

## 19. Three "ready" rules (medium)

**Where:** `Controller.step`, `SetupScreen.init`, `Controller.setupStatus` (adds capture match
and a live link), `showFirstWindow`, `copyPrompt`, `ChatPanel.blocked`, `ScreenPreview.blocked`.

**Disagreement:** trusted, unlocked, paired, capture not matched yet (normal for a few seconds
after Trust). The window shows Ready with "Copy prompt"; `setup-status` says not ready and
`nextStep` tells the user to replug the cable at once. Agents polling every 2 s pass that advice
on during a normal transition. Inside `phones()`, `on` and `bluetooth.state` are read at
different moments, so they can disagree for one poll.

Related: `--permissions` while the phone is on the pair step skips `startPairing`, so the Mac is
not discoverable, while `next` tells a remote agent to pair now. A `startPairing` error is shown
as "Setup failed" for a tick. `firstWindowActivates` (an optional Bool used as three states)
never shows a window if the overview keeps failing while `recover()` succeeds.

## 20. `/subscribe` Checkout idempotency (medium)

**Where:** `website/src/lib/stripe.ts` `subscribeRedirectUrl`, `getOrCreateStripeCustomer`.

The Checkout idempotency key is `customer:price:UTC day`. Subscribe at 10:00, cancel at 10:05,
subscribe at 10:10: Stripe returns the saved response, the URL of the completed session, so the
user cannot subscribe again until the next UTC day. `incomplete` counts as existing, so a failed
3DS sends the user to the portal instead of a new Checkout. A customer deleted in the Stripe
dashboard makes `/subscribe` fail with 500 permanently.

## 21. MCP OAuth grants and session delete (medium)

**Where:** `website/src/db.ts` `session.delete.before/after`, `validateMcpAccess`; tables
`oauth_refresh_token`, `oauth_access_token`; better-auth oauth-provider
(`invalidateRefreshFamily`, 30 s reuse interval from `@better-auth/mcp`).

**States per grant:** active, rotated (30 s replay window), replay expired, revoked, session
ended, deleted.

**Gaps:**
- **The refresh family is user plus client, not session.** A CIMD client is one shared row. One
  Mac or browser replaying a rotated token after 30 s (crash between rotation and save) deletes
  every grant that user has for that client, on all sessions.
- `delete.after` runs after commit; if the hub revoke fails, only `signOutMac` retries.
  `/api/cli/logout`, `/api/auth/sign-out` and `revoke-sessions` do not. This feeds #11.
- Refresh rows whose session was deleted without hooks keep minting tokens without `sid` until
  they expire; `validateMcpAccess` rejects them, so this is safe but messy.

## 22. Pointer, turn and link generation caches (medium)

**Where:** `bluetooth-driver.swift` `relativeAt` / `absoluteAt`, `forgetPosition`, `turns`,
`pointerTurn`, `forgetTurn`, `findTurn`, `wake`, `withPointer`, `goAbsolute`; `bluetooth-hid.swift`
`opened` (baseline zero reports), `send`.

**Gaps:**
- **No link generation.** `connectedAt` is read once per input. A long hold (up to 10 s) can lose
  and regain the link between two sends; `opened` sends zero reports on the new channel, which
  lifts the finger and moves the absolute pointer to (0,0) mid-hold. The input continues with no
  error.
- **The turn cache is cleared only by `acquire`.** Take Control reuses the last lease's turn for
  the daemon's lifetime, even after the iPhone is physically turned. `wake` uses no turn before
  measurement, so under a 90° turn its status bar click lands at the right edge.
- Manual AssistiveTouch toggles or pointer moves are not seen; the position stays "valid" up to
  60 s. iOS ignores an absolute report equal to the last one, which the daemon does not track.

## 23. Startup screen capture restart timer (medium-low)

**Where:** `daemon.swift` `runDaemon`, with `missingFromCaptureNow`.

**State:** closure variables `off`, `lastUSB`, `partialTicks`, `partialRestarts`, whether the timer
is valid, the CMIO flag, the helper process and its launchd throttle.

**Gaps:**
- A partial restart in the first minute stops capture that a surviving lease is using; its
  recording ends as disconnected.
- With no iPhone listed, the flag toggles every 11 s for the daemon's whole life. One local
  `daemon.log` has 30,133 "no iPhone visible yet" lines.
- After a toggle, the helper gets only 5.5 s to list devices before the next tick; enumeration
  can take ~20 s. Possible livelock (timing risk, not seen).
- Done is final: a later replug is never retried here.
- `partialTicks` is not reset by the empty-list branch.

## 24. AssistiveTouch ownership (medium-low)

**Where:** `bluetooth-driver.swift` `ensureAssistiveTouch`, `turnOnAssistiveTouch`;
`controller.swift` `turnOffUnleasedAssistiveTouch`, the upkeep sweep, `personInputAt`,
`personControls`, `setAssistiveTouch`; `state-db.swift` `assistive_touch_off_after_lease`.

**States:** off (person's choice), on without mark (person's own), on with mark (ghosthand owns
it), off with mark (failed write or manual change).

The main check-then-act is covered: the mark is written before the write and re-checked under
the device lock. Holes:
- The mark is an `UPDATE phone`; with no `phone` row it changes nothing and AssistiveTouch stays
  on with no owner.
- `personInputAt` is in memory; after a restart during Take Control the sweep turns it off
  between clicks.
- The mark is keyed by UDID, leases by capture ID: a re-match during a lease makes the sweep turn
  it off mid-lease (heals on the next input).
- A person who turns it on by hand during a lease loses that setting at release.

## 25. Daemon stop and start (medium-low)

**Where:** `daemon-client.swift` `DaemonConnection.stop` / `start`, `ensureReady`; `daemon.swift`
`runDaemon` lock loop, `DaemonLifecycle.finish`.

**State:** whether the listener accepts, the socket file, who holds `daemon.lock`,
`DaemonLifecycle` flags, launchd KeepAlive.

**Race:** `stop()` returns when `connect()` fails, but the old process can hold the lock for up
to 2 s graceful plus 5 + 1 s forced. The new daemon waits 3 s for the lock, then exits 0 ("another
daemon is running"); exit 0 means launchd does not restart it, and `start()` fails after 20 s with
no daemon. Hit by `daemon stop && daemon start` (documented for traces), the old-daemon branch of
`ensureReady`, and `restart()`. The log shows forced shutdowns over 5 s, so the window is real;
no confirmed occurrence yet. Assumes the listener closes at the start of graceful shutdown (not
checked in Hummingbird).

## 26. Shutdown flags and install-to-restart gap (medium-low)

**Where:** `state-db.swift` `restarting`; `daemon.swift` `DaemonLifecycle` (`_requested`,
`finishing`), `replacedTicks`, `appReplaced`; `updater.swift` `Updater` (`busy`, `ready`,
`failed`, `requested`).

**Gaps:**
- A `.stop` never sets `restarting`, so acquires still succeed during the 5 s graceful window.
- `restartDaemon` during a requested `.stop` answers 202 "restarting", but the daemon stops.
- The updater installs under `whileNoActiveLease`, but the restart comes 2 to 4 s later. A lease
  taken in that gap keeps the daemon on the replaced bundle until idle.
- The bundle copy holds the state DB lock, so every DB call waits for it.
- `ready` can point to an older build after a newer one was installed another way; `status()`
  then keeps saying the old one is downloaded.

---

## Lower risk

| Machine | Where | Note |
|---|---|---|
| Session revocation fan-out | `account.swift` `revoked` | A 401 for old token A after sign-in as B still calls `changed()`, which drops B's tunnel and its forwards. An old account's lease-check answer can be saved after B signs in. |
| Browser sign-in | `account.swift` `login`, `poll` | Approval after cancel leaks a server session; logout during the start POST is ignored (no `loginLock`); 4xx polls are retried until expiry. |
| Lease-check offline cache | `account.swift` `authorizeLease` | Only `URLError` and 5xx count as offline; a 429 or captive portal fails even with a valid cache. |
| Phones publish | `tunnel.swift` `publishPhones` | Each send is its own Task; two sends can arrive out of order and the hub keeps the stale list. |
| Telemetry crash marker | `telemetry.swift` | The marker moves before delivery; crash reports are lost if the flush does not finish. |
| Pairing wait and discovery | `bluetooth-driver.swift`, `bluetooth-hid.swift` | `paired` read once per wait; unpaired addresses stay in `wanted` and are retried every 5 s; any short error ends a 300 s pairing wait. |
| HID service | `bluetooth-hid.swift` | `hostError` never clears: one failed host init needs a daemon restart. Zero reports can block the Bluetooth queue for up to 5 s. |
| Photo delete jobs | `device-management.swift` `Library`, `DeleteJob` | A job right after a session close deletes on a closing session; a timeout during delete reports failure though the photo was deleted; unplug is ignored. |
| Native screenshot | `device-management.swift` `nativeScreenshot` | A late first press plus the second press can leave one screenshot in the Camera Roll, or delete a user's PNG saved in the window. |
| AFC upload | `lockdown.swift` | A failed upload leaves a truncated file on the iPhone. |
| Plan device slots | `website/src/lib/billing.ts` `leaseDecision` | Races handled (unique slot, retry). Three lost races give 500. Stale Mac rows keep slot 0 after a re-subscribe. Session and `org_device` are two unlinked Mac identities. |
| Signup to personal org | `website/src/db.ts` `create.after` | Runs after commit; if it fails the user has no org and every route throws, forever. |
| Free task quota | `website/src/cli-api.ts` `takeTaskPrompt` | Count then insert, no lock (commented); a failed DO call still spends a prompt. |
| Device login code | `website/src/cli-api.ts` `/login/token` | Code spent then `getSession` fails: orphan 1-year session. Approve and deny race in the library. |
| R2 uploads | `website/src/uploads.ts` | 30 × 64 MiB > 2 GB limit, so an oversize object exists briefly; parts check auth, not ownership. |
| Hub reconnect wait | `website/src/tunnel.ts` `recentlyOnline` | Not tied to the target Mac; after a deploy `lastSeenAt` is stale, so calls fail instead of waiting (deploy behavior not checked). |
| Hub registry and alarms | `website/src/tunnel.ts` | Expired sessions stay in the registry and hold their slug until another connect. |
| Task history shape | `website/src/task.ts` | MAX_RECOVERIES and orphaned abort save no assistant message, so the next prompt merges with the stopped one. |
| Settle marks | `controller.swift` `recordingInput`, `settledFrame` | A mark is written even when the body threw before input; the next settle waits up to 1 s for nothing. |
| CLI `ensureReady` | `daemon-client.swift` | The pre-0.13 branch stops the daemon without an idle check. |
| Waiters display | `controller.swift` `Waiters` | Two waiters with the same key share one row. |
| Error fields | `setup-app.swift` `AppModel` | `controlError` and `permissionError` are global, shown under the wrong phone. |
| XCTest process supervisor | `xctest-driver.swift` `XCTestProcess` | Sound: idempotent stop, tested. |
| MCP routing | `website/src/lib/mcp-routing.ts` | Pure function; safe while daemons keep no MCP session state. |
