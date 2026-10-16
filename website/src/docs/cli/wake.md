---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand wake"
sidebarTitle: "wake"
description: "Turn the display on with a Bluetooth click at the status bar, then check that USB frames arrive"
---

## Usage

```bash
ghosthand wake
```

## Options

| Option | Description |
| --- | --- |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |

Also takes the [global options](/docs/cli/overview#global-options).

## Examples

```bash
$ ghosthand wake -l 42
```

## MCP tool

The same command is the MCP tool [`wake`](/docs/mcp/wake); flags are arguments.
