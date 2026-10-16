---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand info"
sidebarTitle: "info"
description: "Show battery, storage, iOS build, serial number, language and time zone over USB (works while locked)"
---

## Usage

```bash
ghosthand info
```

## Options

| Option | Description |
| --- | --- |
| `--json` | Print JSON |

Also takes the [global options](/docs/cli/overview#global-options).

## Examples

```bash
$ ghosthand info -l 42
```

## MCP tool

The same command is the MCP tool [`info`](/docs/mcp/info); flags are arguments.
