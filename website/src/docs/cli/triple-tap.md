---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand triple-tap"
sidebarTitle: "triple-tap"
description: "Triple tap at screenshot coordinates or on text found by OCR, via the AssistiveTouch mouse pointer"
---

## Usage

```bash
ghosthand triple-tap <x> <y>
ghosthand triple-tap --text <text>
```

## Options

| Option | Description |
| --- | --- |
| `--text [text]` | Tap the text line that contains this (case-insensitive; an exact line wins) |
| `--index [n]` | With --text: pick the nth match, top to bottom (1-based) |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Rules:
- Send the numbers you read in the screenshot; do not scale them.
- Home Screen app labels do not open apps: tap the icon, ~40 points above the label.
- --text: an exact line match wins over "contains"; several matches fail with a list,
  pick one with --index. OCR resolves the target once, before input.
- The AssistiveTouch floating button can cover what you tap; hide it
  (Settings &gt; Accessibility &gt; Touch &gt; AssistiveTouch &gt; Always Show Menu off).
- App Store can show Resume while downloading. Check download/installation state
  before repeating taps; an unchanged label does not prove the click failed.
- Each press lasts 220...260 ms. Double taps have a 100...150 ms release-to-press gap,
  with no pointer movement between clicks. Use double-tap to select a word or zoom
  supported content, triple-tap to select a paragraph; app behavior varies. It is
  not a VoiceOver gesture or a side-button purchase confirmation.
- Long press (context menus, previews): `ghosthand hold`. Move an item after a long
  press: `ghosthand hold-drag`.
First use: pair the Mac from iPhone Settings &gt; Bluetooth (tap the Mac's name, then
Pair); the command waits for it. Each tap turns AssistiveTouch on over USB if off.
A paired iPhone reconnects in about 2 s after a daemon start.
- Approaches accelerate then slow at the target. Timing varies; tap coordinates do not.
- The first pointer input of a lease moves the pointer to 2 spots first (+0.4 s, no
  click): iOS turns the pointer 90° from the screen when the iPhone lies on its side,
  and input is turned to match ("iOS pointer space is turned"). Do not turn the
  iPhone during a lease; if you must, acquire a new lease.
- Relative pointer (older iOS, only if absolute failed): after a daemon start, a reconnect or 60 s idle, the
  pointer first jumps to the top-left corner (+0.3 s). That is normal.

## Examples

```bash
$ ghosthand triple-tap -l 42 207 448 --screenshot after.png
$ ghosthand triple-tap -l 42 --text "General" --screentext
```

## MCP tool

The same command is the MCP tool [`triple-tap`](/docs/mcp/triple-tap); flags are arguments.
