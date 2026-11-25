# Run original App Store TikTok without a physical iPhone

Build on a pinned vphone baseline if it passes the exact Store gate.
Read `docs/reports/virtual-iphone-feasibility.md` and its three source notes first.
This is a proposed multi-session plan. No runtime experiments are complete.

Check a box only when its evidence exists. Add artifact paths and results beside it.
One coordinator owns this file. Parallel workers use separate worktrees and report evidence.
Do not commit unless the user asks.

## Constraints

- Run setup and VM experiments on `mintmacbook` only, not the everyday Mac.
- Before executing any fork, review its pinned diff, install/build hooks, dependencies, binaries, and credential/network access. Report residual uncertainty; a review cannot guarantee absence of malware.
- Never use the owner's personal Apple Account or existing host Store session. Use a separate test identity from Sigillo only; see `decisions/virtual-iphone-account.md`.
- No physical iPhone at runtime, donor keys, identity relays, or remote signing phones.
- Optional borrowed reference hardware is for owned probes only. Record that dependency separately.
- Install original TikTok through the real App Store. Sideloading is a separate diagnostic, never a substitute.
- No Recovery-mode changes or weaker host SIP without explicit permission. Stop at that prerequisite.
- No broad driver investment before the Store gate. Repair only prerequisites needed for a valid attempt.
- Record pass, fail, or inconclusive per stage. Inconclusive never means impossible.
- Keep firmware, account secrets, and third-party binaries out of published evidence.

## Task 1: Fix the acceptance contract and baseline (sequential, first)

- [ ] Pin vphone revision, host build, guest and cloudOS hashes, patches, and artifact provenance. Pass with a reproducible manifest and dependency inventory.
- [ ] Fix TikTok identity, storefront, account scope, owned clip, and playback target. Pass with explicit workflow criteria and reference-hardware policy.
- [ ] Record host prerequisites and permissions. Pass with a supported ready host or an explicit blocked result awaiting permission.

## Task 2: Establish a minimal valid Store test (sequential, after Task 1)

- [ ] Cold-boot the pinned guest with persistent storage, UI, screenshots, and input. Pass with saved boot logs and a repeatable restart.
- [ ] Verify clock, DNS, HTTPS, and observable Store responses. Pass with redacted results that separate network failures from service rejection.
- [ ] Record the baseline before changes. Pass with patch inventory, restore point, and evidence that no runtime phone or relay is involved.

## Task 3: Run the original App Store gate (sequential, after Task 2)

- [ ] Attempt normal Apple Account login and original TikTok acquisition. Pass with original delivery, package identity/version, installation, launch, and reboot/relaunch evidence.
- [ ] Classify each stage independently. Pass with logs for login, Store request, authorization, installation, and launch, including exact failure boundaries.
- [ ] Decide whether to proceed. Pass with Store success, or a documented stop and bounded follow-up for a failed/inconclusive configuration.

A control app can isolate a failure but cannot satisfy Task 3. A rejected configuration does
not prove every VM impossible. If boot or networking blocked the attempt, return to Task 2.
If authorization failed, resolve that boundary before Task 5 or Ghosthand integration.

## Task 4: Create the comparison corpus (parallel with Task 3, after Task 2)

- [ ] Save owned diagnostic inputs and expected API, rendering, media, and keychain behavior. Pass with provenance-tagged replay cases and uncertainties.
- [ ] If approved, capture matched reference-phone outputs separately. Pass with a dependency record and no extracted secrets or runtime calls to that phone.
- [ ] Separate behavioral specification from independent implementation. Pass with source/license provenance and a reproducible comparison report.

## Task 5: Repair demonstrated compatibility gaps (sequential, after Tasks 3 and 4)

- [ ] Fix only saved guest/device failures in the baseline. Pass when the affected cases replay correctly and the Store gate still passes.
- [ ] Validate GPU features, decode/encode, audio, permissions, and required camera/microphone fixtures. Pass against Task 1 targets with unsupported capabilities listed.
- [ ] Validate local key storage and app data across reboot. Pass with diagnostic results and no claim that synthetic secrets establish external trust.

Independent media and graphics fixes can run in parallel only with separate file ownership.
Keep guest/device fixes separate from the future Ghosthand adapter.

## Task 6: Prove the TikTok workflow (sequential, after Task 5)

- [ ] Verify login, feed scrolling, video/audio playback, and restart persistence. Pass with redacted recordings and logs for the pinned app.
- [ ] Upload the owned clip with permission. Pass when server processing finishes and the intended account can retrieve and play it.
- [ ] Repeat on a fresh instance and after network interruption. Pass with a reproducible matrix and no borrowed identities or hidden phone dependencies.

## Task 7: Integrate Ghosthand (sequential, after Task 6)

- [ ] Add the virtual-device adapter with equivalent CLI and MCP behavior. Pass when both control the same guest and report matching state and errors.
- [ ] Replay the accepted workflow through the adapter. Pass with evidence linking each action to the final guest build and app version.

## Done

- [ ] A fresh virtual instance installs original Store TikTok and completes the agreed workflow without a physical phone at runtime.
- [ ] Publish reproducible setup and failure boundaries. Pass with checked evidence, artifact provenance, and any reference-hardware use disclosed separately.
