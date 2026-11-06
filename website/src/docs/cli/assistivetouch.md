---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand assistivetouch"
sidebarTitle: "assistivetouch"
description: "Show, or turn on or off, AssistiveTouch over USB (no touch on the phone, also while locked). acquire turns it on when off, release turns it off again"
---

## Usage

```bash
ghosthand assistivetouch [on|off]
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Without an argument it prints `on` or `off`. You never need `on` before input.
- AssistiveTouch is what shows the Bluetooth mouse pointer. With it off the iPhone
  ignores every click. acquire turns it on; tap, swipe and wake check it
  again (~35 ms) in case a person turned it off.
- When ghosthand turned it on, release turns it off again, and so does the daemon
  a few seconds after a lease expires. If it was on before, it stays on.
- `on` and `off` set the iPhone's own setting: release leaves it as set. Use `on`
  when the person needs AssistiveTouch after the lease (e.g. a broken Home button).
- `off` also hides the pointer during a lease. The next tap turns it on again,
  and release turns it off.
- Keys and typing work without the pointer, so key and type do not turn it on.

## Examples

```bash
$ ghosthand assistivetouch -l 42
$ ghosthand assistivetouch -l 42 on
```

## MCP tool

The same command is the MCP tool [`assistivetouch`](/docs/mcp/assistivetouch); flags are arguments.
