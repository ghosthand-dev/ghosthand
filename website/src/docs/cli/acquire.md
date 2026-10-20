---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand acquire"
sidebarTitle: "acquire"
description: "Take exclusive use of an iPhone for a task. Prints a short lease id; pass it explicitly with -l to every other command"
---

## Usage

```bash
ghosthand acquire --reason <task>
```

## Options

| Option | Description |
| --- | --- |
| `--reason [task]` | Required. The task you need the iPhone for, e.g. "reply to Anna in Messages". Others see it in `list` and busy errors |
| `--label [text]` | Optional display text, e.g. your agent session id, so others can find who holds the iPhone. Shown in `list` and busy errors |
| `--idle-timeout [s]` | End the lease this long after its last command (default: 600) |
| `-d, --device [id]` | Device id or name from `ghosthand list` (default: the only one) |
| `--force` | End another lease on the iPhone and take it |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Every command that uses an iPhone (screenshot, screentext, tap, hold, swipe, key, mute,
unmute, type, unlock, lock, wake, record start, record stop, assistivetouch, rename, forget, control, random,
file, photo, app, info, logs, restart, shutdown) needs a lease and runs on its
iPhone; list and `random list` do not. -d picks the iPhone here only.
- Always pass --reason with the task you need the iPhone for. Other agents read it
  to decide if they wait or give up.
- stdout is only the lease ID, e.g. 42. Pass -l 42 on every device command.
  Tool-call environments may not persist. Do not rely on an exported lease.
- An iPhone on another Mac of the account (see `list`) gives an ID with its Mac,
  e.g. studio:42. Pass it exactly so; this Mac's daemon sends each command there
  through ghosthand.dev. Without -d, a Mac with no iPhone takes the account's only one.
- IDs increase in state.db and are never reused there. Do not delete or restore
  state.db: that resets the counter. --label is only display text, not proof of
  ownership; acquiring again with the same label does not resume an active lease.
- Lease numbers are not authentication. The tunnel needs an account token.
- Over MCP the id always carries the Mac, e.g. studio:42: pass it exactly as acquire returned it.
- The lease ends by itself after --idle-timeout seconds without a command, so a
  crashed agent never blocks the phone. Run `ghosthand release -l 42` when done.
- acquire turns AssistiveTouch on over USB (the pointer for tap and swipe) if it
  is off; release turns it off again.
- Busy: acquire fails at once and shows the label, its reason, when it was
  acquired and its last command. Read them, then decide: give up or tell the user
  the iPhone is busy, or run `ghosthand wait` to wait for it.
- Use --force only when that lease is stale (its holder is gone); the old holder's
  next command then fails. After --force, take a screenshot first.

## Examples

```bash
$ ghosthand acquire -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F --label ses_123 --reason "reply to Anna in Messages"  # prints e.g. 42
$ ghosthand screenshot -l 42 -o s.png
```

## MCP tool

The same command is the MCP tool [`acquire`](/docs/mcp/acquire); flags are arguments.
