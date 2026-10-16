---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand logs"
sidebarTitle: "logs"
description: "Read the iPhone system log over USB for a few seconds, filtered by process or text"
---

## Usage

```bash
ghosthand logs
```

## Options

| Option | Description |
| --- | --- |
| `--seconds [s]` | How long to read, 1-120 (default: 5) |
| `--process [name]` | Only this process, e.g. SpringBoard, appstored |
| `--grep [text]` | Only lines that contain this (case-insensitive) |
| `--limit [n]` | Stop after this many lines (default: 500) |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The log has no history over USB: lines start when the command starts. Run it while the
thing you watch happens (e.g. an App Store download: `--process appstored`).
Lines look like `Oct  9 21:30:01 iPhone appstored(AppStoreDaemon)[123] <Notice>: ...`.

## Examples

```bash
$ ghosthand logs -l 42 --process appstored --grep Downloading --seconds 10
```

## MCP tool

The same command is the MCP tool [`logs`](/docs/mcp/logs); flags are arguments.
