---
title: Free plan, paid source access, and the daemon repo split
description: Plan to replace the 7-day trial with a free plan (one iPhone, no time limit), a $99/month Pro plan per Mac (unlimited iPhones on that Mac, plus read access to the closed Swift daemon and private skills), and split the repo into public ghosthand-dev/ghosthand and private ghosthand-dev/ghosthand-daemon with history kept.
---

# Free plan, paid source access, and the daemon repo split

Three changes, one release:

1. **Pricing.** The 7-day trial goes away. **Free**: one iPhone, forever, no time limit.
   **Pro** ($99/month per Mac): unlimited iPhones on that Mac, plus read access to the
   daemon source and the private skills on GitHub. No time-based limits on any plan.
2. **Repo split.** Everything except the Swift daemon and the private skills becomes open
   source in `ghosthand-dev/ghosthand`. The Swift code and skills move, with their history,
   to the private `ghosthand-dev/ghosthand-daemon`, mounted as the submodule `daemon/`.
3. **Source access.** A subscriber clicks **Request access** on the dashboard and types a
   GitHub username; the website adds that account as a read-only collaborator on
   `ghosthand-daemon` with Tommy's token, and removes it when the plan ends.

Done when: a free account cannot lease a second iPhone, a Pro account leases any iPhone on
its paid Mac but not on an unpaid one, a Pro account gets a `pull` invite to the daemon repo
and loses it on cancel, and the public repo builds and deploys the website on a machine
without access to the private repo.

Tasks in order: 1 prototype split, 2 create repos, 3 submodule wiring, 4 device limits on
the website, 5 device check in the daemon, 6 GitHub source access, 7 docs and pricing pages,
8 release, 9 go public.

```
┌──────────────── ghosthand-dev/ghosthand (public, MIT) ────────────────┐
│ website/  db/  npm/  docs/  promo-*/  demo-video/  Assets/  README.md │
│ daemon/ ──submodule──┐                                                │
└──────────────────────┼────────────────────────────────────────────────┘
                       ▼
┌──── ghosthand-dev/ghosthand-daemon (private, source-available) ────┐
│ Package.swift  Sources/  Tests/  skills/  Assets/*.icns|png        │
└─────────────────────────────────────▲──────────────────────────────┘
                                      │ PUT/DELETE collaborators (pull)
Stripe webhook ──> syncSubscription ──> syncSourceAccess(org) ──GITHUB_TOKEN
dashboard "Request access" {GitHub username} ──> source_access row (GitHub user id)
```

## How to read this

**Never run a destructive or outward step without the user's go:** pushes to GitHub,
repo creation or visibility changes, history rewrites outside `tmp/`, migrations, deploys,
Stripe changes, npm publish.

One box is one unit of work. Check a box only when its evidence exists (command output,
commit SHA, screenshot, URL). Write the evidence next to the box. Tests alone are not
verification: each task is checked on the real artifact.

## Facts found while planning

- The org slug is **`ghosthand-dev`** (display name "ghosthand.dev"), on the **GitHub Free**
  plan, with no repos yet. Checked with `gh api user/orgs` and `gh api orgs/ghosthand-dev`.
- The current repo is `remorses/ghosthand`, private, no license, no `.github/` workflows. The
  website deploys from Tommy's Mac (`pnpm run deploy:prod`), not from CI.
