---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand record stop"
sidebarTitle: "record stop"
description: "Stop the screen recording and wait until the file is complete. Prints path, duration, size, resolution and fps"
---

## Usage

```bash
ghosthand record stop
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

After an automatic stop (max duration) it prints that recording once.
- `no-recording`: nothing is recording and no finished recording is waiting.
- `recording-failed`: the writer failed (for example a full disk); the file is
  incomplete or missing.

## Examples

```bash
$ ghosthand record stop -l 42
```

## MCP tool

The same command is the MCP tool [`record-stop`](/docs/mcp/record-stop); flags are arguments.
