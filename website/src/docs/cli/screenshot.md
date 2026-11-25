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
| `--native` | Last resort, slow (2-7 s): a real iOS screenshot (cmd+shift+3), read over USB. Only when a second normal screenshot still misses an expected dialog |
| `--screentext` | Also print the OCR text of the same frame (`x,y wxh text`); uses --language |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The image is in screen points (375x667 on an iPhone 6s, 414x896 on an XR): small
enough for LLM vision, and the same coordinates `tap` and `swipe` take.
- Prefer `screentext` when you only need text: no image to read. Need both? Add
  --screentext: one call, image and text from the same frame.
- "No frame" means USB gave no fresh frame; it does not prove input failed.
  Check list and the display. If off and unlocked, use `wake -l <id>`; if on and
  unlocked, try daemon restart. Ask the user before restarting their iPhone.
- A locked iPhone gives no screenshot. Unlock only with a confirmed passcode.
  Never lock the phone to fix capture.
- Read the file only after the command returns. A read started in parallel with the
  capture can show the previous image.
- Password fields: screenshots often do not show the typed dots. An empty-looking
  secure field does not mean the password was not typed. Never type it again; check
  the result after you submit (next screen or error).
- Expected a dialog but the image has none? Take another normal screenshot first:
  permission alerts can appear 1-2 s after the tap, after the action's screenshot.
- --native is a last resort: only when a second normal screenshot still misses a
  dialog you expect (often the screen is dimmed, but not always). A few system dialogs
  are hidden from USB capture (seen: App Store Install sheet, cellular data and
  location prompts); a real iOS screenshot shows them, at the same coordinates `tap`
  takes. It costs 2-7 s instead of 0.1 s and needs Bluetooth and an unlocked phone.
  The file is deleted from Photos after reading, except with iCloud Photos on: then it
  stays in the user's library. iOS shows a screenshot thumbnail at the bottom left for
  a few seconds; it does not block taps elsewhere.
- XCTest mode: the image comes from XCTest; hidden-dialog support is not verified.
  --native is not needed.

## Examples

```bash
$ ghosthand screenshot -l 42
$ ghosthand screenshot -l 42 -o home.jpg --screentext
$ ghosthand screenshot -l 42 --native -o real.png
```

## MCP tool

The same command is the MCP tool [`screenshot`](/docs/mcp/screenshot); flags are arguments.
