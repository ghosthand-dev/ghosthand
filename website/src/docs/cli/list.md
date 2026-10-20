---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand list"
sidebarTitle: "list"
description: "List iPhones connected over USB"
---

## Usage

```bash
ghosthand list
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Only iPhones on a USB cable are listed; a phone near the Mac over Bluetooth or
Wi-Fi is not (macOS gives its screen only over USB). Each line:
  &lt;id&gt;  &lt;name&gt;  &lt;model&gt; iOS &lt;version&gt;  &lt;phone number&gt;  [locked]  (bluetooth &lt;state&gt;, &lt;pointer&gt; pointer)
- id: stable on this Mac (same after rename, iOS update, cable replug). Pass it to `acquire -d`.
- phone number: read from the SIM over USB. Missing without a SIM, or when the carrier
  did not write it to the SIM.
- [locked]: unlock with `ghosthand unlock` before screenshots or input.
- [AssistiveTouch off]: no pointer on the phone. acquire turns it on.
- bluetooth connected: input works.
- bluetooth disconnected: paired; the Mac reconnects it in about 2 s. If it stays so,
  Bluetooth is off on the iPhone or it is out of range: tell the user to turn it on.
- bluetooth not paired: the next input command waits while the user pairs the Mac
  from iPhone Settings &gt; Bluetooth (tap the Mac's name, then Pair).
- pointer: absolute, or relative when the first tap proved absolute does not move
  the pointer (seen on iOS 15 over BLE). Shown after the first tap.
- (xctest &lt;state&gt;) instead of bluetooth: the iPhone uses XCTest mode (`control --help`).
  stopped: the next command starts the runner (about 15 s); failed: see `control -l <id>`.
- Names do not matter: each screen is matched to its USB iPhone once and saved.
  Only several new iPhones with one name, plugged in together, cannot be matched:
  list warns. Plug them in one at a time once.
When no phone is found, the error says why per phone: not on USB, not trusted
(unlock it and tap Trust), or locked.
- Warning "macOS screen capture does not list it": a trusted iPhone was locked or
  untrusted when plugged in. Tell the user to replug its cable. Without a person,
  `ghosthand daemon restart` also fixes it (all screen capture stops for a few seconds).
- No iPhone listed, or one that is not trusted or paired: run `ghosthand setup` once.
  Tell the user to complete setup in the small Ghosthand window. Do not interact
  with it. Poll `ghosthand setup status` every 2 seconds until ready is true.
  Continue automatically; do not reopen setup or retry input.

## Examples

```bash
$ ghosthand list
```

## MCP tool

The same command is the MCP tool [`list`](/docs/mcp/list); flags are arguments.
