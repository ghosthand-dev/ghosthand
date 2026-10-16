---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand assistivetouch"
sidebarTitle: "assistivetouch"
description: "Show, or turn on or off, AssistiveTouch over USB (no touch on the phone, also while locked). acquire turns it on, release turns it off"
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
  a few seconds after a lease expires. A person's own AssistiveTouch stays on.
- `off` hides the pointer during a lease. The next tap turns it on again.
- Keys and typing work without the pointer, so key and type do not turn it on.

## Examples

```bash
$ ghosthand assistivetouch -l 42
$ ghosthand assistivetouch -l 42 off
```

## MCP tool

The same command is the MCP tool [`assistivetouch`](/docs/mcp/assistivetouch); flags are arguments.
