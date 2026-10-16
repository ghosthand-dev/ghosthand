---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand daemon run"
sidebarTitle: "daemon run"
description: "Run the daemon in the foreground (for launchd or debugging)"
---

## Usage

```bash
ghosthand daemon run
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Foreground debugging inherits your host's macOS permission identity. Use `daemon start` for the separate Ghosthand.app identity.

## Examples

```bash
$ ghosthand daemon run
```
