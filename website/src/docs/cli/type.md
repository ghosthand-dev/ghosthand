---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand type"
sidebarTitle: "type"
description: "Type text on the Bluetooth keyboard (US-ASCII)"
---

## Usage

```bash
ghosthand type <text>
ghosthand type --stdin
```

## Options

| Option | Description |
| --- | --- |
| `--stdin` | Read UTF-8 text to EOF; remove one final LF or CRLF; never echo the input |
| `--keep-final-newline` | With --stdin: preserve the final newline (LF sends Enter; CR is unsupported) |
| `--enter` | Press Enter after the text (sends a message in Messages) |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Keys go to the field that has focus. Before typing, read a screenshot and check the
cursor is in the right field; if not, tap that field first.
- Key holds and gaps vary, averaging about 43 ms per character, with short pauses
  at spaces, tabs and newlines. No typos or extra characters are added.
- --stdin accepts no positional text. One final LF or CRLF is removed by default;
  spaces, tabs and other LF newlines are preserved. LF sends Enter; tab moves focus.
  --keep-final-newline preserves LF, and --enter sends an additional Enter.
- All input is validated before connecting or sending any key. Unsupported control
  characters, invalid UTF-8, accents and emoji fail without echoing input.
- Messages: Enter in the To: field adds the recipient but keeps focus there. Tap the
  message field, check the screenshot, then `type "..." --enter` (Enter sends).
Only US-ASCII: no accents or emoji. iOS autocorrect may change a word; check with
--screenshot before --enter.
- XCTest mode: types any text (accents, emoji) into the field that has focus; tap the
  field first so the keyboard shows. WebDriverAgent does not check focus: with no field
  focused `type` still says "typed" and nothing happens. Use --screenshot or --wait-text.
- Password fields: while a secure field has focus, screenshots show the old screen
  for 2-6 s. Type once, wait, or press `key tab` before you read the screen.

## Examples

```bash
$ ghosthand type -l 42 "ciao" --enter --screenshot after.png
$ secret-provider | ghosthand type -l 42 --stdin
```

## MCP tool

The same command is the MCP tool [`type`](/docs/mcp/type); flags are arguments.
