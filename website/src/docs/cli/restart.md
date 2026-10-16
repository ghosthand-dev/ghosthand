---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand restart"
sidebarTitle: "restart"
description: "Restart the iPhone over USB. Afterwards a person must type the passcode once"
---

## Usage

```bash
ghosthand restart
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Ask the user first. After a restart iOS ignores the Bluetooth keyboard until a person
    unlocks the iPhone by hand once, so `unlock` cannot do it. The USB screen and lease
    come back by themselves in about a minute.

## Examples

```bash
$ ghosthand restart -l 42
```

## MCP tool

The same command is the MCP tool [`restart`](/docs/mcp/restart); flags are arguments.
