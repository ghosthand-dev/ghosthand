---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand hold"
sidebarTitle: "hold"
description: "Press and hold (long press) at screenshot coordinates or on text found by OCR, via the AssistiveTouch mouse pointer"
---

## Usage

```bash
ghosthand hold <x> <y>
ghosthand hold --text <text>
```

## Options

| Option | Description |
| --- | --- |
| `--text [text]` | Hold the text line that contains this (case-insensitive; an exact line wins) |
| `--index [n]` | With --text: pick the nth match, top to bottom (1-based) |
| `--duration [ms]` | How long the button stays down, 100-10000 (default: 1000) |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The button goes down, stays still for --duration, then goes up. Same targets as tap
(coordinates, or --text with --index).
- Home Screen icon: opens its context menu (Edit Home Screen, Remove App, ...). Hold
  the icon, not its label. Close a menu with `key esc`.
- Links, photos, messages, buttons with menus: context menu or preview.
- A button that ignored `tap`: read the screen, then press it once more (tap or
  `hold --duration 400`). A just-opened alert can ignore the first press; the second
  worked every time in tests, with tap, hold or swipe alike.
- To move the item after the long press (reorder icons or rows), use `hold-drag`.

## Examples

```bash
$ ghosthand hold -l 42 60 120 --screenshot after.png
$ ghosthand hold -l 42 --text "Allow" --duration 400 --screentext
```

## MCP tool

The same command is the MCP tool [`hold`](/docs/mcp/hold); flags are arguments.
