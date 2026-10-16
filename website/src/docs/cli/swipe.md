---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand swipe"
sidebarTitle: "swipe"
description: "Swipe a finger like a person from (x1,y1) to (x2,y2) in screenshot coordinates: fast, lifted while moving. For TikTok, feeds, lists, carousels, Home Screen pages"
---

## Usage

```bash
ghosthand swipe <x1> <y1> <x2> <y2>
```

## Options

| Option | Description |
| --- | --- |
| `--duration [ms]` | Fixed duration, 16-10000 (default: random 80-300, grows with the distance) |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The start point and the length (the distance to the end point) are yours; speed, easing
and a slight sideways bow are random on every call, so no two swipes are alike. Vary the
start and the length between calls: the same swipe every time is not human.
- Fast start, and the finger lifts while still moving, so lists keep scrolling
  (momentum). Content moves further than the swipe length. For an exact distance use
  `scroll`, or --duration 400 and more, which is slower but still lifts moving.
- TikTok: `swipe 200 700 200 250` swipes up from the lower middle: the next video.
  Both points must be on screen.
- Home Screen pages: start in empty space or on an app icon, not on a widget and not
  on the AssistiveTouch button.
- XCTest mode is fastest. Bluetooth mode needs ~100 ms more for the pointer to reach
  the start point; its first swipe after a connection measures the pointer speed (~1 s,
  one log line, the screen should be still).
- Items that need a long press first (Home Screen icons) use `hold-drag`; so does exact
  drag and drop.
Do not use it to go Home: `ghosthand key home`.

## Examples

```bash
$ ghosthand swipe -l 42 200 700 200 250
$ ghosthand swipe -l 42 340 500 60 500 --duration 150
```

## MCP tool

The same command is the MCP tool [`swipe`](/docs/mcp/swipe); flags are arguments.
