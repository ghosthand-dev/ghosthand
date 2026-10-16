---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand hold-drag"
sidebarTitle: "hold-drag"
description: "Long press at (x1,y1), then drag to (x2,y2) with the button still held: moves items that need a long press first, like Home Screen icons"
---

## Usage

```bash
ghosthand hold-drag <x1> <y1> <x2> <y2>
```

## Options

| Option | Description |
| --- | --- |
| `--hold [ms]` | How long to stay still before the drag, 100-10000 (default: 1000) |
| `--duration [ms]` | Drag duration after the hold (default: 1000) |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The button goes down at (x1,y1), stays still for --hold, moves to (x2,y2) over
--duration, then goes up. A plain `swipe` starts moving at once, so items that need
a long press first do not move with it.
- Home Screen icons, from the normal Home Screen: --hold 2500 (iOS enters edit mode
  while held, then the icon follows). Works with AssistiveTouch &gt; Perform Touch
  Gestures on (SE2, iOS 18.6). Leave edit mode with `key home`.
- Start on the icon, not on the AssistiveTouch button next to it.
- Slow drags (default 1000 ms) let iOS follow the item.

## Examples

```bash
$ ghosthand hold-drag -l 42 60 120 300 400 --screenshot after.png
```

## MCP tool

The same command is the MCP tool [`hold-drag`](/docs/mcp/hold-drag); flags are arguments.
