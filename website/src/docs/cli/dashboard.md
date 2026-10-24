---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand dashboard"
sidebarTitle: "dashboard"
description: "Open the control plane window: every iPhone, which agent uses it and why, and its live screen"
---

## Usage

```bash
ghosthand dashboard
```

## Options

| Option | Description |
| --- | --- |
| `--mock [scene]` | Run on fixed state without a phone: sign-in, signing-in, permissions, no-phone, trust, unlock, unreadable, bluetooth-off, bluetooth-permission, bluetooth-restricted, bluetooth-unsupported, bluetooth-starting, bluetooth-error, pair, connecting, ready, developer-mode, xctest-starting, xctest-failed, xctest-ready, several, fleet, remote, chat, tour |
| `--snapshot [path]` | Save the window to PNG after 2.5 s and quit (with --foreground). Mocks render in process; live backdrop blur needs Screen Recording |
| `--foreground` | Stay in this process instead of detaching |
| `--background` | Open the window behind the user's windows without taking focus: for agents that check the window with accessibility tools (cua-driver) |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

For a person, not an agent. Shows every iPhone on USB in a sidebar with a status dot
(blue in use, green free, orange locked, yellow connecting, red needs setup). The
detail shows the lease (agent label, task, lease age, last command, idle timeout),
agents waiting for it, the USB and Bluetooth state, the ids, and a live screen at up
to 30 fps. The screen view needs no lease and does not reset the agent's idle timer.
Hover the screen and click Take Control to tap it with clicks, swipe with drags and type
with the Mac keyboard; Esc or Release Control stops. Take Control needs no lease either: while an
agent holds the iPhone, the person's input goes between its commands. Updates every
second. "Set Up iPhone" opens the setup window.
The Agent chat on the right (toggle with the sidebar button) runs `task` on the selected
iPhone: each prompt takes a lease labeled "Control plane chat", streams the agent's tool
calls, and releases the lease when the agent answers or Stop is clicked. The next prompt
continues the same task; the pencil button starts a new one. Needs a signed-in Mac.
Detaches at once, so the terminal is free and the window stays open after the
command exits. `dashboard` and `setup` share one process: running either again shows its
window. Starts the daemon when needed.

## Examples

```bash
$ ghosthand dashboard
$ ghosthand dashboard --foreground --mock fleet --snapshot control-plane.png
```
