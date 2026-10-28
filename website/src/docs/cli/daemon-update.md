---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand daemon update"
sidebarTitle: "daemon update"
description: "Install the latest release now, or turn auto-update on or off"
---

## Usage

```bash
ghosthand daemon update [--auto <on|off>]
```

## Options

| Option | Description |
| --- | --- |
| `--auto <on\|off>` | Only save the setting: off stops the daemon from installing new releases by itself |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

- Auto-update is on by default, for the installer and for npm: the daemon checks
  https://ghosthand.dev/releases/latest.json every hour, downloads a newer notarized
  Ghosthand.app, checks its Developer ID and Gatekeeper, and installs it in
  ~/Applications. It never installs while a lease is active and never downgrades.
  The daemon then restarts on it once no lease is active.
- Without --auto: checks now and installs a newer build, also with auto-update off.
- `ghosthand daemon status` shows the update state.

## Examples

```bash
$ ghosthand daemon update
$ ghosthand daemon update --auto off
```
