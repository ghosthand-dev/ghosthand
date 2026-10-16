---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand photo list"
sidebarTitle: "photo list"
description: "List the newest Camera Roll files (photos, videos, screenshots) on the iPhone, newest first"
---

## Usage

```bash
ghosthand photo list
```

## Options

| Option | Description |
| --- | --- |
| `--limit [n]` | How many (default: 20) |
| `--json` | Print JSON |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Reads /DCIM over USB. Names are like IMG_0004.PNG (screenshots are PNG, camera photos
HEIC or JPG, videos MOV). Pass a name to photo delete, or a path to file pull.
- With iCloud Photos "Optimize iPhone Storage", older originals may not be on the phone.

## Examples

```bash
$ ghosthand photo list -l 42 --limit 5
```

## MCP tool

The same command is the MCP tool [`photo-list`](/docs/mcp/photo-list); flags are arguments.
