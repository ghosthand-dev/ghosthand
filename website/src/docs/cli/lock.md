---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand lock"
sidebarTitle: "lock"
description: "Lock the iPhone over Bluetooth with Control-Command-Q; verify over USB"
---

## Usage

```bash
ghosthand lock
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Do not lock at the end of a task: a locked iPhone gives no screenshots, and the next
task must unlock it. Lock only when the task asks for it.
- Not available in XCTest mode (unsupported-in-mode): XCTest cannot unlock it again.

## Examples

```bash
$ ghosthand lock -l 42
```

## MCP tool

The same command is the MCP tool [`lock`](/docs/mcp/lock); flags are arguments.
