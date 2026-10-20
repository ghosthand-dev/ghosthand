---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand setup status"
sidebarTitle: "setup status"
description: "Read setup readiness as JSON, including missing permissions and disconnected phones; no lease needed"
---

## Usage

```bash
ghosthand setup status
```

## Options

| Option | Description |
| --- | --- |
| `-d, --device [id]` | USB id, capture id or exact name of the intended iPhone; required when several are connected |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Open setup once, then poll this command every 2 seconds while the user follows the app.
Returns ready, device (selected USB id) and overview (permissions and each phone's step).
Missing permissions, no phone, and incomplete setup are normal JSON results, not errors.
- ready is true only when the Mac is signed in (overview.account.state signed-in),
  Camera is allowed and one selected iPhone is unlocked,
  present in USB capture, and connected over Bluetooth. AssistiveTouch may be off;
  acquire turns it on. This check does not acquire a lease or send input.
- With several iPhones, pass --device. Missing or ambiguous selection returns ready false;
  never continue on a different ready phone. Once a phone is selected, use its device id
  on later polls so a cable change cannot switch your target. When ready, acquire
  that phone with its captureId from overview (the id shown by list).
- All actions in the Ghosthand app window are user-only. Agents must not interact with the window or complete setup for the user. Poll `ghosthand setup status` (MCP: setup-status) every 2 seconds until ready is true. Pass --device (MCP: device) for the intended iPhone if known or if several are connected; use the returned device id on later polls. When ready, acquire that phone using its captureId from overview. Wait while the user completes setup, then continue automatically when ready. Do not reopen setup, request permissions, or retry input while waiting. If setup is still incomplete after 10 minutes, report the current status instead of retrying forever.
- This Mac only: setup of an iPhone on another Mac happens on that Mac.

## Examples

```bash
$ ghosthand setup status
$ ghosthand setup status --device "iPhone XR"
```

## MCP tool

The same command is the MCP tool [`setup-status`](/docs/mcp/setup-status); flags are arguments.
