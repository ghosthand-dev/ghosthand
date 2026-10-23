---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand setup"
sidebarTitle: "setup"
description: "Open the setup window: connect a new iPhone over USB and Bluetooth, step by step"
---

## Usage

```bash
ghosthand setup
```

## Options

| Option | Description |
| --- | --- |
| `--mock [scene]` | Run on fixed state without a phone: sign-in, signing-in, permissions, no-phone, trust, unlock, unreadable, bluetooth-off, bluetooth-permission, bluetooth-restricted, bluetooth-unsupported, bluetooth-starting, bluetooth-error, pair, connecting, ready, developer-mode, xctest-starting, xctest-failed, xctest-ready, several, fleet, remote, chat, tour |
| `--snapshot [path]` | Save the window to PNG after 2.5 s and quit (with --foreground). Mocks render in process; live backdrop blur needs Screen Recording |
| `--foreground` | Stay in this process instead of detaching |
| `--permissions` | Show the permissions checklist, even if access is already allowed. Only user clicks request dialogs |
| `--xctest` | Also show the choice between Bluetooth and XCTest control. Shown anyway for iPhones with Developer Mode on. Only when the user asks for XCTest |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

For a person, not an agent: shows Sign in with Google first (once per Mac), then
permissions (Allow Camera and Allow Bluetooth buttons), then one step at a time (plug
in, trust, unlock, pair over Bluetooth) and updates by itself every second. The Mac is discoverable over
Bluetooth only while this window shows the pairing step. When the iPhone is ready it
offers a prompt to copy for an agent.
- Agents: run this when the user wants to connect a new iPhone, or when `list` or an
  error shows no iPhone, an untrusted one, or a Bluetooth link that never connects.
  A locked iPhone that is trusted and paired needs `unlock` or the user, not setup.
  Tell the user to complete setup in the small Ghosthand window. All window actions
  are user-only; do not interact with it. Poll `ghosthand setup status` every 2 seconds until
  ready is true. Continue automatically. Do not retry input or reopen setup while waiting.
- Do not open it when an iPhone already works, or twice in a row.
- The daemon runs as Ghosthand.app, so permissions belong to Ghosthand, not your
  editor. Normal commands never show permission dialogs or open System Settings.
  Only user clicks in setup request permissions or open settings.
- The first setup adds the daemon to Login Items (LaunchAgent
  ~/Library/LaunchAgents/com.remorses.ghosthand.daemon.plist), so it starts at login and
  after a crash. macOS may show a "Background Items Added" notification. A running
  daemon is kept. The user can turn it off in System Settings &gt; General &gt; Login Items;
  setup never turns it on again. Without it, commands still start the daemon on demand.
- In a sandboxed agent shell (Codex default), run setup with sandbox escalation: the
  sandbox blocks Launch Services. Never add --foreground: the app and daemon start
  outside the agent's process, so restarting the agent does not stop them.
- --permissions keeps the permissions checklist open even when access is already
  allowed. It never requests permission by itself.
Detaches at once, so the terminal is free and the window stays open after the
command exits. `dashboard` and `setup` share one process: running either again shows its
window. Starts the daemon when needed.

## Examples

```bash
$ ghosthand setup
$ ghosthand setup --foreground --mock pair --snapshot pair.png
```

## MCP tool

The same command is the MCP tool [`setup`](/docs/mcp/setup); flags are arguments.
