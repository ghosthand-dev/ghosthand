---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand photo pull"
sidebarTitle: "photo pull"
description: "Copy the newest Camera Roll files (photos, videos, screenshots) from the iPhone to this Mac"
---

## Usage

```bash
ghosthand photo pull
```

## Options

| Option | Description |
| --- | --- |
| `--last [n]` | How many of the newest files (default: 1) |
| `-o, --out [folder]` | Folder to save them in (default: this folder) |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Prints each saved path. Files keep their iPhone names (IMG_0004.PNG).
MCP returns original bytes as embedded resource blobs, up to 16 MiB total; there is no out argument.

## Examples

```bash
$ ghosthand photo pull -l 42
$ ghosthand photo pull -l 42 --last 5 -o ./photos
```

## MCP tool

The same command is the MCP tool [`photo-pull`](/docs/mcp/photo-pull); flags are arguments.