- History has old daemon paths too: `Sources/iphonectl/`, `Tests/iphonectlTests/`, and old
  skills (`skills/ghosthand-gmail`, `skills/ghosthand-icloud`,
  `skills/creating-ghosthand-social-account`). Path filters on `Sources/`, `Tests/`,
  `skills/` cover them. `git filter-repo` does not follow renames, so every old path must be
  in the filter: [git-filter-repo manual](https://github.com/newren/git-filter-repo).
- The public side reads daemon files today: `website/src/server.tsx` and
  `website/src/task-agent.ts` import `skills/ghosthand/SKILL.md`; `website/docs.jsonc` and
  `website/scripts/generate-docs.ts` read `Sources/ghosthand/openapi.yaml`;
  `npm/scripts/build.ts` reads `Sources/ghosthand/Info.plist` and runs `swift build` at the
  repo root. `Package.swift` embeds `Assets/settings-icon.png` and `Assets/ghosthand-icon.icns`.
- GitHub: `PUT /repos/{owner}/{repo}/collaborators/{username}` with `permission: pull` sends
  an invite the user must accept (expires after 7 days); `DELETE` removes access and deletes
  their forks of the private repo; at most 50 invitations per repo per 24 h. The caller
  needs repository **Administration: write** for both calls.
  [Collaborators API](https://docs.github.com/en/rest/collaborators/collaborators),
  [App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).
- On **GitHub Team**, every outside collaborator on a private repo is a paid seat. Keep the
  org on **Free**, where outside collaborators on private repos are unlimited.
  [Per-user pricing](https://docs.github.com/en/billing/managing-the-plan-for-your-github-account/about-per-user-pricing),
  [GitHub plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans).
- Plan checks today: `entitlementFor` in `website/src/lib/billing.ts`, served by
  `GET /api/cli/account` (`website/src/cli-api.ts`), read by `Account.authorizeLease()`
  (`Sources/ghosthand/account.swift`) only in `Controller.acquireLease`. Unreachable server:
  the lease is allowed (fail-open). `requirePlan` also guards uploads and tasks.

## Plans and device limits

No plan has a time limit. Plans limit **devices**, checked only when an agent takes a lease
(`acquire`, `wait`), so a running lease is never stopped.

| | Free | Pro, $99/month per Mac |
| --- | --- | --- |
| iPhones | one, on any Mac | unlimited on each paid Mac, plus the free iPhone anywhere |
| Macs signed in | unlimited | unlimited; only paid Macs lease more than the free iPhone |
| CLI, MCP, HTTP API, remote MCP | yes | yes |
| Daemon source and private skills | no | read access on GitHub |

- **Free iPhone.** The first iPhone an org leases is bound to it. A lease on another iPhone
  fails with `subscription-required`, and the detail names the bound iPhone, the subscribe
  link and the dashboard link to switch.
- **Paid Mac.** A Pro subscription has a quantity: the number of paid Macs. The first Macs
  that lease a second iPhone fill the slots. When all slots are taken, the error says to add a
  Mac in the billing portal.
- **Switching.** The dashboard lists the bound iPhone and the paid Macs, each with Remove.
  Removing frees the slot; the next lease binds again. No cooldown until Strada shows people
  rotating phones by hand.
- **People are never limited.** The control plane preview and Take Control need no lease, so
  a person can use every iPhone on every Mac.

### Where it is checked

The website decides, because only it sees every Mac of an org. The daemon asks at acquire,
as today, with two extra fields. The hub is not involved.

```
daemon acquire ──POST /api/cli/lease-check {phone: sha256(udid), mac: sha256(platform UUID)}──>
                                         website: org_device rows, plan, subscription quantity
      <── {allowed, plan, notice, validUntil, allowedPhones, allowedMac} ──
not allowed ── subscription-required (402), detail says which limit and the link
```

- **Stable ids, hashed.** The iPhone is its UDID, the Mac its IOPlatformUUID, both SHA-256
  hashed on the Mac; the server never sees the raw ids. A Mac that signs in again keeps its
  slot, unlike a session id.
- **One table:** `org_device (org_id, kind: phone | mac, device_hash, name, bound_at)`, unique
  on `(org_id, kind, device_hash)`. Binding is one insert that checks the count in the same
  statement, so two Macs cannot both take the last slot.
- **Names** come from the daemon (iPhone and Mac name), only for the dashboard list.
- **Stripe:** the `ghosthand_pro_monthly` price becomes per unit ($99 per Mac). Checkout
  allows choosing the quantity; the portal allows changing it. `syncSubscription` stores the
  quantity. Fewer slots than bound Macs: the newest bound Macs are freed.

### Offline

The daemon caches the last answer in `state.db`: plan, allowed phone hashes, whether this Mac
is paid, and `validUntil` (Pro: current period end + 3 days; Free: 7 days after the check).

| Case | Behavior |
| --- | --- |
| Server unreachable or 5xx, device allowed in the cache, before `validUntil` | Lease allowed. |
| Server unreachable, new iPhone or new Mac | Refused, with a message that ghosthand.dev is unreachable. |
| Never checked | Refused until the first check. |

Today every lease is allowed when the server is down (fail-open). With a free plan that would
put the iPhone limit one firewall rule away. The cache keeps known devices working during our
outages. Perfect DRM is a non-goal: the daemon is closed, which is enough.

### Requests

**No request or time limits.** Phone requests all run on a lease, so the device limit already
bounds them. One follow-up only if Strada shows abuse: an in-memory token bucket per org in
`GhosthandHub` (`/mcp`, `/macs`), with no storage writes. Phone **tasks** spend AI Gateway
tokens, so they are an open question.

## The repo split

### What goes where

| Path | Repo | Note |
| --- | --- | --- |
| `Sources/`, `Tests/`, `Package.swift`, `Package.resolved` | daemon | all history, also `Sources/iphonectl` |
| `skills/` (all skills) | daemon | see open question on the base `ghosthand` skill |
| `Assets/settings-icon.png`, `Assets/ghosthand-icon.icns` | both | the daemon embeds them; public keeps all of `Assets/` |
| `website/`, `db/`, `npm/`, `docs/`, `promo-*`, `demo-video/`, `README.md`, `CHANGELOG.md` | public | `npm/scripts/build.ts` stays public, it builds from `daemon/` |
| `Sources/ghosthand/openapi.yaml` | daemon, copied | `generate-docs` writes `website/openapi.yaml` for docs and types |
| `MEMORY.md`, `screenshot.png` | neither yet | uncommitted; `MEMORY.md` names real users, keep it out of the public repo |
| `AGENTS.md` | split | daemon sections move to `daemon/AGENTS.md` |

### History with git filter-repo

Both repos come from fresh `git clone --no-local` copies of `remorses/ghosthand`. A commit
that touched both sides appears in both repos with the same message and its own half of the
diff. `filter-repo` rewrites hashes inside messages and writes `.git/filter-repo/commit-map`;
keep both maps in the daemon repo under `migration/` so old hashes stay traceable.

```bash
# private daemon: keep only these paths, at the repo root (the submodule root)
git filter-repo --path Sources/ --path Tests/ --path Package.swift --path Package.resolved \
  --path skills/ --path Assets/settings-icon.png --path Assets/ghosthand-icon.icns

# public: drop them
git filter-repo --invert-paths --path Sources/ --path Tests/ --path Package.swift \
  --path Package.resolved --path skills/
```

Before the public push: `gitleaks git` on the filtered clone, `git filter-repo --analyze` for
large blobs, `git log --all -- .passcode` must be empty. `remorses/ghosthand` stays as a
private archive with the full history; it is never made public.

### Build without the private repo

| Job | Needs `daemon/` | How |
| --- | --- | --- |
| website typecheck, test, deploy | no | reads committed `website/openapi.yaml`, `mcp-tools.json`, `src/generated/daemon-api.ts`, and the base skill (if kept public) |
| `pnpm generate-docs` | yes | runs `swift run ghosthand docs-json` with `cwd: daemon/`; without the submodule it exits with "needs access to ghosthand-dev/ghosthand-daemon" |
| `npm/scripts/build.ts` | yes | `swiftRoot = repoRoot/daemon`; Info.plist and icon from `daemon/`; same clear error |
| `swift test` | yes | run inside `daemon/` |
| npm publish | yes | Tommy's Mac only, as today |

Public CI is optional (none exists today). If added, it runs only website `tsc` and tests with
`submodules: false`.

### Commit rules for AGENTS.md

Root `AGENTS.md` gets a "Daemon submodule" section:

- Swift and private skills live in `daemon/`, a private submodule. Never copy daemon code,
  private skill text or `daemon/AGENTS.md` content into the public repo, issues or PRs.
- At session start also run `git -C daemon status -s -u` and `git -C daemon diff`.
- Order: commit and **push in `daemon/` first**, then commit the new pointer in the parent
  (`git add daemon`). Never commit a pointer to an unpushed daemon commit.
- Both commits carry the `Session:` and `Discord:` trailers. The parent message says what the
  daemon change does in one line, not its code.
- After `git pull` run `git submodule update --init`. Do not commit a pointer that moved only
  because of a pull, together with unrelated work.
- Critique: run it in `daemon/` for daemon commits and in the root for the pointer.
- Read `daemon/AGENTS.md` before editing anything in `daemon/`.

`daemon/AGENTS.md` takes the sections that describe Swift internals: CLI help as manual, the
two front ends, USB services, control modes, relative pointer, scroll, reference sources, dev
builds, the daemon side of account and Strada. Root keeps device access, website, account and
billing (server side), tasks, publishing, docs generation, demo videos.

## Source access for subscribers

- **Why an org:** only org-owned repos give read-only collaborators (`permission: pull`); on
  a personal repo every collaborator can push.
- **Identity:** the dashboard shows **Request access** for Pro orgs with a GitHub username
  field. GitHub invites to a repo only by username, never by email. The server checks the
  name with `GET /users/{username}` and stores the numeric GitHub user id in a new
  `source_access (org_id PK, github_user_id, github_login, requested_at)` table, so a later
  rename does not break removal. A typo invites the wrong account; the user can change the
  name, which removes the old one.
- **Credential:** Tommy's fine-grained personal access token, scoped to the
  `ghosthand-dev` org and only the `ghosthand-daemon` repo, with Administration: write. One
  Sigillo secret in `website`: `GITHUB_TOKEN`. Invites show as sent by Tommy; renew the token
  before it expires (date in `MEMORY.md`). A GitHub App can replace it later with no other
  change.
- **One function, derived state:** `syncSourceAccess(orgId)` in a new
  `website/src/lib/github.ts`. Desired = entitlement has `sourceAccess` and a GitHub account
  is requested. Actual = GitHub collaborators and pending invitations. It adds (`permission:
  pull`), removes, and deletes stale invitations until they match. No access table: GitHub is
  the actual state, Postgres the desired one, so a rerun is always safe.
- **Triggers:** after `syncSubscription` in the Stripe webhook, after a request or a name
  change, and a
  daily Worker cron that lists `affiliation=outside` collaborators and fixes drift. Cron is
  one run per day, no Durable Object.
- **Cancel:** `cancel_at_period_end` keeps access until the period ends; the
  `customer.subscription.deleted` webhook removes it. `past_due` keeps access while Stripe
  retries, like the plan itself.
- **What stays with them:** removal deletes their GitHub forks, not local clones. The daemon
  repo license says what they may do (read, build for own use, no redistribution).
- **Dashboard states:** Request access, Invite sent (link to
  https://github.com/ghosthand-dev/ghosthand-daemon/invitations), Access active, Error (with
  retry).

## Task 1: prototype the split on scratch clones

**Depends on.** None. No pushes. Done: evidence in Appendix A.

**Build.**
- [x] Two `git clone --no-local` copies in `tmp/split/`, run both filter commands above.
- [x] In the daemon copy, `swift build` and `swift test` at its root.
- [x] In the public copy, `pnpm install`, `pnpm -C website typecheck` with the base skill and
      `website/openapi.yaml` copied in by hand (simulates Task 3).

**You see.**
- [x] Daemon copy: only the listed paths in `git log --all --name-only`; commit count noted.
- [x] Public copy: no `.swift`, `.m`, `.h` or `skills/` path in any commit.

**Verify.**
- [x] `git log --all --name-only --pretty=format: | grep -E '\.(swift|m|h)$|^skills/'` on the public copy prints nothing.
- [x] `gitleaks git` on the public copy reports no leaks.
- [x] `swift test` passes in the daemon copy, website `tsc` passes in the public copy.

**Progress.**

## Task 2: create the repos and push history

**Depends on.** Task 1, and the user's go for GitHub changes. Done Oct 27 2026.

**Build.**
- [x] Freeze: no active sessions (`kimaki session list --active` empty). `MEMORY.md`,
      `screenshot.png` and `README.md` edits stayed uncommitted in the working tree.
- [x] Rerun on fresh clones of `2d2e3c0`: daemon 216 commits, public 228 commits.
      The base skill `skills/ghosthand/` stays public with its history; only private skills
      go to the daemon.
- [x] `ghosthand-dev/ghosthand-daemon` (private) pushed, `072870d` adds `LICENSE`,
      `AGENTS.md`, `.gitignore` and `migration/{daemon,public}-commit-map`.
- [x] `ghosthand-dev/ghosthand` (private) pushed: `main`, `promo-video` and the
      `ghosthand@*` tags. GitHub releases were not copied.

**Verify.**
- [x] Both repos print `private` (`gh repo create --private`).
- [x] `gitleaks git` on the public history: no leaks.

**Progress.**
- The old `.git` is at `~/Documents/ghosthand-old-remorses.git` (stashes, old branches, the
  two linked worktrees were repaired to point there).

## Task 3: wire the submodule and the builds

**Depends on.** Task 2.

**Build.**
- [x] The working folder now uses the public repo's `.git`; root daemon files removed;
      `git submodule add https://github.com/ghosthand-dev/ghosthand-daemon.git daemon` with
      `branch = main`, `update = merge`. `.build` moved to `daemon/.build`.
- [x] `build.ts`: Swift root `daemon/`, Info.plist and icon from `daemon/`, dev app at
      `daemon/.build/Ghosthand.app`, clear error without the submodule.
- [x] `generate-docs.ts`: Swift runs in `daemon/`, writes `website/openapi.yaml`; `docs.jsonc`
      and openapi-typescript read it.
- [x] Base skill kept at `skills/ghosthand/SKILL.md`, so the website imports did not change.
- [x] Global wrapper `~/.local/bin/ghosthand` and the opencode `skills` path (adds
      `daemon/skills`) updated on this Mac. Other Macs not touched.
- [x] `AGENTS.md` split: Swift internals moved to `daemon/AGENTS.md`; root has the submodule
      rules (always on `main`, never detached; daemon first, then pointer).
- [x] Comment paths `Sources/...` in website and docs now `daemon/Sources/...`; npm and
      dashboard repo links point to `ghosthand-dev/ghosthand`.
- [ ] README links to `Sources/...`: left for the session that owns the uncommitted README
      edits.

**Verify.**
- [x] With submodule: `build.ts --dev` printed "ghosthand 0.12.0 dev build ready".
- [x] `pnpm generate-docs` leaves no diff except the new `website/openapi.yaml`;
      `pnpm build` and `tsc` pass.
- [ ] Fresh clone without submodule builds the website (see Progress).

**Progress.**

## Task 4: device limits on the website

**Depends on.** Task 3.

**Files.**
- [ ] Edit `website/src/lib/billing.ts`, `website/src/lib/billing.test.ts`, `db/src/schema.ts`,
      new migration in `db/drizzle/`, `website/src/cli-api.ts`, `website/src/lib/stripe.ts`,
      `website/src/telemetry.ts`, a new test next to `tunnel-auth.test.ts`.

**Build.**
- [ ] `billing.ts`: `Plan = 'free' | 'pro'`; `Entitlement` gets `paidMacs` (subscription
      quantity, 0 on free) and `sourceAccess`. A pure `leaseDecision({ entitlement, devices,
      phone, mac })` returns allowed, or the limit hit and its notice. Delete `TRIAL_DAYS`,
      `trialEndsAt` and the `expired` state.
- [ ] Schema: `org_device` as above, cascading on `org`, indexed on `org_id`.
      `subscription` gets `quantity`.
- [ ] `POST /api/cli/lease-check` (session token) binds and decides in one statement.
      `GET /api/cli/account` returns `plan`, `paidMacs`, bound devices, `sourceAccess`.
- [ ] Checkout with adjustable quantity; `syncSubscription` stores it and frees extra Macs.
- [ ] `requirePlan` no longer blocks free uploads; tasks follow open question 3.
- [ ] Typed events `device_limit_reached`, `source_access_granted`, `source_access_revoked`.

**Verify.**
- [ ] `billing.test.ts` inline snapshot of `leaseDecision`: free first phone, free second
      phone, Pro paid Mac with 5 phones, Pro unpaid Mac with the free phone, Pro unpaid Mac
      with a second phone, quantity lowered.
- [ ] Real-runtime test: two parallel lease-checks for the last Mac slot give one winner.

**Progress.**

## Task 5: device check in the daemon

**Depends on.** Task 4.

**Files.**
- [ ] Edit `daemon/Sources/ghosthand/account.swift`, `controller.swift`, `state-db.swift`,
      `openapi.yaml`, `main.swift` (help), `setup-app.swift` (trial text), `telemetry.swift`,
      `daemon/Tests/ghosthandTests/lease-tests.swift`, `daemon/skills/ghosthand/SKILL.md`.

**Build.**
- [ ] `authorizeLease(udid:)` hashes the UDID and the Mac's IOPlatformUUID, calls
      `lease-check`, and caches the answer in `state.db` (new migration).
- [ ] `acquireLease` resolves the device before the check (today it checks first).
- [ ] Offline rules from the table above; no more fail-open for unknown devices.
- [ ] Help text for acquire, account and `agentLoopHelp`: the free plan is one iPhone;
      on `subscription-required` show the link and stop. `generate-docs` after.

**Verify.**
- [ ] Swift test on the cache: known phone offline before `validUntil` allowed, new phone
      offline refused, expired cache refused.
- [ ] Real iPhones, free test account on `pnpm dev`: first iPhone leases, second iPhone fails
      with the subscribe link; after Remove on the dashboard the second iPhone leases.

**Progress.**

## Task 6: GitHub source access

**Depends on.** Task 4, and the user's go before creating the token or adding secrets.

**Build.**
- [ ] Tommy creates the fine-grained token (Playwriter, user present), stored as
      `GITHUB_TOKEN` in Sigillo and in `wrangler.jsonc` `secrets.required` (both envs).
- [ ] `source_access` table and a `requestSourceAccess` server action (zod-parsed username);
      **Request access** form on the dashboard.
- [ ] `website/src/lib/github.ts`: `syncSourceAccess(orgId)` with `GITHUB_TOKEN`.
- [ ] Call it from the webhook and the server action; daily `scheduled` handler for drift.

**Verify.**
- [ ] Preview deploy with a Stripe test subscription and a test GitHub account: invite with
      `permission: read` appears in `gh api repos/ghosthand-dev/ghosthand-daemon/invitations`.
- [ ] Cancel in the test portal and fire `customer.subscription.deleted`: the collaborator and
      any pending invite are gone.
- [ ] Remove the collaborator by hand on GitHub, run the cron locally
      (`/cdn-cgi/handler/scheduled`): access comes back.

**Progress.**

## Task 7: docs, pricing and account pages

**Depends on.** Tasks 4 and 6.

**Files.**
- [ ] Edit `website/src/docs/pricing.mdx`, `terms.mdx`, `privacy.mdx`,
      `website/src/components/account-pages.tsx`, `account-client.tsx`, `server.tsx` (login
      copy), `README.md`, `daemon/skills/ghosthand/SKILL.md`.

**Build.**
- [ ] `pricing.mdx`: Free vs Pro table (iPhones, Macs, remote MCP, API, tasks, daemon
      source, private skills, price); how paid Macs and switching work; offline rules; how
      source access works.
- [ ] `terms.mdx`: free plan instead of trial, the source license, removal on cancel.
- [ ] `privacy.mdx`: GitHub username and user id, hashed iPhone and Mac ids with their names.
- [ ] Dashboard: bound iPhone and paid Macs with Remove, Mac quantity, Pro source access
      states. Login copy: "Free for one iPhone".
- [ ] README: pricing paragraph, open-source note, link to the daemon license.

**Verify.**
- [ ] Playwriter screenshots of `/docs/pricing`, `/dashboard` free and Pro, light and dark.
- [ ] `curl -sI` every new URL returns 200.

**Progress.**

## Task 8: release

**Depends on.** Tasks 5, 6, 7, and the user's go before each step: production migration,
each deploy, the Stripe change, and the npm publish.

**Build.**
- [ ] `pnpm db:migrate:prod`, `pnpm run deploy` (preview), check, `pnpm run deploy:prod`.
      The website must ship before the daemon: old daemons ignore the new account fields.
- [ ] Stripe: `ghosthand_pro_monthly` stays $99, now per Mac (quantity); portal allows
      quantity changes; product text mentions source access.
- [ ] Bump `npm/package.json` and `daemon.swift`, publish with `cd npm && pnpm publish --no-git-checks`.

**Verify.**
- [ ] `npx ghosthand@<version> account` on a free account shows the free plan and its iPhone.
- [ ] Strada: no new `internal-error` for `lease-check` after one day.

**Progress.**

## Task 9: go public

**Depends on.** Task 8, and the user's go.

**Build.**
- [ ] Final `gitleaks git` on `ghosthand-dev/ghosthand`, `LICENSE` (MIT) at the root.
- [ ] Make `ghosthand-dev/ghosthand` public; archive `remorses/ghosthand`; update every link
      to `github.com/remorses/ghosthand` (dashboard footer, npm `repository`, README).

**Verify.**
- [ ] Logged-out `curl -s https://github.com/ghosthand-dev/ghosthand` shows the repo;
      logged-out `curl -sI https://github.com/ghosthand-dev/ghosthand-daemon` is 404.

**Progress.**

## Done

- [ ] Every box above is checked with evidence.
- [ ] A free account on production: a second iPhone is refused.
- [ ] A Pro account with 1 Mac: 3 iPhones on it lease; a second iPhone on another Mac is refused.
- [ ] A Pro account on production: receives the read invite, loses it after cancel.
- [ ] A fresh public clone without the submodule builds and deploys the website.

## Open questions

1. **What "one Mac" means for Pro.** Recommend **$99 per Mac** as a Stripe quantity, so a
   company with 3 Macs pays $297. The other reading (one Pro plan, one Mac, no way to add
   more) blocks the companies Pro is for.
2. **Switching the free iPhone.** Recommend **Remove on the dashboard, any time**, no
   cooldown, until Strada shows abuse.
3. **Phone tasks on free.** They spend AI Gateway tokens with no time limit to cap them.
   Recommend **Pro only**; free accounts get a subscribe message from `ghosthand task`.
4. **Base `ghosthand` skill.** Recommend keeping **`skills/ghosthand/SKILL.md` public** (move
   it to `website/skills/`): free users install it with `npx skills add https://ghosthand.dev`
   and the task agent embeds its "Phone tips". Task skills (`ghosthand-accounts`,
   `tiktok-warmup`) go private.
5. **Public license.** Recommend **MIT** for the public repo and a short
   **source-available** license for the daemon repo. The npm package ships the closed
   binary, so its `license` becomes `SEE LICENSE IN LICENSE`.

## Appendix A. Prototype evidence

Run on Oct 27 2026 from `2d2e3c0` (314 commits) in `tmp/split/`, nothing pushed:

- Daemon filter: 218 commits. `swift build` and `swift test` at its root: 57 tests pass.
- Public filter: 226 commits. No `.swift`, `.m`, `.h` or `skills/` path in any commit.
  `gitleaks git`: no leaks in 223 commits. `.passcode` never committed. Largest blob 3.7 MB
  (`website/public/assets/demo-tiktok-warmup.mp4`). No user names or keys in diffs.
- Public website without daemon files: `tsc` passes; `vite build` fails only on the missing
  OpenAPI spec. With exactly two files added (`skills/ghosthand/SKILL.md`,
  `Sources/ghosthand/openapi.yaml`) the full build passes. Task 3 moves those two to
  public paths (`website/skills/`, `website/openapi.yaml`).

## Appendix B. Decisions

- `plans/decisions/plan-device-limits.md`
- `plans/decisions/daemon-source-access.md`

## Appendix C. Risks

- **Split during active work** (Task 2): other sessions commit to the old repo. Freeze and
  rerun the filters on the latest `main`.
- **Leaking private code into the public repo later** (every task): a commit in the root that
  copies Swift or skill text. The AGENTS.md rule covers it; if it happens once, add the
  grep from Task 1 as a test in the public repo.
- **A token with Administration: write** (Task 6) could delete the daemon repo if it leaks.
  It is scoped to that repo only and lives only in Sigillo and Worker secrets.
- **GitHub invite limit** of 50 per repo per day (Task 6): fine at today's scale; the cron
  retries the rest.
- **Rotating the free iPhone** by hand on the dashboard (Task 7). Cheap to allow; add a
  cooldown only if Strada shows it.
- **Old daemons** (Task 8) call `GET /api/cli/account`, which cannot see the iPhone, so they
  get unlimited iPhones until they update. Once the new version is out, that route answers
  `allowed: false` with an update message for daemons older than it (version in the
  User-Agent).
