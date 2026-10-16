---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand control"
sidebarTitle: "control"
description: "Show or switch how input reaches the iPhone: Bluetooth mouse and keyboard (default) or XCTest (WebDriverAgent). Switch only when the user asks"
---

## Usage

```bash
ghosthand control [bluetooth|xctest]
```

## Options

| Option | Description |
| --- | --- |
| `--team [id]` | Apple team id that signs WebDriverAgent (default: the only Apple Development certificate) |
| `--rebuild` | Build WebDriverAgent again, e.g. after a free team's 7-day signature expired |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Without an argument it prints the mode, and in XCTest mode the runner state.
XCTest mode:
- Input and screenshots go through WebDriverAgent (Appium's XCUITest runner), built with
  the user's Xcode and signed by their Apple team. Use it for system alerts that
  ignore the Bluetooth pointer, and dialogs that USB capture hides (not proven for all).
- The user does once: Xcode signed in to an Apple account (Xcode &gt; Settings &gt; Accounts;
  a free account works), Developer Mode on the iPhone, the developer trusted (Settings &gt;
  General &gt; VPN & Device Management), UI Automation on (Settings &gt; Developer &gt; Enable UI
  Automation). Errors say which step is missing. Do not change these settings yourself.
  With Developer Mode off, `control xctest` makes its hidden switch visible, then fails
  with the steps: tell the user, wait until they confirm, then run it again.
  Full guide: https://ghosthand.dev/docs/xctest-mode
- `control xctest` builds WebDriverAgent (1-3 min the first time), starts it and waits
  until it answers. After a daemon start, the first command starts it (about 15 s).
- Same commands. lock, unlock, mute, unmute and keyboard shortcuts fail with
  unsupported-in-mode: keep the iPhone unlocked (Auto-Lock Never). key sends only home,
  volumeup, volumedown, enter, backspace, tab, space. type types any text.
- A free team's signature lasts 7 days: then run `control xctest --rebuild`.
- Recording and the dashboard preview still use USB screen capture.
- `control bluetooth` stops the runner and goes back to the Bluetooth mouse and keyboard.

## Examples

```bash
$ ghosthand control -l 42
$ ghosthand control -l 42 xctest
$ ghosthand control -l 42 bluetooth
```

## MCP tool

The same command is the MCP tool [`control`](/docs/mcp/control); flags are arguments.
