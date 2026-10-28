---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand daemon restart"
sidebarTitle: "daemon restart"
description: "Restart the daemon"
---

## Usage

```bash
ghosthand daemon restart
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

- The daemon restarts on ~/Applications/Ghosthand.app. A CLI that is a newer build installs
  itself there first, so `npx ghosthand@latest daemon restart` also updates it; an older CLI
  never downgrades it. Leases stay valid (state.db); running commands get 2 s to finish.
- After a restart, macOS screen capture needs about 5 s, sometimes over a minute:
  screenshots fail with no-frame or no-device until then. Ask before restarting while
  another agent holds a lease.
- You rarely need it: when the installed app is a newer build than the daemon (an update
  from npm or the installer, or a rebuild), the daemon restarts on it by itself, but only
  when no lease is active. Until then commands use the running daemon.
- Older daemons without safe restart support are not upgraded automatically. After
  agents finish, run `ghosthand daemon stop`, then `ghosthand daemon start`.
- If the daemon comes back on another build than the installed app, it is stopped and
  started again.
- A daemon that does not answer in 10 s is stopped (SIGTERM, then SIGKILL) and started again.

## Examples

```bash
$ ghosthand daemon restart
```
