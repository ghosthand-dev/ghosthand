---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand task"
sidebarTitle: "task"
description: "Do a task in plain words: a fast agent on ghosthand.dev reads the screen with OCR and taps until it is done, then answers"
---

## Usage

```bash
ghosthand task <prompt>
ghosthand task --resume <id> [<prompt>]
```

## Options

| Option | Description |
| --- | --- |
| `--resume [id]` | Continue task &lt;id&gt; (printed by an earlier `task`) with its history. Without a prompt: follow its running turn |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The agent (Claude Haiku 5.5 on ghosthand.dev) reads the screen text after every action
and stops when the task is done or blocked.
Progress (each tool call and the first line of its result) goes to stderr, the answer to
stdout, then the task id.
- Use it for multi-step navigation, to save your own steps and context. Check the result
  with `screentext` when it matters.
- It reads OCR text, not images: it can miss icons and misread text. Name the target by
  its visible text when you can.
- It never pays, buys, deletes data or types passwords unless the prompt asks exactly
  that. Do sensitive steps yourself.
- Ctrl-C stops the task. A dropped connection reconnects by itself; if the command still
  fails, `task --resume <id>` follows the running turn.
- `--resume <id> <prompt>` while a turn of that task runs stops the turn and starts the
  new prompt, with the stopped turn in the history.
- The agent knows the iPhone's name, model, iOS version, language and region, so it
  looks for labels in that language.
- Needs a signed-in Mac (`ghosthand account`) and the lease. Send no other input while it
  runs. A task is kept one day after its last turn.

## Examples

```bash
$ ghosthand task -l 42 "open Settings > General > About and tell me the iOS version"
$ ghosthand task -l 42 --resume tsk_8f2k3x9a1b2c "now go back to the Home Screen"
```

## MCP tool

The same command is the MCP tool [`task`](/docs/mcp/task); flags are arguments.
