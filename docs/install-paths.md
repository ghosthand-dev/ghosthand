---
title: Install paths and the daemon upgrade state machine
description: How the .pkg installer, npx, npm -g and dev builds share one ~/Applications/Ghosthand.app and one daemon, every transition between them, and the bugs found in the old design.
---

# Install paths

One rule: **~/Applications/Ghosthand.app only moves forward, and the daemon runs what is installed.**

```
npx ghosthand@latest ─────┐  install(): copy only a newer build
npm install -g ghosthand ─┤  (buildIsNewer: version, then time)
dev build (--dev) ────────┼──────────────────────────────────────> ~/Applications/Ghosthand.app
daemon updater (hourly) ──┘                                            ▲         │
                                                    .pkg installer ────┘         │
                                                    (any build: user's choice)   │
     CLI ensureReady: installed build newer than daemon, no lease ──┐            │
     daemon upkeep: app file replaced, no lease (2 ticks) ──────────┴─> daemon execv's it
```

A build id is `GhosthandSourceBuildID` from `npm/scripts/build.ts`: `0.13.0+20261027142654`. The npm package and the .pkg of one release are the same build. A dev rebuild of the same version has a later time, so it is newer.

## State

| Axis | Values |
|---|---|
| Installed app | none, a release build `vX+T` |
| Daemon | stopped, running build `D` (from ~/Applications, or a dev `daemon run`) |
| CLI | none on PATH (pkg only), npx cache, npm -g, dev build, the installed binary itself |
| LaunchAgent | absent, loaded, turned off in Login Items |
| Setup window | closed, open on build `W` (relaunches itself when the installed build changes) |
| macOS permissions | bound to the Developer ID requirement (bundle id + team): kept across every signed build |

## Transitions (after the fix)

| From | Event | Result |
|---|---|---|
| nothing | .pkg | app installed, postinstall opens it, window adds the LaunchAgent, daemon starts on it |
| nothing | `npx ghosthand <cmd>` | CLI copies its bundle, starts the daemon (kickstart or Launch Services) |
| app `B`, daemon `B` | newer CLI | CLI installs `B'`, restarts daemon if no lease; else the daemon restarts itself once idle |
| app `B`, daemon `B` | older CLI (stale npx cache, old npm -g) | no copy, no restart; the daemon tells it to update |
| app `B`, daemon `B` | newer .pkg | app replaced; the opened app restarts the daemon if idle, else the daemon does it once idle |
| app `B`, daemon `B` | same .pkg again | app files replaced, same build; the daemon restarts once idle so it never runs deleted files |
| app `B`, daemon `B` | older .pkg file | app downgraded (explicit user choice); the daemon follows once idle; the next newer CLI moves it forward again |
| any | daemon crash or login | launchd starts the installed binary |
| app `B`, no node | agent needs the CLI | `~/Applications/Ghosthand.app/Contents/MacOS/ghosthand` (skill says so) |
| app `B`, daemon `B` | release `B'` in latest.json, auto-update on | daemon downloads and checks the zip; once no lease is active it installs `B'` and restarts on it |
| app `B`, daemon `B` | release `B'`, a lease is active | zip downloaded and checked, kept until no lease is active, then installed |
| app `B'`, daemon `B'` | latest.json names `B` or older | nothing: only a newer build is downloaded, and install() is newer-only too |
| any | auto-update off (`ghosthand daemon update --auto off`) | no download; `ghosthand daemon update` still installs on request |

## Auto-update

One updater for every install path, in the daemon (`updater.swift`). The daemon always runs `~/Applications/Ghosthand.app`, so npm and .pkg users get the same update.

```
upkeep tick ──hourly──> GET <GHOSTHAND_SERVER>/releases/latest.json   {version, build, zip, pkg}
     │ build newer than the installed app?
     ▼
GET /releases/Ghosthand-<v>.zip ──ditto -x──> ~/.ghosthand/update/Ghosthand.app
     │ checks: bundle id, GhosthandRelease, build id = manifest, newer than installed,
     │         LSMinimumSystemVersion, Developer ID of team 92MF9DG2LR + notarized, spctl
     ▼ no lease active (else it waits, checked, and installs on a later tick)
GhosthandApplication.install() ──> ~/Applications/Ghosthand.app ──> upkeep restart once idle
```

- **Why the R2 zip, not the npm tarball:** same build (one `build.ts --release --upload` run), but the zip is the stapled bundle exactly as `ditto` wrote it, on the server the download page already uses. The tarball needs registry metadata, a tar extract and the package layout.
- **Off switch:** `ghosthand daemon update --auto off`, stored in the macOS defaults (`com.remorses.ghosthand AutoUpdate`). `ghosthand daemon update` checks and installs now, also when off. `ghosthand daemon status` shows the state.
- **Failures** (download, check, install) keep that build out for an hour, are logged, and non-network ones go to Strada (`Updater.run`).
- Manifests uploaded before the updater existed have no `build`; the updater ignores them.
- The daemon writes its own app bundle: macOS App Management allows it because both are signed by our Developer ID team (tested on macOS 26.7.1, launched by Launch Services). Earlier ad-hoc signed builds got EPERM there.

## Bugs found in the old design

The old design kept `~/.ghosthand/app-source`: the path of the CLI whose bundle was "last copied". The daemon reported it as its `executable`, and the CLI treated "same source path" as "my own daemon".

1. **Restart loop with an older CLI.** `install()` wrote app-source even when it skipped the copy because the installed app was newer. A stale npx cache or old global npm CLI then saw its own path as the daemon's source, with a different build, and asked for a restart. The daemon came back on the newer installed build, the CLI said "daemon kept its old binary", stopped and started it. Twice per command, each costing ~5 s of screen capture. It would start with the first release after 0.13.0.
2. **Upgrade stuck while a lease is active.** A .pkg or newer CLI replaced the app while an agent held a lease. Only a later client could restart the daemon, and an equal or older CLI never did. The daemon kept running the deleted bundle until the next login. Now the daemon restarts itself once no lease is active.
3. **Dev rebuild of the same version ignored** unless app-source already pointed at it. Now a later build time is newer.
4. **Same-build reinstall** left the daemon on deleted files (codesign of the process fails). Now detected by file identity, not build id.
5. **No CLI after a .pkg-only install without Node.js.** The skill now names the installed binary.

Checked on mintmacbook (pkg-only Mac, no Node): a dev CLI upgraded the pkg app and restarted the 0.13.0 daemon; then the 0.13.0 .pkg was installed over it while a lease was active, the daemon waited, and restarted on the installed build 1 s after `release`.

## Known gaps

- A **.pkg can downgrade** the app: Installer has no check against a newer installed build. Only an old .pkg file can do it (the download page serves the latest).
- An old 0.13.0 CLI that runs `daemon restart` against a newer daemon still prints "daemon kept its old binary" once and stops and starts it. No loop.
