---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand release"
sidebarTitle: "release"
description: "End the lease from -l or GHOSTHAND_LEASE, so another client can acquire the iPhone"
---

## Usage

```bash
ghosthand release [--keep-assistivetouch]
```

## Options

| Option | Description |
| --- | --- |
| `--keep-assistivetouch` | Leave AssistiveTouch on after the release |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Waits for a running command of the lease to finish, then ends it.
- Turns AssistiveTouch off, also when it was on before acquire, so the person gets
  the phone back without a pointer. --keep-assistivetouch leaves it on.
- A lease that ends by its idle timeout turns it off too, a few seconds later.
- The output says "AssistiveTouch turned off" when it did. An iPhone not on USB
  is turned off later, when it is plugged in again with no lease.

## Examples

```bash
$ ghosthand release -l 42
$ ghosthand release -l 42 --keep-assistivetouch
```

## MCP tool

The same command is the MCP tool [`release`](/docs/mcp/release); flags are arguments.
