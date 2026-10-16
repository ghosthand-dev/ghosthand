---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand wait"
sidebarTitle: "wait"
description: "Wait until another lease on the iPhone ends, then acquire it. Use only after `acquire` said it is busy and you decided to wait"
---

## Usage

```bash
ghosthand wait --reason <task>
```

## Options

| Option | Description |
| --- | --- |
| `--reason [task]` | Required. The task you need the iPhone for, e.g. "reply to Anna in Messages". Others see it in `list` and busy errors |
| `--label [text]` | Optional display text, e.g. your agent session id, so others can find who holds the iPhone. Shown in `list` and busy errors |
| `--idle-timeout [s]` | End the lease this long after its last command (default: 600) |
| `-d, --device [id]` | Device id or name from `ghosthand list` (default: the only one) |
| `--timeout [s]` | Give up after this long, 1-3600 (default: 600) |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Prints the lease id like `acquire`. Retries every second (no queue order).
- Run `acquire` first and read who holds the iPhone and why. Wait only when your
  task can wait; otherwise give up or tell the user the iPhone is busy.
- On timeout it fails with the current lease's label and reason. Do not loop on wait.
- After wait, take a screenshot first: someone else used the phone.

## Examples

```bash
$ ghosthand wait -d 7EF219AD-69B4-423E-B8C4-4F4A6140822F --label ses_123 --reason "reply to Anna in Messages" --timeout 600  # prints e.g. 43
```

## MCP tool

The same command is the MCP tool [`wait`](/docs/mcp/wait); flags are arguments.
