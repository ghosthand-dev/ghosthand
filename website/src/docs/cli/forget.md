---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand forget"
sidebarTitle: "forget"
description: "Remove this Mac's Bluetooth bond with the iPhone, to pair again from scratch"
---

## Usage

```bash
ghosthand forget
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Use it when pairing fails or the iPhone no longer reconnects ("Connection
unsuccessful", or `list` stays at bluetooth disconnected): one side kept an old
bond. Then on the iPhone: Settings &gt; Bluetooth &gt; the Mac &gt; (i) &gt; Forget This Device,
run any input command, and tap the Mac &gt; Pair. Also clears the saved pointer mode.

## Examples

```bash
$ ghosthand forget -l 42
```

## MCP tool

The same command is the MCP tool [`forget`](/docs/mcp/forget); flags are arguments.
