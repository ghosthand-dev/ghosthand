---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand scroll"
sidebarTitle: "scroll"
description: "Scroll with the Bluetooth mouse wheel over a point (default: screen center). Use this to scroll web pages and lists; one tick is about 100 points"
---

## Usage

```bash
ghosthand scroll <up|down|left|right> <ticks>
```

## Options

| Option | Description |
| --- | --- |
| `--at [x,y]` | Scroll over this point (default: screen center) |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

down shows content further down (like a finger swipe up); up shows content above.
right shows content further right (carousels, wide tables); left goes back.
- One tick moves about 100 points in Safari, about 115 in Settings-style lists
  (UITableView), measured on an XR (896 points high, so `scroll down 8` is about
  one screen). These are estimates: check the result with --screentext.
- Faster than `swipe` for long distances: swipes have no momentum.
- --at: the content under this point scrolls (for a list inside a page or sheet).
- ticks 1-1000. At the end of the content nothing moves; compare --screentext.
- Date and picker wheels: `scroll up 2 --at x,y` over the wheel moves about 3.3 rows
  per tick (XR, iOS 18.7). Scroll near the target, tap the row, read the result.

## Examples

```bash
$ ghosthand scroll -l 42 down 5 --screentext
$ ghosthand scroll -l 42 up 3 --at 207,500 --screenshot s.png
```

## MCP tool

The same command is the MCP tool [`scroll`](/docs/mcp/scroll); flags are arguments.
