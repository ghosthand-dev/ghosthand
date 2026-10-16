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

- The local daemon restarts with this CLI's binary, so `npx ghosthand@latest daemon restart`
  also updates it. Leases stay valid (state.db); running commands get 2 s to finish.
- After a restart, macOS screen capture needs about 5 s, sometimes over a minute:
  screenshots fail with no-frame or no-device until then. Ask before restarting while
  another agent holds a lease.
- You rarely need it: when a command sees that the daemon is an older version, or the
  same binary was rebuilt, it restarts the daemon by itself, but only when no lease is
  active. Until then it uses the running daemon.
- Older daemons without safe restart support are not upgraded automatically. After
  agents finish, run `ghosthand daemon stop`, then `ghosthand daemon start`.
- If the daemon comes back on its old binary (macOS blocked the app update), it is
  stopped and started with this CLI.
- A daemon that does not answer in 10 s is stopped (SIGTERM, then SIGKILL) and started again.

## Examples

```bash
$ ghosthand daemon restart
```
