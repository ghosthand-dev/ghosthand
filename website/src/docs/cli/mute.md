---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand mute"
sidebarTitle: "mute"
description: "Mute all iPhone sound (media in every app too) with the Bluetooth keyboard Mute key, confirmed from the iPhone log over USB"
---

## Usage

```bash
ghosthand mute
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Safe to run again: it sets a state, it does not toggle. The output says muted or
unmuted only after iOS confirmed it.
- How: the keyboard Mute key toggles iOS full mute (all output, media in every app).
  After each press SpringBoard logs the new state; the daemon reads it from the
  iPhone system log over USB. If the phone was already in that state, the first press
  toggles it away and a second press toggles it back (sound for about 50 ms).
- The silent/ringer switch is separate: it does not silence app media.
- Full mute stays on when screen capture starts or stops. Works while capture runs.
- `mute-unconfirmed` error: the key was sent but iOS logged no change. The state is
  unknown and it was not pressed again. Take a screenshot before you retry.
- Not available in XCTest mode (unsupported-in-mode).

## Examples

```bash
$ ghosthand mute -l 42
```

## MCP tool

The same command is the MCP tool [`mute`](/docs/mcp/mute); flags are arguments.
