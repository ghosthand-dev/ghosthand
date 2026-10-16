---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand daemon status"
sidebarTitle: "daemon status"
description: "Show daemon state, listeners, Bluetooth state and the log path"
---

## Usage

```bash
ghosthand daemon status
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

- When a command fails without a clear reason, read the daemon log:
  `tail -n 100 ~/.ghosthand/daemon.log`. Lines start with a UTC timestamp.

## Examples

```bash
$ ghosthand daemon status
```
