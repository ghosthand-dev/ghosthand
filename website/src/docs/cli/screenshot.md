---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand screenshot"
sidebarTitle: "screenshot"
description: "Save the current iPhone screen as PNG (or JPG) over USB, in about 0.3s"
---

## Usage

```bash
ghosthand screenshot
```

## Options

| Option | Description |
| --- | --- |
| `-o, --out [path]` | Output file, .png or .jpg (default: screenshot.png) |
| `--settle` | Wait (up to 2s) until the screen stops changing; --screenshot on actions always does |
| `--native` | Take a real iOS screenshot (cmd+shift+3), read it over USB, delete it from Photos. Shows dialogs USB capture hides |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The image is in screen points (375x667 on an iPhone 6s, 414x896 on an XR): small
enough for LLM vision, and the same coordinates `tap` and `swipe` take.
- Prefer `screentext` when you only need text: no image to read.
- "No frame" means USB gave no fresh frame; it does not prove input failed.
  Check list and the display. If off and unlocked, use `wake -l <id>`; if on and
  unlocked, try daemon restart. Ask the user before restarting their iPhone.
- A locked iPhone gives no screenshot. Unlock only with a confirmed passcode.
  Never lock the phone to fix capture.
- Read the file only after the command returns. A read started in parallel with the
  capture can show the previous image.
- Screen dimmed but no dialog in the image? Some system dialogs are hidden from USB
  capture (seen: App Store Install sheet, cellular data and location prompts).
  --native takes a real iOS screenshot (about 2 s): the dialog shows, at the
  same coordinates `tap` takes. It needs Bluetooth, an unlocked phone, and is deleted
  from Photos after reading. iOS shows a screenshot thumbnail at the bottom left for
  a few seconds; it does not block taps elsewhere.
- XCTest mode: the image comes from XCTest; hidden-dialog support is not verified.
  --native is not needed.

## Examples

```bash
$ ghosthand screenshot -l 42
$ ghosthand screenshot -l 42 -o home.png
$ ghosthand screenshot -l 42 --native -o real.png
```

## MCP tool

The same command is the MCP tool [`screenshot`](/docs/mcp/screenshot); flags are arguments.
