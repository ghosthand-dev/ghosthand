---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand shutdown"
sidebarTitle: "shutdown"
description: "Turn the iPhone off over USB. Only a person can turn it on again"
---

## Usage

```bash
ghosthand shutdown
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Ask the user first: only a press of the side button turns it on again.

## Examples

```bash
$ ghosthand shutdown -l 42
```

## MCP tool

The same command is the MCP tool [`shutdown`](/docs/mcp/shutdown); flags are arguments.
